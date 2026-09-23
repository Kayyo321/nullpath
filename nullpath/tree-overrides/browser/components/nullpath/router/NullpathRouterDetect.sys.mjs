/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Local, read-only detection of an existing I2P router (§4.2). It runs only
 * when the setup chooser opens, never at launch, and sends nothing beyond
 * the loopback interface.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  identifyProxy:
    "moz-src:///browser/components/nullpath/router/NullpathLoopback.sys.mjs",
  MANAGED_PORTS:
    "moz-src:///browser/components/nullpath/router/NullpathRouterConfig.sys.mjs",
  probePort:
    "moz-src:///browser/components/nullpath/router/NullpathLoopback.sys.mjs",
});

const LOOPBACK = "127.0.0.1";

export const DEFAULT_PORTS = Object.freeze({
  proxy: 4444,
  javaConsole: 7657,
  i2pdConsole: 7070,
  control: 7650,
});

function envDir(name) {
  try {
    return Services.env.get(name) || null;
  } catch (e) {
    return null;
  }
}

async function readText(path) {
  try {
    return await IOUtils.readUTF8(path);
  } catch (e) {
    return null;
  }
}

/** Reads the [httpproxy] address/port from an i2pd.conf. */
export function parseI2pdConf(text) {
  let section = "";
  let found = {};
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/#.*$/, "").trim();
    let sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      section = sec[1].trim().toLowerCase();
      continue;
    }
    let kv = /^([\w.]+)\s*=\s*(.*)$/.exec(line);
    if (!kv) {
      continue;
    }
    let key = kv[1].toLowerCase();
    if (section == "httpproxy" && (key == "port" || key == "address")) {
      found[key] = kv[2].trim();
    } else if (section == "" && (key == "httpproxy.port" || key == "httpproxy.address")) {
      found[key.split(".")[1]] = kv[2].trim();
    } else if (section == "http" && key == "port") {
      found.consolePort = kv[2].trim();
    }
  }
  return {
    host: found.address || LOOPBACK,
    port: Number(found.port) || DEFAULT_PORTS.proxy,
    consolePort: Number(found.consolePort) || DEFAULT_PORTS.i2pdConsole,
  };
}

/** Reads listenPort/interface from a Java I2P i2ptunnel config. */
export function parseI2PTunnelConfig(text) {
  let props = {};
  for (let line of text.split(/\r?\n/)) {
    let m = /^\s*([\w.]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) {
      props[m[1].replace(/^tunnel\.\d+\./, "")] = m[2];
    }
  }
  if (props.type && props.type != "httpclient") {
    return null;
  }
  let port = Number(props.listenPort);
  if (!port) {
    return null;
  }
  return { host: props.interface || LOOPBACK, port };
}

/**
 * Candidate proxy endpoints from router config files. Never writes to them.
 *
 * Default locations (verify against current installers):
 *  - i2pd:  %APPDATA%\i2pd\i2pd.conf
 *  - Java I2P (Easy Install Bundle): %LOCALAPPDATA%\I2P\i2ptunnel.config.d\
 *  - Java I2P (plain installer):     %APPDATA%\I2P\i2ptunnel.config.d\
 */
async function candidatesFromConfigFiles() {
  let found = [];
  let appData = envDir("APPDATA");
  let localAppData = envDir("LOCALAPPDATA");
  if (appData) {
    let text = await readText(PathUtils.join(appData, "i2pd", "i2pd.conf"));
    if (text) {
      let conf = parseI2pdConf(text);
      found.push({ host: conf.host, port: conf.port, kind: "i2pd", consolePort: conf.consolePort });
    }
  }
  for (let base of [localAppData, appData]) {
    if (!base) {
      continue;
    }
    let dir = PathUtils.join(base, "I2P", "i2ptunnel.config.d");
    let children = [];
    try {
      children = await IOUtils.getChildren(dir);
    } catch (e) {
      continue;
    }
    for (let path of children) {
      if (!/HTTP.?Proxy/i.test(PathUtils.filename(path))) {
        continue;
      }
      let text = await readText(path);
      let ep = text && parseI2PTunnelConfig(text);
      if (ep) {
        found.push({ ...ep, kind: "java-i2p" });
      }
    }
  }
  return found;
}

function isManagedPort(port) {
  return Object.values(lazy.MANAGED_PORTS).includes(port);
}

/**
 * Runs detection.
 *
 * @returns {Promise<{proxy: {host, port}|null, kind: string, consoleURL: string|null, controlURL: string|null, openPorts: object}>}
 */
export async function detectRouter() {
  let [proxyOpen, javaConsole, i2pdConsole, control] = await Promise.all([
    lazy.probePort(LOOPBACK, DEFAULT_PORTS.proxy),
    lazy.probePort(LOOPBACK, DEFAULT_PORTS.javaConsole),
    lazy.probePort(LOOPBACK, DEFAULT_PORTS.i2pdConsole),
    lazy.probePort(LOOPBACK, DEFAULT_PORTS.control),
  ]);

  let candidates = [];
  if (proxyOpen) {
    candidates.push({ host: LOOPBACK, port: DEFAULT_PORTS.proxy, kind: null });
  }
  for (let c of await candidatesFromConfigFiles()) {
    if (!candidates.some(x => x.host == c.host && x.port == c.port)) {
      candidates.push(c);
    }
  }
  // Nullpath's own managed router never appears as the user's router.
  candidates = candidates.filter(c => !isManagedPort(c.port));

  let proxy = null;
  let kindHint = null;
  for (let c of candidates) {
    if ((await lazy.identifyProxy(c)) == "i2p") {
      proxy = { host: c.host, port: c.port };
      kindHint = c.kind;
      break;
    }
  }

  let kind = kindHint ?? (javaConsole ? "java-i2p" : i2pdConsole ? "i2pd" : "other");
  let consoleURL = null;
  if (kind == "java-i2p" && javaConsole) {
    consoleURL = `http://${LOOPBACK}:${DEFAULT_PORTS.javaConsole}/`;
  } else if (kind == "i2pd" && i2pdConsole) {
    consoleURL = `http://${LOOPBACK}:${DEFAULT_PORTS.i2pdConsole}/`;
  }
  let controlURL = null;
  if (kind == "java-i2p" && javaConsole) {
    // Java I2P serves JSON-RPC over plain HTTP on the console port.
    controlURL = `http://${LOOPBACK}:${DEFAULT_PORTS.javaConsole}/jsonrpc/`;
  }
  return {
    proxy,
    kind,
    consoleURL,
    controlURL,
    openPorts: { proxy: proxyOpen, javaConsole, i2pdConsole, control },
  };
}

/** Plain-language result for the "Test" button (§4.3). */
export async function testProxy(endpoint) {
  let result = await lazy.identifyProxy(endpoint);
  return {
    none: "nullpath-router-test-none",
    other: "nullpath-router-test-other",
    i2p: "nullpath-router-test-ok",
  }[result];
}
