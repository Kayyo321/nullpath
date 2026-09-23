/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The primary fail-closed layer (§8.4) and the public-web hand-off (§7.4).
 *
 * Observes every HTTP channel in the parent process of an I2P profile
 * (including WebSocket upgrades, service worker and extension requests,
 * downloads, and each redirect hop) and cancels anything the mode doesn't
 * allow. Top-level loads get a Nullpath page that explains why; subresources
 * fail silently. Whatever gets past this still meets the channel filter
 * (§8.3) and then a proxy with no outproxy.
 */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = XPCOMUtils.declareLazy({
  isLoopbackHost:
    "moz-src:///browser/components/nullpath/router/NullpathRouterConfig.sys.mjs",
  isPrivateHost:
    "moz-src:///browser/components/nullpath/router/NullpathRouterConfig.sys.mjs",
  isSetupDownloadChannel:
    "moz-src:///browser/components/nullpath/router/NullpathManagedRouter.sys.mjs",
  Modes: "moz-src:///browser/components/nullpath/network/NullpathProfileMode.sys.mjs",
  NullpathProfileMode:
    "moz-src:///browser/components/nullpath/network/NullpathProfileMode.sys.mjs",
  NullpathRouter:
    "moz-src:///browser/components/nullpath/router/NullpathRouter.sys.mjs",
});

export const BLOCKED_PAGE = "about:nullpath-blocked";

/** Page kinds shown by about:nullpath-blocked. */
export const Kinds = Object.freeze({
  NOT_CONNECTED: "not-connected",
  CANT_OPEN: "cant-open", // §7.4 step 4, with a readiness reason
  HANDED_OFF: "handed-off", // §7.4 step 3
  FORM_BLOCKED: "form-blocked",
  OUTPROXY: "outproxy-unavailable",
  LOCAL: "local-blocked",
});

const LOCAL_SCHEMES = new Set(["about", "chrome", "resource", "moz-extension", "blob", "data"]);
const NETWORK_SCHEMES = new Set(["http", "https", "ws", "wss"]);

function isI2PHost(host) {
  host = host.toLowerCase().replace(/\.$/, "");
  return host == "i2p" || host.endsWith(".i2p");
}

function isLocalAddress(host) {
  host = host.toLowerCase();
  return (
    host == "localhost" ||
    host.endsWith(".localhost") ||
    lazy.isLoopbackHost(host) ||
    lazy.isPrivateHost(host)
  );
}

/**
 * Pure decision for one request (the §8.4 table). Exported for tests.
 *
 * @param {object} r
 * @param {string} r.mode           "i2p-sites" | "i2p-publicweb"
 * @param {boolean} r.connected     router state is Connected
 * @param {string} r.scheme
 * @param {string} r.host
 * @param {boolean} r.topLevel      top-level document load
 * @param {string} r.method
 * @param {boolean} r.isConsole     URL is on the configured console origin
 * @param {boolean} r.userStarted   started by the user (system triggering principal)
 * @param {boolean} r.fromConsole   started by a console page (its links,
 *                                  forms, refreshes and subresources)
 * @param {string} r.publicWeb      NullpathRouter.publicWebReadiness()
 * @returns {{allow: boolean, kind?: string, reason?: string, handoff?: boolean}}
 */
export function decide(r) {
  if (LOCAL_SCHEMES.has(r.scheme)) {
    return { allow: true };
  }
  if (!NETWORK_SCHEMES.has(r.scheme)) {
    return { allow: false, kind: Kinds.LOCAL };
  }
  if (isLocalAddress(r.host)) {
    // The router console opens from the panel, and once open it can use
    // itself. Nothing else reaches it: an I2P site can't load, frame or post
    // to it.
    if (r.isConsole && ((r.topLevel && r.userStarted) || r.fromConsole)) {
      return { allow: true };
    }
    return { allow: false, kind: Kinds.LOCAL };
  }
  let i2p = isI2PHost(r.host);
  if (r.mode == "i2p-sites" && !i2p) {
    // Public-web address in an I2P sites window (§7.4).
    if (!r.topLevel) {
      return { allow: false };
    }
    if (r.method != "GET" && r.method != "HEAD") {
      return { allow: false, kind: Kinds.FORM_BLOCKED };
    }
    if (r.publicWeb == "ready") {
      return { allow: false, handoff: true };
    }
    return { allow: false, kind: Kinds.CANT_OPEN, reason: r.publicWeb };
  }
  if (!r.connected) {
    return { allow: false, kind: Kinds.NOT_CONNECTED };
  }
  if (r.mode == "i2p-publicweb" && !i2p && r.publicWeb != "ready") {
    return { allow: false, kind: Kinds.OUTPROXY, reason: r.publicWeb };
  }
  return { allow: true };
}

export function blockedPageURL(kind, url, reason = "") {
  let params = new URLSearchParams({ kind });
  if (reason) {
    params.set("reason", reason);
  }
  if (url) {
    params.set("u", url);
  }
  return `${BLOCKED_PAGE}?${params}`;
}

class RequestBlocker {
  QueryInterface = ChromeUtils.generateQI(["nsIObserver", "nsISupportsWeakReference"]);

  #inited = false;

  init() {
    if (this.#inited || !lazy.NullpathProfileMode.isI2P) {
      return;
    }
    this.#inited = true;
    Services.obs.addObserver(this, "http-on-opening-request");
    Services.obs.addObserver(this, "http-on-modify-request");
  }

  uninit() {
    if (this.#inited) {
      Services.obs.removeObserver(this, "http-on-opening-request");
      Services.obs.removeObserver(this, "http-on-modify-request");
      this.#inited = false;
    }
  }

  observe(subject) {
    let channel;
    try {
      channel = subject.QueryInterface(Ci.nsIHttpChannel);
    } catch (e) {
      return;
    }
    if (channel.canceled || lazy.isSetupDownloadChannel(channel)) {
      return;
    }
    let uri = channel.URI;
    let loadInfo = channel.loadInfo;
    let topLevel = !!loadInfo?.isTopLevelLoad && loadInfo.externalContentPolicyType == Ci.nsIContentPolicy.TYPE_DOCUMENT;
    let host = "";
    try {
      host = uri.host;
    } catch (e) {}
    let consoleURL = lazy.NullpathRouter.consoleURL();
    let consoleOrigin = consoleURL ? new URL(consoleURL).origin : null;
    let decision = decide({
      mode: lazy.NullpathProfileMode.mode,
      connected: lazy.NullpathRouter.isConnected,
      scheme: uri.scheme,
      host,
      topLevel,
      method: channel.requestMethod,
      isConsole: !!consoleOrigin && uri.prePath == consoleOrigin,
      userStarted: !!loadInfo?.triggeringPrincipal?.isSystemPrincipal,
      // originNoSuffix: private windows add "^privateBrowsingId=1" to origin.
      fromConsole: !!consoleOrigin && loadInfo?.triggeringPrincipal?.originNoSuffix == consoleOrigin,
      publicWeb: lazy.NullpathRouter.publicWebReadiness(),
    });
    if (decision.allow) {
      return;
    }
    channel.cancel(topLevel ? Cr.NS_BINDING_ABORTED : Cr.NS_ERROR_BLOCKED_BY_POLICY);
    if (!topLevel) {
      return;
    }
    let browser = this.#browserFor(loadInfo);
    if (!browser) {
      return;
    }
    let url = uri.spec;
    // Let the cancellation settle before loading something else.
    Services.tm.dispatchToMainThread(() => {
      if (decision.handoff) {
        this.#handOff(browser, url);
      } else {
        this.#showPage(browser, blockedPageURL(decision.kind, url, decision.reason));
      }
    });
    if (lazy.NullpathProfileMode.mode == lazy.Modes.PUBLIC_WEB && decision.kind == Kinds.OUTPROXY) {
      lazy.NullpathRouter.checkOutproxy();
    }
  }

  #browserFor(loadInfo) {
    let bc = loadInfo?.targetBrowsingContext ?? loadInfo?.browsingContext;
    return bc?.top?.embedderElement ?? null;
  }

  #showPage(browser, pageURL) {
    browser.loadURI(Services.io.newURI(pageURL), {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
  }

  /**
   * §7.4 step 3: opens the URL in a Public web via I2P window. A blank tab
   * that did nothing else is closed; otherwise the tab says where it went.
   */
  async #handOff(browser, url) {
    let opened = await lazy.NullpathProfileMode.openInMode(lazy.Modes.PUBLIC_WEB, url).catch(() => false);
    if (!opened) {
      this.#showPage(browser, blockedPageURL(Kinds.CANT_OPEN, url, "no-profile"));
      return;
    }
    let win = browser.documentGlobal;
    let tab = win.gBrowser?.getTabForBrowser(browser);
    let blank =
      tab &&
      win.gBrowser.tabs.length > 1 &&
      !browser.canGoBack &&
      (browser.currentURI.spec == "about:blank" ||
        browser.currentURI.spec == "about:newtab" ||
        browser.currentURI.spec == "about:home");
    if (blank) {
      win.gBrowser.removeTab(tab);
      return;
    }
    this.#showPage(browser, blockedPageURL(Kinds.HANDED_OFF, url));
  }
}

export const NullpathRequestBlocker = new RequestBlocker();
