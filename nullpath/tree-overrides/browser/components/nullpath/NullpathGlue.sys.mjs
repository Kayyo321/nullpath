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
  MODE_L10N: "moz-src:///browser/components/nullpath/network/NullpathProfileMode.sys.mjs",
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

const BANNER_ID = "nullpath-not-connected";
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
    this.maybeShowBanner(win);
  },

  /**
   * Labels the window with its mode: a text chip with an icon at the top of
   * the vertical tab strip, and an attribute for mode-specific styling
   * (§10). The window title already carries the profile name.
   */
  labelWindow(win) {
    let doc = win.document;
    let mode = lazy.NullpathProfileMode.mode;
    doc.documentElement.setAttribute("nullpath-mode", mode);
    if (doc.getElementById("nullpath-mode-chip")) {
      return;
    }
    let chip = doc.createXULElement("hbox");
    chip.id = "nullpath-mode-chip";
    chip.setAttribute("role", "note");
    let icon = doc.createElementNS("http://www.w3.org/1999/xhtml", "img");
    icon.src = `chrome://browser/skin/nullpath/mode-${mode == lazy.Modes.SITES ? "sites" : mode == lazy.Modes.PUBLIC_WEB ? "publicweb" : "direct"}.svg`;
    icon.alt = "";
    let label = doc.createXULElement("label");
    doc.l10n.setAttributes(label, lazy.MODE_L10N[mode]);
    chip.append(icon, label);
    doc.getElementById("vertical-tabs")?.prepend(chip);
  },

  /**
   * The first I2P sites window says it isn't connected (§7.1). The banner
   * goes away once the router connects.
   */
  maybeShowBanner(win) {
    if (lazy.NullpathProfileMode.mode == lazy.Modes.DIRECT || lazy.NullpathRouter.isConnected) {
      return;
    }
    let box = win.gNotificationBox;
    if (!box || box.getNotificationWithValue(BANNER_ID)) {
      return;
    }
    win.MozXULElement?.insertFTLIfNeeded("browser/nullpath/router.ftl");
    box.appendNotification(
      BANNER_ID,
      {
        label: { "l10n-id": "nullpath-banner-not-connected" },
        priority: box.PRIORITY_INFO_MEDIUM,
      },
      [
        {
          "l10n-id": "nullpath-blocked-open-panel",
          callback: () => {
            lazy.NullpathRouterWidget.openPanel(win);
            return true;
          },
        },
      ]
    );
    let observer = () => {
      if (lazy.NullpathRouter.isConnected || win.closed) {
        box.getNotificationWithValue(BANNER_ID)?.close();
        Services.obs.removeObserver(observer, "nullpath-router-state-changed");
      }
    };
    Services.obs.addObserver(observer, "nullpath-router-state-changed");
  },
};
