/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The router service: application-wide on/off, connecting stages, health
 * checks and "Needs attention" reasons (I2P-ROUTER-TOGGLE.md §6).
 *
 * One instance per Nullpath process (each profile is its own process). The
 * shared desired state lives in state.json (§7.3); each process follows it
 * and runs its own checks. Observers are told about every change through the
 * "nullpath-router-state-changed" topic.
 */

import { setTimeout, clearTimeout, setInterval, clearInterval } from "resource://gre/modules/Timer.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AsyncShutdown: "resource://gre/modules/AsyncShutdown.sys.mjs",
  NullpathManagedRouter:
    "moz-src:///browser/components/nullpath/router/NullpathManagedRouter.sys.mjs",
  NullpathRouterConfig:
    "moz-src:///browser/components/nullpath/router/NullpathRouterConfig.sys.mjs",
  parseEndpoint:
    "moz-src:///browser/components/nullpath/router/NullpathRouterConfig.sys.mjs",
  parseLocalURL:
    "moz-src:///browser/components/nullpath/router/NullpathRouterConfig.sys.mjs",
});
ChromeUtils.defineLazyGetter(lazy, "Loopback", () =>
  ChromeUtils.importESModule(
    "moz-src:///browser/components/nullpath/router/NullpathLoopback.sys.mjs"
  )
);
ChromeUtils.defineLazyGetter(lazy, "logConsole", () =>
  console.createInstance({ prefix: "nullpath.router", maxLogLevel: "Info" })
);

export const TOPIC = "nullpath-router-state-changed";

export const RouterStates = Object.freeze({
  OFF: "off",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  ATTENTION: "attention",
});

export const Reasons = Object.freeze({
  ROUTER_EXITED: "ROUTER_EXITED",
  // i2pd.exe is gone, usually quarantined by antivirus software.
  ROUTER_MISSING: "ROUTER_MISSING",
  PROXY_UNREACHABLE: "PROXY_UNREACHABLE",
  PROXY_NOT_I2P: "PROXY_NOT_I2P",
  START_TIMEOUT: "START_TIMEOUT",
  OUTPROXY_UNREACHABLE: "OUTPROXY_UNREACHABLE",
});

export const Stages = Object.freeze({
  STARTING: "starting",
  PEERS: "peers",
  PROXY: "proxy",
});

const SYNC_INTERVAL_MS = 2000;
const STAGE_POLL_MS = 2000;
const TIMEOUT_FIRST_MANAGED_MS = 10 * 60 * 1000;
const TIMEOUT_MANAGED_MS = 3 * 60 * 1000;
const TIMEOUT_EXTERNAL_MS = 20 * 1000;
const CRASH_WINDOW_MS = 5 * 60 * 1000;

/** The host used to test an outproxy (pref nullpath.i2p.outproxy.testURL). */
function outproxyTarget() {
  let url = Services.prefs.getStringPref(
    "nullpath.i2p.outproxy.testURL",
    "https://github.com/Kayyo321/nullpath"
  );
  try {
    let u = new URL(url);
    return { host: u.hostname, port: Number(u.port) || (u.protocol == "https:" ? 443 : 80), url };
  } catch (e) {
    return { host: "github.com", port: 443, url };
  }
}

class RouterService {
  #inited = false;
  #state = RouterStates.OFF;
  #reason = null;
  #stage = null;
  #desired = "off";
  #desiredChangedAt = 0;
  #syncTimer = null;
  #healthTimer = null;
  #connectRun = 0;
  #failures = 0;
  #lastCrashAt = 0;
  #outproxy = { status: "unknown", checkedAt: 0, httpStatus: 0 };
  #details = null;
  #connectedAt = 0;
  #relayPending = false;
  #checking = false;

  // --- lifecycle ----------------------------------------------------------

  async init() {
    if (this.#inited) {
      return;
    }
    this.#inited = true;
    let config = await lazy.NullpathRouterConfig.load();
    let shared = await lazy.NullpathRouterConfig.registerProcess();
    this.#desired = shared.desired;
    this.#desiredChangedAt = shared.changedAt;

    // A managed i2pd left over from a crashed session is stopped when the
    // desired state is off (§5.5). The browser always starts not connected.
    if (config.managed && this.#desired == "off") {
      await lazy.NullpathManagedRouter.stop().catch(e =>
        lazy.logConsole.error("stopping leftover router failed", e)
      );
    }
    this.#log("init", { desired: this.#desired });
    if (this.#desired == "on") {
      // Another Nullpath profile already turned the router on.
      this.#connect();
    }
    this.#syncTimer = setInterval(() => this.#sync(), SYNC_INTERVAL_MS);

    lazy.AsyncShutdown.profileBeforeChange.addBlocker(
      "Nullpath router: unregister process",
      () => this.#shutdown()
    );
    this.#notify();
  }

  async #shutdown() {
    clearInterval(this.#syncTimer);
    this.#stopHealth();
    this.#connectRun++;
    let last = await lazy.NullpathRouterConfig.unregisterProcess().catch(() => false);
    let managed = lazy.NullpathRouterConfig.config.managed;
    if (last && managed && !managed.keepRunningWhenDisconnected) {
      await lazy.NullpathManagedRouter.stop().catch(() => {});
    }
  }

  /** Follows state.json and router.json written by other profiles. */
  async #sync() {
    try {
      if (await lazy.NullpathRouterConfig.reloadIfChanged()) {
        this.#notify();
      }
      let shared = await lazy.NullpathRouterConfig.readState();
      if (shared.changedAt != this.#desiredChangedAt || shared.desired != this.#desired) {
        this.#desiredChangedAt = shared.changedAt;
        this.#applyDesired(shared.desired);
      }
    } catch (e) {
      lazy.logConsole.error("sync failed", e);
    }
  }

  // --- public state -------------------------------------------------------

  get state() {
    return this.#state;
  }

  get reason() {
    return this.#reason;
  }

  get stage() {
    return this.#stage;
  }

  get desired() {
    return this.#desired;
  }

  get config() {
    return lazy.NullpathRouterConfig.config;
  }

  get setup() {
    return this.config.setup;
  }

  get isConnected() {
    return this.#state == RouterStates.CONNECTED;
  }

  get connectedAt() {
    return this.#connectedAt;
  }

  get details() {
    return this.#details;
  }

  get outproxy() {
    return { ...this.#outproxy };
  }

  get relayPending() {
    return this.#relayPending;
  }

  /** The I2P-sites proxy endpoint, or null when not set up. */
  sitesProxy() {
    let c = this.config;
    if (c.setup == "managed" && c.managed) {
      return { host: "127.0.0.1", port: c.managed.ports.sites };
    }
    if (c.setup == "external" && c.external) {
      return lazy.parseEndpoint(c.external.sitesProxy, { allowLan: !!c.external.allowLan });
    }
    return null;
  }

  /** The public-web proxy endpoint, or null when no outproxy is configured. */
  publicWebProxy() {
    let c = this.config;
    if (c.setup == "managed" && c.managed && c.outproxy?.destination && c.outproxy.acknowledged) {
      return { host: "127.0.0.1", port: c.managed.ports.publicWeb };
    }
    if (c.setup == "external" && c.external?.publicWebProxy && c.outproxy?.acknowledged) {
      return lazy.parseEndpoint(c.external.publicWebProxy, { allowLan: !!c.external.allowLan });
    }
    return null;
  }

  consoleURL() {
    let c = this.config;
    if (c.setup == "managed") {
      return lazy.NullpathManagedRouter.consoleURL();
    }
    if (c.setup == "external" && c.external?.consoleURL) {
      try {
        return lazy.parseLocalURL(c.external.consoleURL, { allowLan: !!c.external.allowLan }).href;
      } catch (e) {}
    }
    return null;
  }

  /**
   * Whether Public web via I2P can load pages right now (§7.4 step 2).
   *
   * @returns {"ready"|"not-connected"|"connecting"|"no-outproxy"|"outproxy-unreachable"}
   */
  publicWebReadiness() {
    if (this.#state == RouterStates.CONNECTING) {
      return "connecting";
    }
    if (!this.isConnected) {
      return "not-connected";
    }
    if (!this.publicWebProxy()) {
      return "no-outproxy";
    }
    return this.#outproxy.status == "ok" ? "ready" : "outproxy-unreachable";
  }

  // --- switch -------------------------------------------------------------

  /** The On/Off switch (§3.3). Writes the application-wide desired state. */
  async setEnabled(on) {
    if (on && !this.setup) {
      throw new Error("No router set up");
    }
    let shared = await lazy.NullpathRouterConfig.setDesired(on ? "on" : "off");
    this.#desiredChangedAt = shared.changedAt;
    this.#applyDesired(shared.desired);
  }

  #applyDesired(desired) {
    if (desired == this.#desired && (desired == "off") == (this.#state == RouterStates.OFF)) {
      return;
    }
    this.#desired = desired;
    this.#log("desired", { desired });
    if (desired == "on") {
      this.#connect();
    } else {
      this.#disconnect();
    }
  }

  async #disconnect() {
    this.#connectRun++;
    this.#stopHealth();
    this.#setState(RouterStates.OFF);
    let c = this.config;
    if (c.setup == "managed" && c.managed && !c.managed.keepRunningWhenDisconnected) {
      await lazy.NullpathManagedRouter.stop().catch(e =>
        lazy.logConsole.error("stop failed", e)
      );
    }
  }

  /** "Retry", "Restart router" and "Keep waiting" actions. */
  async retry({ restart = false } = {}) {
    if (this.#desired != "on") {
      return this.setEnabled(true);
    }
    if (restart && this.setup == "managed") {
      this.#lastCrashAt = 0;
      await lazy.NullpathManagedRouter.restart().catch(() => {});
    }
    this.#connect();
    return undefined;
  }

  // --- connecting (§6.2) --------------------------------------------------

  async #connect() {
    let run = ++this.#connectRun;
    this.#stopHealth();
    this.#failures = 0;
    this.#details = null;
    let c = this.config;
    if (!c.setup) {
      this.#setState(RouterStates.OFF);
      return;
    }
    let managed = c.setup == "managed";
    let timeout = managed
      ? c.managed.firstStartDone
        ? TIMEOUT_MANAGED_MS
        : TIMEOUT_FIRST_MANAGED_MS
      : TIMEOUT_EXTERNAL_MS;
    let deadline = Date.now() + timeout;
    let alive = () => run == this.#connectRun;
    let sleep = () => new Promise(r => setTimeout(r, STAGE_POLL_MS));

    try {
      if (managed) {
        this.#setState(RouterStates.CONNECTING, null, Stages.STARTING);
        let proc = await lazy.NullpathManagedRouter.start();
        let consolePort = c.managed.ports.console;
        while (alive()) {
          if (!(await lazy.NullpathManagedRouter.runningProcess())) {
            return this.#routerExited(proc);
          }
          if (await lazy.Loopback.probePort("127.0.0.1", consolePort, 1000)) {
            break;
          }
          if (Date.now() > deadline) {
            return this.#setState(RouterStates.ATTENTION, Reasons.START_TIMEOUT);
          }
          await sleep();
        }
        this.#setState(RouterStates.CONNECTING, null, Stages.PEERS);
        while (alive()) {
          let d = await lazy.NullpathManagedRouter.details().catch(() => null);
          if (!d || d.peers == null || d.peers > 0) {
            // No peer count available: don't block on it.
            break;
          }
          if (Date.now() > deadline) {
            return this.#setState(RouterStates.ATTENTION, Reasons.START_TIMEOUT);
          }
          await sleep();
        }
      } else if (c.external.control) {
        this.#setState(RouterStates.CONNECTING, null, Stages.PEERS);
        while (alive()) {
          let d = await this.#externalDetails();
          if (!d || d.peers == null || d.peers > 0) {
            break;
          }
          if (Date.now() > deadline) {
            return this.#setState(RouterStates.ATTENTION, Reasons.START_TIMEOUT);
          }
          await sleep();
        }
      }

      this.#setState(RouterStates.CONNECTING, null, Stages.PROXY);
      let endpoint = this.sitesProxy();
      while (alive()) {
        let result = await lazy.Loopback.identifyProxy(endpoint);
        if (!alive()) {
          return undefined;
        }
        if (result == "i2p") {
          break;
        }
        if (result == "other") {
          return this.#setState(RouterStates.ATTENTION, Reasons.PROXY_NOT_I2P);
        }
        if (managed && !(await lazy.NullpathManagedRouter.runningProcess())) {
          return this.#routerExited();
        }
        if (Date.now() > deadline) {
          return this.#setState(
            RouterStates.ATTENTION,
            managed ? Reasons.START_TIMEOUT : Reasons.PROXY_UNREACHABLE
          );
        }
        await sleep();
      }
      if (!alive()) {
        return undefined;
      }
      if (managed && !c.managed.firstStartDone) {
        await lazy.NullpathRouterConfig.update(cfg => {
          cfg.managed.firstStartDone = true;
        });
      }
      this.#connectedAt = Date.now();
      this.#setState(RouterStates.CONNECTED);
      this.#startHealth();
      this.refreshDetails();
      if (this.publicWebProxy()) {
        this.checkOutproxy();
      }
    } catch (e) {
      lazy.logConsole.error("connect failed", e);
      if (alive()) {
        let reason = Reasons.PROXY_UNREACHABLE;
        if (managed) {
          reason =
            e.l10nId == "nullpath-setup-error-missing"
              ? Reasons.ROUTER_MISSING
              : Reasons.ROUTER_EXITED;
        }
        this.#setState(RouterStates.ATTENTION, reason);
      }
    }
    return undefined;
  }

  /** Crash handling: restart once, then ask the user (§5.5). */
  async #routerExited() {
    // Antivirus software can quarantine i2pd.exe while it runs. Restarting
    // can't help then, so say so straight away.
    if (!(await lazy.NullpathManagedRouter.exeExists())) {
      this.#setState(RouterStates.ATTENTION, Reasons.ROUTER_MISSING);
      return;
    }
    let now = Date.now();
    if (this.#desired == "on" && now - this.#lastCrashAt > CRASH_WINDOW_MS) {
      this.#lastCrashAt = now;
      this.#log("router exited, restarting once");
      this.#connect();
      return;
    }
    this.#setState(RouterStates.ATTENTION, Reasons.ROUTER_EXITED);
  }

  // --- health (§6.3) ------------------------------------------------------

  #startHealth() {
    this.#stopHealth();
    let sec = Math.max(5, Number(this.config.advanced?.checkIntervalSec) || 15);
    this.#healthTimer = setInterval(() => this.checkNow(), sec * 1000);
  }

  #stopHealth() {
    if (this.#healthTimer) {
      clearInterval(this.#healthTimer);
      this.#healthTimer = null;
    }
  }

  /** Runs one health check. Two failures in a row need attention. */
  async checkNow() {
    if (this.#state != RouterStates.CONNECTED || this.#checking) {
      return;
    }
    this.#checking = true;
    let run = this.#connectRun;
    try {
      let managed = this.setup == "managed";
      if (managed && !(await lazy.NullpathManagedRouter.runningProcess())) {
        this.#stopHealth();
        this.#routerExited();
        return;
      }
      let result = await lazy.Loopback.identifyProxy(this.sitesProxy());
      if (run != this.#connectRun) {
        return;
      }
      if (result == "i2p") {
        this.#failures = 0;
        return;
      }
      if (++this.#failures >= 2) {
        this.#stopHealth();
        this.#setState(
          RouterStates.ATTENTION,
          result == "other" ? Reasons.PROXY_NOT_I2P : Reasons.PROXY_UNREACHABLE
        );
      } else {
        // Re-check soon instead of waiting a whole interval.
        setTimeout(() => this.checkNow(), 2000);
      }
    } finally {
      this.#checking = false;
    }
  }

  /** Called by NullpathNetworkErrorObserver after a proxy connection error. */
  onProxyError({ publicWeb = false } = {}) {
    this.checkNow();
    if (publicWeb) {
      this.checkOutproxy();
    }
  }

  /**
   * Checks the outproxy through the public-web proxy (§3.5). Only a CONNECT
   * request is sent; the target comes from nullpath.i2p.outproxy.testURL.
   */
  async checkOutproxy() {
    let endpoint = this.publicWebProxy();
    if (!endpoint || !this.isConnected) {
      this.#outproxy = { status: endpoint ? "unknown" : "none", checkedAt: Date.now(), httpStatus: 0 };
      this.#notify();
      return this.#outproxy;
    }
    this.#outproxy = { ...this.#outproxy, status: "checking" };
    this.#notify();
    let { ok, status } = await lazy.Loopback.checkOutproxy(endpoint, outproxyTarget());
    this.#outproxy = { status: ok ? "ok" : "unreachable", checkedAt: Date.now(), httpStatus: status };
    this.#log("outproxy check", { ok, status });
    this.#notify();
    return this.#outproxy;
  }

  get outproxyTestURL() {
    return outproxyTarget().url;
  }

  // --- details ------------------------------------------------------------

  async #externalDetails() {
    let control = this.config.external?.control;
    if (!control?.url) {
      return null;
    }
    try {
      let url = lazy.parseLocalURL(control.url, { allowLan: !!this.config.external.allowLan });
      let auth = await lazy.Loopback.jsonRpc(url, "Authenticate", {
        API: 1,
        Password: control.password ?? "",
      });
      let info = await lazy.Loopback.jsonRpc(url, "RouterInfo", {
        Token: auth.Token,
        "i2p.router.netdb.knownpeers": null,
        "i2p.router.uptime": null,
      });
      let uptimeMs = Number(info["i2p.router.uptime"]);
      return {
        peers: Number(info["i2p.router.netdb.knownpeers"]) || 0,
        uptime: uptimeMs ? `${Math.round(uptimeMs / 60000)} min` : null,
      };
    } catch (e) {
      return null;
    }
  }

  /** Refreshes peers/uptime for the panel ("Router details: not available"). */
  async refreshDetails() {
    let d = null;
    if (this.setup == "managed") {
      d = await lazy.NullpathManagedRouter.details().catch(() => null);
    } else if (this.setup == "external") {
      d = await this.#externalDetails();
    }
    this.#details = d;
    this.#notify();
    return d;
  }

  // --- managed-router passthroughs used by the panel ----------------------

  async setRelay(on) {
    let result = await lazy.NullpathManagedRouter.setRelay(on);
    this.#relayPending = result == "restart";
    if (this.#relayPending) {
      // The router restarted: reconnect once it's back.
      this.#connect().then(() => {
        this.#relayPending = false;
        this.#notify();
      });
    }
    this.#notify();
    return result;
  }

  // --- internals ----------------------------------------------------------

  #setState(state, reason = null, stage = null) {
    let changed = state != this.#state || reason != this.#reason || stage != this.#stage;
    this.#state = state;
    this.#reason = reason;
    this.#stage = stage;
    if (state != RouterStates.CONNECTED) {
      this.#connectedAt = 0;
    }
    if (changed) {
      this.#log("state", { state, reason, stage });
      this.#notify();
    }
  }

  #notify() {
    Services.obs.notifyObservers(null, TOPIC, this.#state);
  }

  // Never logs page URLs (§6.1).
  #log(msg, data) {
    lazy.logConsole.info(msg, data ?? "");
  }

  /** Test hook: resets in-memory state. */
  _resetForTests() {
    clearInterval(this.#syncTimer);
    this.#stopHealth();
    this.#connectRun++;
    this.#inited = false;
    this.#state = RouterStates.OFF;
    this.#reason = null;
    this.#stage = null;
    this.#desired = "off";
  }
}

export const NullpathRouter = new RouterService();
