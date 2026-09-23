/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Backstop proxy filter for I2P profiles (§8.3), modelled on
 * IPPChannelFilter. Registered at early startup at the last position, so it
 * runs after every other filter, including extensions' proxy.onRequest. It
 * ignores what they returned, always answers with the mode's proxy and never
 * with a direct connection. The single exception is the guided-setup
 * download (§5.3 step 1).
 */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = XPCOMUtils.declareLazy({
  isSetupDownloadChannel:
    "moz-src:///browser/components/nullpath/router/NullpathManagedRouter.sys.mjs",
  NullpathRouter:
    "moz-src:///browser/components/nullpath/router/NullpathRouter.sys.mjs",
  NullpathProfileMode:
    "moz-src:///browser/components/nullpath/network/NullpathProfileMode.sys.mjs",
  ProxyService: {
    service: "@mozilla.org/network/protocol-proxy-service;1",
    iid: Ci.nsIProtocolProxyService,
  },
});

const LAST_POSITION = 0xffffffff;

/**
 * A top-level load of the configured router console origin connects to the
 * console itself (a loopback connection); the request blocker decides
 * whether it's allowed at all (§3.2, §8.4).
 */
/**
 * The router console goes direct: pages opened in a tab, and whatever a
 * console page loads itself. The request blocker has already cancelled
 * anything else aimed at it.
 */
function isConsoleRequest(channel) {
  let url = lazy.NullpathRouter.consoleURL();
  if (!url) {
    return false;
  }
  try {
    let origin = new URL(url).origin;
    if (channel.URI.prePath != origin) {
      return false;
    }
    let loadInfo = channel.loadInfo;
    return !!loadInfo?.isTopLevelLoad || loadInfo?.triggeringPrincipal?.originNoSuffix == origin;
  } catch (e) {
    return false;
  }
}

class ChannelFilter {
  QueryInterface = ChromeUtils.generateQI(["nsIProtocolProxyChannelFilter"]);

  #registered = false;
  #proxyInfo = null;
  #key = "";

  init() {
    if (this.#registered || !lazy.NullpathProfileMode.isI2P) {
      return;
    }
    lazy.ProxyService.registerChannelFilter(this, LAST_POSITION);
    this.#registered = true;
    Services.obs.addObserver(this, "nullpath-router-state-changed");
  }

  uninit() {
    if (this.#registered) {
      lazy.ProxyService.unregisterChannelFilter(this);
      Services.obs.removeObserver(this, "nullpath-router-state-changed");
      this.#registered = false;
    }
  }

  observe() {
    // Endpoints may have changed; rebuild the proxy info on next use.
    this.#proxyInfo = null;
  }

  /** The mode's proxy as an nsIProxyInfo, with no failover. */
  proxyInfo() {
    let { host, port } = lazy.NullpathProfileMode.proxyEndpoint();
    let key = `${host}:${port}`;
    if (!this.#proxyInfo || this.#key != key) {
      this.#proxyInfo = lazy.ProxyService.newProxyInfo(
        "http",
        host,
        port,
        "",
        "",
        Ci.nsIProxyInfo.TRANSPARENT_PROXY_RESOLVES_HOST,
        0,
        null
      );
      this.#key = key;
    }
    return this.#proxyInfo;
  }

  applyFilter(channel, defaultProxyInfo, callback) {
    if (lazy.isSetupDownloadChannel(channel) || isConsoleRequest(channel)) {
      callback.onProxyFilterResult(null);
      return;
    }
    callback.onProxyFilterResult(this.proxyInfo());
  }
}

export const NullpathChannelFilter = new ChannelFilter();
