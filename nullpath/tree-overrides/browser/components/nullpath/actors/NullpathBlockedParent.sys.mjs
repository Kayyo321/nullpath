/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = XPCOMUtils.declareLazy({
  Modes: "moz-src:///browser/components/nullpath/network/NullpathProfileMode.sys.mjs",
  NullpathProfileMode:
    "moz-src:///browser/components/nullpath/network/NullpathProfileMode.sys.mjs",
  NullpathRouter:
    "moz-src:///browser/components/nullpath/router/NullpathRouter.sys.mjs",
  NullpathRouterWidget:
    "moz-src:///browser/components/nullpath/router/NullpathRouterWidget.sys.mjs",
  VIEWS: "moz-src:///browser/components/nullpath/router/NullpathRouterPanel.sys.mjs",
});

const BLOCKED_PREFIX = "about:nullpath-blocked";

export class NullpathBlockedParent extends JSWindowActorParent {
  #observer = () => this.#sendState();
  #prefObserver = { observe: () => this.#sendState() };

  actorCreated() {
    Services.obs.addObserver(this.#observer, "nullpath-router-state-changed");
    Services.obs.addObserver(this.#observer, "look-and-feel-changed");
    Services.prefs.addObserver("nullpath.appearance", this.#prefObserver);
  }

  didDestroy() {
    Services.obs.removeObserver(this.#observer, "nullpath-router-state-changed");
    Services.obs.removeObserver(this.#observer, "look-and-feel-changed");
    Services.prefs.removeObserver("nullpath.appearance", this.#prefObserver);
  }

  get #browser() {
    return this.browsingContext.top.embedderElement;
  }

  /** The page's own URL, read in the parent (never taken from a message). */
  get #pageParams() {
    let uri = this.browsingContext.currentURI;
    if (!uri?.spec.startsWith(BLOCKED_PREFIX)) {
      return null;
    }
    return new URL(uri.spec).searchParams;
  }

  #sendState() {
    let router = lazy.NullpathRouter;
    try {
      this.sendAsyncMessage("NullpathBlocked:State", {
        connected: router.isConnected,
        connecting: router.state == "connecting",
        publicWeb: router.publicWebReadiness(),
        dark: Services.prefs.getStringPref("nullpath.appearance", "system") == "dark" ||
          (Services.prefs.getStringPref("nullpath.appearance", "system") == "system" &&
            !!this.#browser?.ownerGlobal?.matchMedia?.("(prefers-color-scheme: dark)").matches),
      });
    } catch (e) {
      // The page went away.
    }
  }

  async receiveMessage(message) {
    if (message.name != "NullpathBlocked:Action") {
      return;
    }
    let params = this.#pageParams;
    let browser = this.#browser;
    if (!params || !browser) {
      return;
    }
    let win = browser.documentGlobal;
    let blockedURL = params.get("u");
    switch (message.data.action) {
      case "get-state":
        this.#sendState();
        break;
      case "open-panel":
        lazy.NullpathRouterWidget.openPanel(win);
        break;
      case "outproxy-settings":
        lazy.NullpathRouterWidget.openSubView(win, lazy.VIEWS.OUTPROXY);
        break;
      case "connect":
        if (!lazy.NullpathRouter.setup) {
          lazy.NullpathRouterWidget.openPanel(win);
        } else {
          await lazy.NullpathRouter.setEnabled(true);
        }
        break;
      case "retry":
        if (params.get("reason") == "outproxy-unreachable" || params.get("kind") == "outproxy-unavailable") {
          lazy.NullpathRouter.checkOutproxy();
        }
        if (blockedURL && /^https?:/i.test(blockedURL)) {
          // Loading it again runs it through the request blocker, which
          // hands it off, shows this page again or lets it through.
          browser.loadURI(Services.io.newURI(blockedURL), {
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
          });
        }
        break;
      case "go-back":
        if (browser.canGoBack) {
          browser.goBack();
        } else {
          browser.loadURI(Services.io.newURI("about:newtab"), {
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
          });
        }
        break;
      case "switch-window":
        lazy.NullpathProfileMode.openInMode(lazy.Modes.PUBLIC_WEB);
        break;
    }
  }
}
