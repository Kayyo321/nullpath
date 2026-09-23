/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Shared router settings (router.json) and the application-wide on/off state
 * (state.json). Both live in <UAppData>\i2p\, next to profiles.ini, so every
 * Nullpath profile reads the same files. See I2P-ROUTER-TOGGLE.md §7.2–7.3.
 */

import { FileUtils } from "resource://gre/modules/FileUtils.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  NullpathProcess:
    "moz-src:///browser/components/nullpath/router/NullpathProcess.sys.mjs",
});

export const CONFIG_VERSION = 1;

/** The managed router's fixed port block (§5.4). */
export const MANAGED_PORTS = Object.freeze({
  sites: 14444,
  publicWeb: 14450,
  console: 17070,
  control: 17650,
});

function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    setup: null,
    managed: null,
    external: null,
    outproxy: { destination: null, operatorNote: "", acknowledged: false },
    advanced: {
      checkIntervalSec: 15,
      showConsoleLink: true,
      allowLan: false,
    },
  };
}

function sharedDir() {
  let dir = Services.dirsvc.get("UAppData", Ci.nsIFile);
  dir.append("i2p");
  return dir.path;
}

/** %LOCALAPPDATA%\nullpath\i2p-router on Windows. */
export function managedRouterDir() {
  let dir;
  try {
    dir = Services.dirsvc.get("LocalAppData", Ci.nsIFile);
    dir.append("nullpath");
  } catch (e) {
    dir = Services.dirsvc.get("UAppData", Ci.nsIFile);
  }
  dir.append("i2p-router");
  return dir.path;
}

// ---------------------------------------------------------------------------
// Endpoint validation (§4.3, §9)

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function parseIPv4(host) {
  let m = IPV4.exec(host);
  if (!m) {
    return null;
  }
  let octets = m.slice(1).map(Number);
  return octets.every(o => o <= 255) ? octets : null;
}

export function isLoopbackHost(host) {
  host = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (host == "::1" || host == "localhost") {
    return true;
  }
  let v4 = parseIPv4(host);
  return !!v4 && v4[0] == 127;
}

export function isPrivateHost(host) {
  host = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (isLoopbackHost(host)) {
    return true;
  }
  let v4 = parseIPv4(host);
  if (v4) {
    let [a, b] = v4;
    return (
      a == 10 ||
      a == 0 ||
      (a == 172 && b >= 16 && b <= 31) ||
      (a == 192 && b == 168) ||
      (a == 169 && b == 254) ||
      (a == 100 && b >= 64 && b <= 127)
    );
  }
  // IPv6 unique-local, link-local and v4-mapped private ranges.
  if (host.includes(":")) {
    return (
      /^f[cd][0-9a-f]{2}:/.test(host) ||
      /^fe[89ab][0-9a-f]:/.test(host) ||
      host == "::" ||
      /^::ffff:/.test(host)
    );
  }
  return false;
}

/**
 * Parses "ip:port". Returns { host, port } or throws an Error whose message
 * is a Fluent id from router.ftl.
 *
 * Hostnames are rejected because DNS is disabled in I2P profiles (§8.2).
 */
export function parseEndpoint(value, { allowLan = false } = {}) {
  value = String(value ?? "").trim();
  let m = /^(\[[0-9a-fA-F:]+\]|[0-9.]+):(\d{1,5})$/.exec(value);
  if (!m) {
    throw new Error("nullpath-router-error-endpoint-format");
  }
  let host = m[1];
  let port = Number(m[2]);
  if (port < 1 || port > 65535) {
    throw new Error("nullpath-router-error-endpoint-port");
  }
  if (!host.startsWith("[") && !parseIPv4(host)) {
    throw new Error("nullpath-router-error-endpoint-format");
  }
  if (!isLoopbackHost(host)) {
    if (!allowLan) {
      throw new Error("nullpath-router-error-endpoint-not-loopback");
    }
    if (!isPrivateHost(host)) {
      throw new Error("nullpath-router-error-endpoint-not-lan");
    }
  }
  return { host: host.replace(/^\[|\]$/g, ""), port };
}

/**
 * Parses an outproxy destination: an .i2p name or .b32.i2p address, with an
 * optional port. Accepts what people paste from outproxy lists, such as
 * "http://exit.example.i2p/". Returns "host" or "host:port", "" for empty
 * input, or throws an Error whose message is a Fluent id from router.ftl.
 */
export function parseOutproxyDestination(value) {
  value = String(value ?? "").trim();
  if (!value) {
    return "";
  }
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`);
  } catch (e) {
    throw new Error("nullpath-outproxy-error-destination");
  }
  if (
    url.protocol != "http:" ||
    url.username ||
    url.password ||
    url.pathname != "/" ||
    url.search ||
    url.hash ||
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.i2p$/.test(url.hostname)
  ) {
    throw new Error("nullpath-outproxy-error-destination");
  }
  return url.port ? `${url.hostname}:${url.port}` : url.hostname;
}

export function formatEndpoint({ host, port }) {
  return host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
}

/** Validates a console / I2PControl URL: http:// on loopback (or LAN). */
export function parseLocalURL(value, { allowLan = false } = {}) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch (e) {
    throw new Error("nullpath-router-error-url-format");
  }
  if (url.protocol != "http:" || url.username || url.password) {
    throw new Error("nullpath-router-error-url-format");
  }
  let host = url.hostname;
  if (!isLoopbackHost(host) || host == "localhost") {
    if (host == "localhost") {
      throw new Error("nullpath-router-error-url-format");
    }
    if (!allowLan) {
      throw new Error("nullpath-router-error-endpoint-not-loopback");
    }
    if (!isPrivateHost(host)) {
      throw new Error("nullpath-router-error-endpoint-not-lan");
    }
  }
  return url;
}

function sanitizeConfig(raw) {
  let config = defaultConfig();
  if (!raw || typeof raw != "object" || raw.version != CONFIG_VERSION) {
    return config;
  }
  if (["managed", "external"].includes(raw.setup)) {
    config.setup = raw.setup;
  }
  if (raw.managed && typeof raw.managed == "object") {
    config.managed = raw.managed;
  }
  if (raw.external && typeof raw.external == "object") {
    let allowLan = !!raw.external.allowLan;
    try {
      parseEndpoint(raw.external.sitesProxy, { allowLan });
      if (raw.external.publicWebProxy) {
        parseEndpoint(raw.external.publicWebProxy, { allowLan });
      }
      config.external = raw.external;
    } catch (e) {
      // A hand-edited file with an invalid endpoint is ignored, not trusted.
      console.error("nullpath.router: ignoring invalid external setup", e);
    }
  }
  if (raw.outproxy && typeof raw.outproxy == "object") {
    Object.assign(config.outproxy, raw.outproxy);
  }
  if (raw.advanced && typeof raw.advanced == "object") {
    Object.assign(config.advanced, raw.advanced);
  }
  if (config.setup && !config[config.setup]) {
    config.setup = null;
  }
  return config;
}

// ---------------------------------------------------------------------------

class RouterConfigStore {
  #config = null;
  #lastMtime = 0;

  get dir() {
    return sharedDir();
  }

  get configPath() {
    return PathUtils.join(this.dir, "router.json");
  }

  get statePath() {
    return PathUtils.join(this.dir, "state.json");
  }

  /** The cached config. Call load() first. */
  get config() {
    return this.#config ?? defaultConfig();
  }

  async load() {
    let raw = null;
    try {
      raw = await IOUtils.readJSON(this.configPath);
      this.#lastMtime = (await IOUtils.stat(this.configPath)).lastModified;
    } catch (e) {
      if (!DOMException.isInstance(e) || e.name != "NotFoundError") {
        console.error("nullpath.router: cannot read router.json", e);
      }
    }
    this.#config = sanitizeConfig(raw);
    return this.#config;
  }

  /**
   * Synchronous load for early startup, where the proxy prefs must be set
   * before anything can open a channel (§8.2).
   */
  loadSync() {
    let raw = null;
    try {
      let file = new FileUtils.File(this.configPath);
      if (file.exists()) {
        raw = JSON.parse(Cu.readUTF8File(file));
        this.#lastMtime = file.lastModifiedTime;
      }
    } catch (e) {
      console.error("nullpath.router: cannot read router.json", e);
    }
    this.#config = sanitizeConfig(raw);
    return this.#config;
  }

  /** Reloads when another profile's process changed the file. */
  async reloadIfChanged() {
    try {
      let { lastModified } = await IOUtils.stat(this.configPath);
      if (lastModified != this.#lastMtime) {
        await this.load();
        return true;
      }
    } catch (e) {}
    return false;
  }

  /**
   * Applies `mutator` to a fresh copy of the config and writes it atomically.
   * Only the parent process may call this (§9).
   */
  async update(mutator) {
    if (Services.appinfo.processType != Services.appinfo.PROCESS_TYPE_DEFAULT) {
      throw new Error("router.json is written by the parent process only");
    }
    await this.load();
    let next = structuredClone(this.#config);
    await mutator(next);
    next = sanitizeConfig(next);
    await IOUtils.makeDirectory(this.dir, { ignoreExisting: true });
    await IOUtils.writeJSON(this.configPath, next, {
      tmpPath: this.configPath + ".tmp",
    });
    this.#config = next;
    this.#lastMtime = (await IOUtils.stat(this.configPath)).lastModified;
    return next;
  }

  // -------------------------------------------------------------------------
  // state.json: { desired, changedAt, processes }

  async readState() {
    try {
      let state = await IOUtils.readJSON(this.statePath);
      return {
        desired: state.desired == "on" ? "on" : "off",
        changedAt: Number(state.changedAt) || 0,
        processes: Array.isArray(state.processes)
          ? state.processes.filter(p => p && Number.isInteger(p.pid))
          : [],
      };
    } catch (e) {
      return { desired: "off", changedAt: 0, processes: [] };
    }
  }

  async #writeState(state) {
    await IOUtils.makeDirectory(this.dir, { ignoreExisting: true });
    await IOUtils.writeJSON(this.statePath, state, {
      tmpPath: this.statePath + ".tmp",
    });
  }

  /**
   * Registers this process and prunes dead ones. When no other Nullpath
   * process is alive, the desired state resets to "off" (§6.1).
   */
  async registerProcess() {
    let state = await this.readState();
    let me = Services.appinfo.processID;
    let alive = state.processes.filter(
      p => p.pid != me && lazy.NullpathProcess.isAlive(p.pid, p.startTime)
    );
    if (!alive.length) {
      state.desired = "off";
      state.changedAt = Date.now();
    }
    alive.push({ pid: me, startTime: lazy.NullpathProcess.startTime(me) });
    state.processes = alive;
    await this.#writeState(state);
    return state;
  }

  /** Returns true when this was the last live Nullpath process. */
  async unregisterProcess() {
    let state = await this.readState();
    let me = Services.appinfo.processID;
    state.processes = state.processes.filter(
      p => p.pid != me && lazy.NullpathProcess.isAlive(p.pid, p.startTime)
    );
    let last = !state.processes.length;
    if (last) {
      state.desired = "off";
    }
    await this.#writeState(state);
    return last;
  }

  async setDesired(desired) {
    let state = await this.readState();
    state.desired = desired == "on" ? "on" : "off";
    state.changedAt = Date.now();
    await this.#writeState(state);
    return state;
  }
}

export const NullpathRouterConfig = new RouterConfigStore();
