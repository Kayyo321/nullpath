/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Startup entry points for Nullpath's router control, called through the
 * browser startup categories in NullpathComponents.manifest (the same
 * mechanism BrowserGlue uses for IP protection).
 */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = XPCOMUtils.declareLazy({
  Modes: "moz-src:///browser/components/nullpath/network/NullpathProfileMode.sys.mjs",
  NullpathChannelFilter:
    "moz-src:///browser/components/nullpath/network/NullpathChannelFilter.sys.mjs",
  NullpathNetworkErrorObserver:
    "moz-src:///browser/components/nullpath/network/NullpathNetworkErrorObserver.sys.mjs",
  NullpathProfileMode:
    "moz-src:///browser/components/nullpath/network/NullpathProfileMode.sys.mjs",
  NullpathRequestBlocker:
    "moz-src:///browser/components/nullpath/network/NullpathRequestBlocker.sys.mjs",
  NullpathRouter:
    "moz-src:///browser/components/nullpath/router/NullpathRouter.sys.mjs",
  NullpathRouterWidget:
    "moz-src:///browser/components/nullpath/router/NullpathRouterWidget.sys.mjs",
  NullpathTabTree:
    "moz-src:///browser/components/nullpath/tabtree/NullpathTabTree.sys.mjs",
});

const VERTICAL_TABS_DONE_PREF = "nullpath.tabtree.verticalTabsSet";

function registerActor() {
  ChromeUtils.registerWindowActor("NullpathBlocked", {
    parent: {
      esModuleURI: "moz-src:///browser/components/nullpath/actors/NullpathBlockedParent.sys.mjs",
    },
    child: {
      esModuleURI: "moz-src:///browser/components/nullpath/actors/NullpathBlockedChild.sys.mjs",
      events: {
        "NullpathBlocked:Action": { wantUntrusted: true },
      },
    },
    matches: ["about:nullpath-blocked", "about:nullpath-blocked?*"],
    allFrames: false,
  });
  ChromeUtils.registerWindowActor("NullpathNewTab", {
    parent: {
      esModuleURI: "moz-src:///browser/components/nullpath/actors/NullpathNewTabParent.sys.mjs",
    },
    child: {
      esModuleURI: "moz-src:///browser/components/nullpath/actors/NullpathNewTabChild.sys.mjs",
      // A window actor is lazy: this real document event creates it for every
      // new-tab/home page. A synthetic message name never did.
      events: {
        DOMDocElementInserted: {},
        DOMContentLoaded: { capture: true },
      },
    },
    matches: ["about:newtab*", "about:home*"],
    remoteTypes: ["privilegedabout"],
    allFrames: false,
  });
}

export const NullpathGlue = {
  /** browser-before-ui-startup: before any window or session restore. */
  beforeUIStartup() {
    try {
      lazy.NullpathProfileMode.initEarly();
      lazy.NullpathRequestBlocker.init();
      lazy.NullpathChannelFilter.init();
      lazy.NullpathNetworkErrorObserver.init();
    } catch (e) {
      // Fail closed: if the network layer can't start, nothing may load.
      console.error("nullpath: network layer failed to start", e);
      Services.io.offline = true;
      Services.io.manageOfflineStatus = false;
    }
    registerActor();
    lazy.NullpathRouter.init().catch(e => console.error("nullpath: router init failed", e));
    lazy.NullpathRouterWidget.init();
  },

  /** browser-first-window-ready */
  firstWindowReady() {
    lazy.NullpathRouterWidget.place();
    // Tree tabs need vertical tabs (§10). Switch them on once per profile,
    // the way the Settings toggle does; the user can turn them off later.
    if (!Services.prefs.getBoolPref(VERTICAL_TABS_DONE_PREF, false)) {
      Services.prefs.setBoolPref(VERTICAL_TABS_DONE_PREF, true);
      Services.prefs.setBoolPref("sidebar.verticalTabs", true);
    }
    lazy.NullpathProfileMode.initProfiles().catch(e =>
      console.error("nullpath: profile setup failed", e)
    );
  },

  /** browser-window-delayed-startup */
  onWindowReady(win) {
    lazy.NullpathTabTree.onWindowReady(win);
    this.labelWindow(win);
    // New-tab actors can miss the first document event during startup.
    // Activating the parent sends the current router state to the page.
    let activateNewTab = () => {
      for (let browser of win.gBrowser?.browsers ?? []) {
        if (["about:newtab", "about:home"].includes(browser.currentURI?.spec)) {
          browser.browsingContext.currentWindowGlobal?.getActor("NullpathNewTab");
        }
      }
    };
    win.gBrowser?.addEventListener("DOMContentLoaded", activateNewTab, true);
    win.addEventListener("unload", () => win.gBrowser?.removeEventListener("DOMContentLoaded", activateNewTab, true), { once: true });
    activateNewTab();
  },

  /**
   * Adds the window's immutable profile mode for chrome-only styling. The
   * profile directory in the sidebar shows the full mode labels.
   */
  labelWindow(win) {
    let doc = win.document;
    let mode = lazy.NullpathProfileMode.mode;
    doc.documentElement.setAttribute("nullpath-mode", mode);
  },

};
