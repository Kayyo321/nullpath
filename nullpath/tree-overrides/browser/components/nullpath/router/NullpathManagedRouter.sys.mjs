/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Guided setup and lifecycle of the Nullpath-managed i2pd (§5).
 */

import { setTimeout } from "resource://gre/modules/Timer.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  NetUtil: "resource://gre/modules/NetUtil.sys.mjs",
  FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
  NullpathProcess:
    "moz-src:///browser/components/nullpath/router/NullpathProcess.sys.mjs",
  NullpathRouterConfig:
    "moz-src:///browser/components/nullpath/router/NullpathRouterConfig.sys.mjs",
  managedRouterDir:
    "moz-src:///browser/components/nullpath/router/NullpathRouterConfig.sys.mjs",
  MANAGED_PORTS:
    "moz-src:///browser/components/nullpath/router/NullpathRouterConfig.sys.mjs",
  NULLPATH_I2PD_DOWNLOAD_HOSTS:
    "moz-src:///browser/components/nullpath/router/NullpathRouterManifest.sys.mjs",
  NULLPATH_I2PD_SHA256:
    "moz-src:///browser/components/nullpath/router/NullpathRouterManifest.sys.mjs",
  NULLPATH_I2PD_URL:
    "moz-src:///browser/components/nullpath/router/NullpathRouterManifest.sys.mjs",
  NULLPATH_I2PD_VERSION:
    "moz-src:///browser/components/nullpath/router/NullpathRouterManifest.sys.mjs",
});
ChromeUtils.defineLazyGetter(lazy, "Loopback", () =>
  ChromeUtils.importESModule(
    "moz-src:///browser/components/nullpath/router/NullpathLoopback.sys.mjs"
  )
);

const LOOPBACK = "127.0.0.1";
const STOP_GRACE_MS = 5000;
const PORT_SEARCH = 20;

/**
 * Channels created by the setup download. The channel filter and request
 * blocker let exactly these through (§5.3 step 1, §8.3). Only this module can
 * add to the set. It holds strong references (XPConnect wrappers in a WeakSet
 * could be collected and recreated, losing the tag) and each download removes
 * its channels when it stops.
 */
const setupChannels = new Set();

export function isSetupDownloadChannel(channel) {
  return setupChannels.has(channel);
}

export class SetupError extends Error {
  constructor(l10nId, cause) {
    super(l10nId, { cause });
    this.l10nId = l10nId;
  }
}

function randomToken(length = 32) {
  let alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
}

function randomRouterPort() {
  let [n] = crypto.getRandomValues(new Uint32Array(1));
  return 20000 + (n % 20001);
}

function hex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Config files (§5.4)

export function buildI2pdConf({ dir, ports, consolePassword, controlPassword, relay = false, bandwidth = "L", upnp = false }) {
  return `# Written by Nullpath. Edits are kept unless you choose "Restart guided setup".
log = file
logfile = ${PathUtils.join(dir, "logs", "i2pd.log")}
loglevel = warn
port = ${ports.router}
ipv4 = true
ipv6 = false
bandwidth = ${bandwidth}
notransit = ${relay ? "false" : "true"}
floodfill = false

[httpproxy]
enabled = true
address = ${LOOPBACK}
port = ${ports.sites}
outproxy =
addresshelper = true
keys = nullpath-sites.dat

[http]
enabled = true
address = ${LOOPBACK}
port = ${ports.console}
auth = true
user = nullpath
pass = ${consolePassword}
strictheaders = true

[i2pcontrol]
enabled = true
address = ${LOOPBACK}
port = ${ports.control}
password = ${controlPassword}

[socksproxy]
enabled = false
[sam]
enabled = false
[bob]
enabled = false
[i2cp]
enabled = false
[upnp]
enabled = ${upnp ? "true" : "false"}

[reseed]
verify = true
`;
}

/**
 * The public-web tunnel. It's left out entirely until the user sets an
 * outproxy, which is how "present but disabled" is expressed for i2pd.
 */
export function buildTunnelsConf({ ports, outproxy }) {
  let header =
    "# Written by Nullpath. The public-web tunnel appears once an outproxy is set.\n";
  if (!outproxy) {
    return header;
  }
  return `${header}
[nullpath-publicweb]
type = httpproxy
address = ${LOOPBACK}
port = ${ports.publicWeb}
outproxy = ${outproxy}
keys = nullpath-publicweb.dat
`;
}

/**
 * Sets `key = value` inside `[section]` (or before the first section when
 * section is ""), keeping every other line as written.
 */
export function setConfKey(text, section, key, value) {
  let lines = text.split(/\r?\n/);
  let current = "";
  let sectionStart = section ? -1 : 0;
  let sectionEnd = lines.length;
  for (let i = 0; i < lines.length; i++) {
    let sec = /^\s*\[(.+?)\]\s*$/.exec(lines[i]);
    if (sec) {
      if (current == section && sectionStart != -1 && i > sectionStart) {
        sectionEnd = i;
        break;
      }
      current = sec[1].trim();
      if (current == section) {
        sectionStart = i + 1;
      } else if (!section) {
        sectionEnd = i;
        break;
      }
      continue;
    }
    if (current == section && new RegExp(`^\\s*${key}\\s*=`).test(lines[i])) {
      let comment = /\s+#.*$/.exec(lines[i])?.[0] ?? "";
      lines[i] = `${key} = ${value}${comment}`;
      return lines.join("\n");
    }
  }
  if (sectionStart == -1) {
    lines.push(`[${section}]`, `${key} = ${value}`);
    return lines.join("\n");
  }
  // Insert after the last non-blank line of the section.
  let at = sectionEnd;
  while (at > sectionStart && !lines[at - 1].trim()) {
    at--;
  }
  lines.splice(at, 0, `${key} = ${value}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Download (§5.3 step 1–2)

/**
 * Downloads `url` directly and returns its bytes. This is the only direct
 * request an I2P profile makes (§5.3). DNS is disabled in I2P profiles
 * (§8.2), so name resolution is re-enabled for exactly the duration of this
 * download; every other channel still goes to the I2P proxy, which resolves
 * names itself, so nothing else can use the lookup.
 */
async function downloadBytes(url, { signal, onProgress }) {
  let prefs = Services.prefs;
  let dnsWasLocked = prefs.prefIsLocked("network.dns.disabled");
  let dnsWasDisabled = prefs.getBoolPref("network.dns.disabled", false);
  if (dnsWasDisabled) {
    if (dnsWasLocked) {
      prefs.unlockPref("network.dns.disabled");
    }
    prefs.getDefaultBranch("").setBoolPref("network.dns.disabled", false);
    prefs.clearUserPref("network.dns.disabled");
  }
  try {
    return await new Promise((resolve, reject) => {
      let channel = lazy.NetUtil.newChannel({
        uri: url,
        loadUsingSystemPrincipal: true,
      }).QueryInterface(Ci.nsIHttpChannel);
      channel.loadFlags |=
        Ci.nsIRequest.LOAD_BYPASS_CACHE |
        Ci.nsIRequest.INHIBIT_CACHING |
        Ci.nsIRequest.LOAD_ANONYMOUS;
      setupChannels.add(channel);
      channel.notificationCallbacks = {
        QueryInterface: ChromeUtils.generateQI([
          "nsIInterfaceRequestor",
          "nsIChannelEventSink",
        ]),
        getInterface(iid) {
          return this.QueryInterface(iid);
        },
        asyncOnChannelRedirect(oldChannel, newChannel, flags, callback) {
          let uri = newChannel.URI;
          if (
            uri.scheme == "https" &&
            lazy.NULLPATH_I2PD_DOWNLOAD_HOSTS.includes(uri.host)
          ) {
            setupChannels.add(newChannel);
            ownChannels.push(newChannel);
            callback.onRedirectVerifyCallback(Cr.NS_OK);
          } else {
            callback.onRedirectVerifyCallback(Cr.NS_ERROR_ABORT);
          }
        },
      };
      let ownChannels = [channel];
      let chunks = [];
      let received = 0;
      signal?.addEventListener("abort", () => channel.cancel(Cr.NS_BINDING_ABORTED), { once: true });
      channel.asyncOpen({
        onStartRequest() {},
        onDataAvailable(request, stream, offset, count) {
          let bin = Cc["@mozilla.org/binaryinputstream;1"].createInstance(
            Ci.nsIBinaryInputStream
          );
          bin.setInputStream(stream);
          let buf = new Uint8Array(count);
          bin.readArrayBuffer(count, buf.buffer);
          chunks.push(buf);
          received += count;
          let total = request.QueryInterface(Ci.nsIChannel).contentLength;
          onProgress?.(received, total > 0 ? total : 0);
        },
        onStopRequest(request, status) {
          ownChannels.forEach(c => setupChannels.delete(c));
          let http = request.QueryInterface(Ci.nsIHttpChannel);
          let ok = Components.isSuccessCode(status);
          let code = 0;
          try {
            code = http.responseStatus;
          } catch (e) {}
          if (!ok || code != 200) {
            reject(new SetupError(signal?.aborted ? "nullpath-setup-cancelled" : "nullpath-setup-error-download"));
            return;
          }
          let out = new Uint8Array(received);
          let pos = 0;
          for (let c of chunks) {
            out.set(c, pos);
            pos += c.length;
          }
          resolve(out);
        },
      });
    });
  } finally {
    if (dnsWasDisabled) {
      prefs.getDefaultBranch("").setBoolPref("network.dns.disabled", true);
      if (dnsWasLocked) {
        prefs.lockPref("network.dns.disabled");
      }
    }
  }
}

function sha256(bytes) {
  let hash = Cc["@mozilla.org/security/hash;1"].createInstance(Ci.nsICryptoHash);
  hash.init(Ci.nsICryptoHash.SHA256);
  hash.update(bytes, bytes.length);
  return hex(Uint8Array.from(hash.finish(false), c => c.charCodeAt(0)));
}

/** Extracts the i2pd zip into bin\, and its reseed certificates into data\. */
async function extract(zipPath, dir) {
  let reader = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(
    Ci.nsIZipReader
  );
  reader.open(new lazy.FileUtils.File(zipPath));
  let foundExe = false;
  try {
    for (let entry of reader.findEntries(null)) {
      if (entry.endsWith("/") || entry.includes("..")) {
        continue;
      }
      let parts = entry.split("/");
      let target;
      if (parts.at(-1).toLowerCase() == "i2pd.exe") {
        target = PathUtils.join(dir, "bin", "i2pd.exe");
        foundExe = true;
      } else {
        let certIdx = parts.indexOf("certificates");
        if (certIdx == -1) {
          continue;
        }
        target = PathUtils.join(dir, "data", ...parts.slice(certIdx));
      }
      await IOUtils.makeDirectory(PathUtils.parent(target), { ignoreExisting: true });
      reader.extract(entry, new lazy.FileUtils.File(target));
    }
  } finally {
    reader.close();
  }
  if (!foundExe) {
    throw new SetupError("nullpath-setup-error-install");
  }
}

async function choosePort(preferred) {
  for (let port = preferred; port < preferred + PORT_SEARCH; port++) {
    if (!(await lazy.Loopback.probePort(LOOPBACK, port, 500))) {
      return port;
    }
  }
  throw new SetupError("nullpath-setup-error-ports");
}

// ---------------------------------------------------------------------------

class ManagedRouter {
  get dir() {
    return lazy.NullpathRouterConfig.config.managed?.dir ?? lazy.managedRouterDir();
  }

  get #pidPath() {
    return PathUtils.join(this.dir, "i2pd.pid");
  }

  get #exePath() {
    return PathUtils.join(this.dir, "bin", "i2pd.exe");
  }

  /**
   * Whether i2pd.exe is still on disk. Antivirus software sometimes
   * quarantines it after setup, which leaves the router installed but unable
   * to start.
   */
  exeExists() {
    return IOUtils.exists(this.#exePath);
  }

  get installed() {
    return !!lazy.NullpathRouterConfig.config.managed;
  }

  get settings() {
    return lazy.NullpathRouterConfig.config.managed;
  }

  consoleURL() {
    let m = this.settings;
    return m ? `http://${LOOPBACK}:${m.ports.console}/` : null;
  }

  // --- guided setup -------------------------------------------------------

  /**
   * Runs guided setup (§5.3). `onStep(step, status, detail)` reports progress
   * for the steps "download", "verify", "install", "ports" and "start".
   * Cancelling (via `signal`) is honoured until the start step.
   */
  async install({ signal, onStep = () => {} } = {}) {
    let dir = lazy.managedRouterDir();
    let createdDir = !(await IOUtils.exists(dir));
    let step = "download";
    try {
      let tmp = PathUtils.join(dir, "download.part");
      let bytes = await this.#fetchVerified({ signal, onStep });
      step = "install";
      onStep("install", "running");
      await IOUtils.makeDirectory(PathUtils.join(dir, "logs"), { ignoreExisting: true });
      await IOUtils.write(tmp, bytes);
      await extract(tmp, dir);
      await IOUtils.remove(tmp);
      this.#checkCancelled(signal);
      onStep("install", "done");

      step = "ports";
      onStep("ports", "running");
      let ports = {
        sites: await choosePort(lazy.MANAGED_PORTS.sites),
        publicWeb: await choosePort(lazy.MANAGED_PORTS.publicWeb),
        console: await choosePort(lazy.MANAGED_PORTS.console),
        control: await choosePort(lazy.MANAGED_PORTS.control),
        router: randomRouterPort(),
      };
      let managed = {
        dir,
        i2pdVersion: lazy.NULLPATH_I2PD_VERSION,
        ports,
        consolePassword: randomToken(),
        controlPassword: randomToken(),
        keepRunningWhenDisconnected: false,
        upnp: false,
        relay: false,
        bandwidth: "L",
        firstStartDone: false,
      };
      let outproxy = lazy.NullpathRouterConfig.config.outproxy?.destination;
      await IOUtils.writeUTF8(
        PathUtils.join(dir, "i2pd.conf"),
        buildI2pdConf({ ...managed })
      );
      await IOUtils.writeUTF8(
        PathUtils.join(dir, "tunnels.conf"),
        buildTunnelsConf({ ports, outproxy })
      );
      this.#checkCancelled(signal);
      onStep("ports", "done");

      step = "start";
      await lazy.NullpathRouterConfig.update(config => {
        config.managed = managed;
        config.setup = "managed";
      });
      onStep("start", "done");
    } catch (e) {
      onStep(step, "failed", e.l10nId ?? "nullpath-setup-error-generic");
      if (createdDir) {
        await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
      }
      throw e;
    }
  }

  /** Update to the pinned version, keeping data\ and the config (§5.7). */
  async update({ signal, onStep = () => {} } = {}) {
    let wasRunning = !!(await this.runningProcess());
    await this.stop();
    let bytes = await this.#fetchVerified({ signal, onStep });
    onStep("install", "running");
    let tmp = PathUtils.join(this.dir, "download.part");
    await IOUtils.write(tmp, bytes);
    await extract(tmp, this.dir);
    await IOUtils.remove(tmp);
    await lazy.NullpathRouterConfig.update(config => {
      config.managed.i2pdVersion = lazy.NULLPATH_I2PD_VERSION;
    });
    onStep("install", "done");
    if (wasRunning) {
      await this.start();
    }
  }

  get updateAvailable() {
    let v = this.settings?.i2pdVersion;
    return !!v && v != lazy.NULLPATH_I2PD_VERSION;
  }

  async #fetchVerified({ signal, onStep }) {
    onStep("download", "running");
    let bytes = await downloadBytes(lazy.NULLPATH_I2PD_URL, {
      signal,
      onProgress: (received, total) =>
        onStep("download", "progress", { received, total }),
    });
    onStep("download", "done");
    this.#checkCancelled(signal);
    onStep("verify", "running");
    if (sha256(bytes) != lazy.NULLPATH_I2PD_SHA256.toLowerCase()) {
      throw new SetupError("nullpath-setup-error-hash");
    }
    onStep("verify", "done");
    return bytes;
  }

  #checkCancelled(signal) {
    if (signal?.aborted) {
      throw new SetupError("nullpath-setup-cancelled");
    }
  }

  // --- process ------------------------------------------------------------

  async #readPid() {
    try {
      let { pid, startTime } = await IOUtils.readJSON(this.#pidPath);
      return { pid, startTime };
    } catch (e) {
      return null;
    }
  }

  /** The running managed i2pd, or null. */
  async runningProcess() {
    let rec = await this.#readPid();
    if (!rec || !lazy.NullpathProcess.isAlive(rec.pid, rec.startTime)) {
      return null;
    }
    let image = lazy.NullpathProcess.imagePath(rec.pid) ?? "";
    return /i2pd\.exe$/i.test(image) ? rec : null;
  }

  /** Starts i2pd unless it's already running (possibly from another profile). */
  async start() {
    let running = await this.runningProcess();
    if (running) {
      return running;
    }
    let dir = this.dir;
    let exe = this.#exePath;
    if (!(await this.exeExists())) {
      throw new SetupError("nullpath-setup-error-missing");
    }
    await IOUtils.makeDirectory(PathUtils.join(dir, "data"), { ignoreExisting: true });
    let rec = lazy.NullpathProcess.launchDetached(
      exe,
      [
        `--datadir=${PathUtils.join(dir, "data")}`,
        `--conf=${PathUtils.join(dir, "i2pd.conf")}`,
        `--tunconf=${PathUtils.join(dir, "tunnels.conf")}`,
      ],
      dir
    );
    await IOUtils.writeJSON(this.#pidPath, rec);
    return rec;
  }

  /**
   * Stops i2pd: asks it to shut down now, then kills it after 5 s (§5.5).
   * A graceful shutdown isn't used because it can take ten minutes.
   */
  async stop() {
    let rec = await this.runningProcess();
    if (!rec) {
      await IOUtils.remove(this.#pidPath, { ignoreAbsent: true });
      return;
    }
    try {
      await this.consoleCommand("terminate");
    } catch (e) {}
    let deadline = Date.now() + STOP_GRACE_MS;
    while (Date.now() < deadline && lazy.NullpathProcess.isAlive(rec.pid, rec.startTime)) {
      await new Promise(r => setTimeout(r, 250));
    }
    if (lazy.NullpathProcess.isAlive(rec.pid, rec.startTime)) {
      lazy.NullpathProcess.kill(rec.pid);
    }
    await IOUtils.remove(this.#pidPath, { ignoreAbsent: true });
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  // --- web console --------------------------------------------------------

  async #consoleGet(path) {
    let m = this.settings;
    let url = new URL(path, `http://${LOOPBACK}:${m.ports.console}/`);
    return lazy.Loopback.httpRequest(url, {
      headers: {
        Authorization: lazy.Loopback.basicAuth("nullpath", m.consolePassword),
      },
    });
  }

  /**
   * Runs an i2pd web console command. Commands need the per-session token
   * shown on the commands page. Command names used: "terminate",
   * "enable_transit", "disable_transit", "reload_tunnels_config".
   * Verify them against the pinned i2pd version.
   */
  async consoleCommand(cmd) {
    let page = await this.#consoleGet("/?page=commands");
    let token = /[?&]token=([\w-]+)/.exec(page?.body ?? "")?.[1];
    if (!token) {
      throw new Error("console token unavailable");
    }
    let res = await this.#consoleGet(`/?cmd=${encodeURIComponent(cmd)}&token=${token}`);
    if (!res || res.status >= 400) {
      throw new Error(`console command ${cmd} failed`);
    }
    // The commands page only lists transit commands the running version knows.
    return page.body.includes(`cmd=${cmd}`) || cmd == "terminate";
  }

  /** Router health from the console's main page: peers and uptime. */
  async details() {
    let res = await this.#consoleGet("/");
    if (!res || res.status != 200) {
      return null;
    }
    let text = res.body.replace(/<[^>]+>/g, " ");
    let peers = /Routers:\s*(\d+)/.exec(text)?.[1];
    let uptime = /Uptime:\s*([^\n]+?)\s{2,}/.exec(text)?.[1];
    return {
      peers: peers != null ? Number(peers) : null,
      uptime: uptime ?? null,
    };
  }

  // --- managed settings ---------------------------------------------------

  async #editConf(file, edits) {
    let path = PathUtils.join(this.dir, file);
    let text = await IOUtils.readUTF8(path);
    for (let [section, key, value] of edits) {
      text = setConfKey(text, section, key, value);
    }
    await IOUtils.writeUTF8(path, text);
  }

  /**
   * Relay switch (§3.6). Returns "applied" or "restart" (the running version
   * has no console command, so the change waits for a restart).
   */
  async setRelay(on) {
    await this.#editConf("i2pd.conf", [["", "notransit", on ? "false" : "true"]]);
    await lazy.NullpathRouterConfig.update(c => {
      c.managed.relay = !!on;
    });
    if (!(await this.runningProcess())) {
      return "applied";
    }
    try {
      if (await this.consoleCommand(on ? "enable_transit" : "disable_transit")) {
        return "applied";
      }
    } catch (e) {}
    await this.restart();
    return "restart";
  }

  async setBandwidth(cls) {
    // Low / Medium / High in the Manage subview.
    if (!["L", "O", "P"].includes(cls)) {
      throw new Error("bad bandwidth class");
    }
    await this.#editConf("i2pd.conf", [["", "bandwidth", cls]]);
    await lazy.NullpathRouterConfig.update(c => {
      c.managed.bandwidth = cls;
    });
  }

  async setUpnp(on) {
    await this.#editConf("i2pd.conf", [["upnp", "enabled", on ? "true" : "false"]]);
    await lazy.NullpathRouterConfig.update(c => {
      c.managed.upnp = !!on;
    });
  }

  async setKeepRunning(on) {
    await lazy.NullpathRouterConfig.update(c => {
      c.managed.keepRunningWhenDisconnected = !!on;
    });
  }

  /** Writes the outproxy into the nullpath-publicweb tunnel (§3.5). */
  async setOutproxy(destination) {
    let m = this.settings;
    let path = PathUtils.join(this.dir, "tunnels.conf");
    let text = await IOUtils.readUTF8(path).catch(() => "");
    if (/^\s*\[nullpath-publicweb\]/m.test(text) && destination) {
      text = setConfKey(text, "nullpath-publicweb", "outproxy", destination);
    } else {
      // Keep any tunnels the user added by hand; replace only ours.
      let own = /\n?\[nullpath-publicweb\][\s\S]*?(?=\n\[|$)/;
      text = text.replace(own, "").trimEnd() + "\n";
      if (!text.trim()) {
        text = buildTunnelsConf({ ports: m.ports, outproxy: destination });
      } else if (destination) {
        text += buildTunnelsConf({ ports: m.ports, outproxy: destination }).replace(/^#.*\n/, "");
      }
    }
    await IOUtils.writeUTF8(path, text);
    if (await this.runningProcess()) {
      try {
        await this.consoleCommand("reload_tunnels_config");
      } catch (e) {
        await this.restart();
      }
    }
  }

  /** Remove Nullpath's router (§5.6). */
  async remove() {
    await this.stop();
    await IOUtils.remove(this.dir, { recursive: true, ignoreAbsent: true });
    await lazy.NullpathRouterConfig.update(c => {
      c.managed = null;
      if (c.setup == "managed") {
        c.setup = c.external ? "external" : null;
      }
    });
  }

  async readLogTail(lines = 50) {
    try {
      let text = await IOUtils.readUTF8(PathUtils.join(this.dir, "logs", "i2pd.log"));
      return text.split(/\r?\n/).slice(-lines - 1).join("\n");
    } catch (e) {
      return "";
    }
  }
}

export const NullpathManagedRouter = new ManagedRouter();
