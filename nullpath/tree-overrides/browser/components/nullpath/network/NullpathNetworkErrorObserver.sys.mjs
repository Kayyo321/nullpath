/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Tells the router service about proxy connection errors so it checks right
 * away instead of waiting for the next interval (§6.3). Modelled on
 * IPPNetworkErrorObserver. Never records URLs.
 */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = XPCOMUtils.declareLazy({
  Modes: "moz-src:///browser/components/nullpath/network/NullpathProfileMode.sys.mjs",
  NullpathProfileMode:
    "moz-src:///browser/components/nullpath/network/NullpathProfileMode.sys.mjs",
  NullpathRouter:
    "moz-src:///browser/components/nullpath/router/NullpathRouter.sys.mjs",
});

const PROXY_ERRORS = new Set([
  Cr.NS_ERROR_PROXY_CONNECTION_REFUSED,
  Cr.NS_ERROR_UNKNOWN_PROXY_HOST,
  Cr.NS_ERROR_PROXY_BAD_GATEWAY,
  Cr.NS_ERROR_PROXY_GATEWAY_TIMEOUT,
  Cr.NS_ERROR_PROXY_FORBIDDEN,
  Cr.NS_ERROR_PROXY_TOO_MANY_REQUESTS,
]);

const THROTTLE_MS = 5000;

class NetworkErrorObserver {
  QueryInterface = ChromeUtils.generateQI(["nsIObserver", "nsISupportsWeakReference"]);

  #inited = false;
  #last = 0;

  init() {
    if (this.#inited || !lazy.NullpathProfileMode.isI2P) {
      return;
    }
    this.#inited = true;
    Services.obs.addObserver(this, "http-on-stop-request");
    Services.obs.addObserver(this, "http-on-failed-opening-request");
  }

  uninit() {
    if (this.#inited) {
      Services.obs.removeObserver(this, "http-on-stop-request");
      Services.obs.removeObserver(this, "http-on-failed-opening-request");
      this.#inited = false;
    }
  }

  observe(subject) {
    if (!lazy.NullpathRouter.isConnected) {
      return;
    }
    let channel;
    try {
      channel = subject.QueryInterface(Ci.nsIHttpChannel);
    } catch (e) {
      return;
    }
    let failed = PROXY_ERRORS.has(channel.status);
    if (!failed) {
      try {
        let code = channel.QueryInterface(Ci.nsIProxiedChannel).httpProxyConnectResponseCode;
        failed = code >= 500;
      } catch (e) {}
    }
    if (!failed || Date.now() - this.#last < THROTTLE_MS) {
      return;
    }
    this.#last = Date.now();
    let publicWeb = false;
    if (lazy.NullpathProfileMode.mode == lazy.Modes.PUBLIC_WEB) {
      try {
        publicWeb = !/(^|\.)i2p$/i.test(channel.URI.host);
      } catch (e) {}
    }
    lazy.NullpathRouter.onProxyError({ publicWeb });
  }
}

export const NullpathNetworkErrorObserver = new NetworkErrorObserver();
