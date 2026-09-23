/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The router button at the top right of every window (§2), modelled on
 * IPProtection.sys.mjs. It can't be removed, never overflows, and is put
 * back at the end of the navigation bar at every startup.
 */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = XPCOMUtils.declareLazy({
  CustomizableUI:
    "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs",
  createPanelView:
    "moz-src:///browser/components/nullpath/router/NullpathRouterPanel.sys.mjs",
  NullpathRouter:
    "moz-src:///browser/components/nullpath/router/NullpathRouter.sys.mjs",
  NullpathRouterPanel:
    "moz-src:///browser/components/nullpath/router/NullpathRouterPanel.sys.mjs",
  VIEWS: "moz-src:///browser/components/nullpath/router/NullpathRouterPanel.sys.mjs",
});

const WIDGET_ID = "nullpath-router-button";
const URLBAR_ICON_ID = "nullpath-router-urlbar-button";
const STYLESHEET = "chrome://browser/content/nullpath/router-panel.css";
const FTL = "browser/nullpath/router.ftl";
const PANEL_OPENED_PREF = "nullpath.router.panelOpened";
const STATES = ["off", "connecting", "connected", "attention"];

const SUBVIEW_TITLES = {
  "nullpath-router-settings": "nullpath-view-settings",
  "nullpath-router-manage": "nullpath-view-manage",
  "nullpath-router-own": "nullpath-view-own",
  "nullpath-router-outproxy": "nullpath-view-outproxy",
  "nullpath-router-advanced": "nullpath-view-advanced",
  "nullpath-router-whatis": "nullpath-view-whatis",
};

class RouterWidget {
  #inited = false;
  #panels = new WeakMap();
  #observer = () => this.#updateAllButtons();

  init() {
    if (this.#inited) {
      return;
    }
    this.#inited = true;
    lazy.CustomizableUI.createWidget({
      id: WIDGET_ID,
      type: "view",
      viewId: lazy.VIEWS.MAIN,
      l10nId: "nullpath-router-button-off",
      defaultArea: lazy.CustomizableUI.AREA_NAVBAR,
      removable: false,
      overflows: false,
      showInPrivateBrowsing: true,
      onBeforeCreated: doc => this.#prepareWindow(doc),
      onCreated: node => this.#onCreated(node),
      onViewShowing: e => this.#panelFor(e.target.documentGlobal)?.showing(e.target),
      onViewHiding: () => {},
    });
    Services.obs.addObserver(this.#observer, "nullpath-router-state-changed");
  }

  /**
   * Places the button last in the navigation bar, just left of the
   * extensions and ☰ buttons, which live outside the customizable
   * placements. Runs at every startup, so a moved button goes back (§2.1).
   *
   * Called once the first window is ready: on a new profile, moving
   * placements earlier races CustomizableUI's own first-run layout (and
   * the vertical-tabs toolbar setup) and scrambles the navigation bar.
   */
  place() {
    let CUI = lazy.CustomizableUI;
    let placement = CUI.getPlacementOfWidget(WIDGET_ID, false, true);
    if (!placement || placement.area != CUI.AREA_NAVBAR) {
      CUI.addWidgetToArea(WIDGET_ID, CUI.AREA_NAVBAR);
    }
    let count = CUI.getWidgetIdsInArea(CUI.AREA_NAVBAR).length;
    CUI.moveWidgetWithinArea(WIDGET_ID, count);
  }

  /** Stylesheet, strings and panelviews for a new window. */
  #prepareWindow(doc) {
    let win = doc.documentGlobal;
    if (!doc.getElementById("nullpath-router-stylesheet")) {
      let link = doc.createElementNS("http://www.w3.org/1999/xhtml", "link");
      link.id = "nullpath-router-stylesheet";
      link.rel = "stylesheet";
      link.href = STYLESHEET;
      (doc.head ?? doc.documentElement).append(link);
    }
    win.MozXULElement?.insertFTLIfNeeded(FTL);
    let cache = doc.getElementById("appMenu-viewCache");
    let container = cache?.content ?? doc.getElementById("appMenu-multiView");
    if (!container || this.#panels.has(win)) {
      return;
    }
    let panel = new lazy.NullpathRouterPanel(win);
    this.#panels.set(win, panel);
    let views = [
      lazy.createPanelView(doc, lazy.VIEWS.MAIN, null, { main: true }),
      ...Object.entries(SUBVIEW_TITLES).map(([id, title]) =>
        lazy.createPanelView(doc, id, title)
      ),
    ];
    for (let view of views) {
      if (view.id != lazy.VIEWS.MAIN) {
        view.addEventListener("ViewShowing", e => panel.showing(e.target));
      } else {
        view.addEventListener("ViewHiding", () => panel.hiding());
      }
      container.append(view);
    }
    win.addEventListener("unload", () => panel.uninit(), { once: true });
  }

  #panelFor(win) {
    return this.#panels.get(win);
  }

  #onCreated(node) {
    let win = node.documentGlobal;
    // The node isn't in the document yet. Don't use
    // CustomizableUI.getWidget().forWindow() here: CustomizableUI hasn't
    // recorded this node yet, so it would build (and cache) a second one.
    this.updateButton(win, node);
    if (win.document.documentElement.getAttribute("chromehidden")?.includes("toolbar")) {
      this.#addUrlbarButton(win);
    }
  }

  /**
   * Popup windows have no navigation bar, so the control also lives in the
   * URL bar there (§2.1). Same state, same panel.
   */
  #addUrlbarButton(win) {
    let doc = win.document;
    if (doc.getElementById(URLBAR_ICON_ID)) {
      return;
    }
    let identityBox = doc.getElementById("identity-box");
    if (!identityBox) {
      return;
    }
    let button = doc.createXULElement("toolbarbutton");
    button.id = URLBAR_ICON_ID;
    button.className = "nullpath-router-urlbar-button";
    button.setAttribute("tabindex", "0");
    button.addEventListener("command", () => {
      win.PanelUI.showSubView(lazy.VIEWS.MAIN, button);
    });
    identityBox.before(button);
    this.updateButton(win);
  }

  updateButton(win, newNode = null) {
    let router = lazy.NullpathRouter;
    let state = router.state;
    let doc = win.document;
    let nodes = [
      newNode ?? doc.getElementById(WIDGET_ID),
      doc.getElementById(URLBAR_ICON_ID),
    ].filter(Boolean);
    let needsSetup = !router.setup;
    let reason = state == "attention" ? router.reason : null;
    let l10nId = `nullpath-router-button-${state}`;
    if (state == "off" && needsSetup) {
      l10nId = "nullpath-router-button-setup";
    }
    for (let node of nodes) {
      for (let s of STATES) {
        node.classList.toggle(`nullpath-state-${s}`, s == state);
      }
      // Dot badge until the panel has been opened once (§2.2).
      let badge = needsSetup && !Services.prefs.getBoolPref(PANEL_OPENED_PREF, false);
      node.toggleAttribute("nullpath-setup-badge", badge);
      win.document.l10n.setAttributes(node, l10nId, {
        reason: reason ?? "",
      });
    }
  }

  #updateAllButtons() {
    for (let win of Services.wm.getEnumerator("navigator:browser")) {
      if (!win.closed) {
        this.updateButton(win);
      }
    }
  }

  /** Opens the panel in `win` (used by the blocked page's button). */
  openPanel(win) {
    if (!win.PanelUI) {
      return;
    }
    // PanelUI.showSubView needs an anchor that's in the document: a node
    // CustomizableUI built but never placed has no parent and throws there.
    // Fall back to the ☰ button when the router button isn't showing.
    let doc = win.document;
    let anchor = [
      doc.getElementById(WIDGET_ID),
      doc.getElementById(URLBAR_ICON_ID),
      win.PanelUI.menuButton,
    ].find(node => node?.parentNode && node.checkVisibility?.() !== false);
    anchor ??= win.PanelUI.menuButton;
    win.PanelUI.showSubView(lazy.VIEWS.MAIN, anchor);
  }

  /** Opens the panel straight at a subview (e.g. outproxy settings). */
  async openSubView(win, viewId) {
    this.openPanel(win);
    let main = win.document.getElementById(lazy.VIEWS.MAIN);
    let multiView = main?.closest("panelmultiview");
    if (multiView && viewId != lazy.VIEWS.MAIN) {
      await new Promise(r => win.setTimeout(r, 0));
      multiView.showSubView(viewId, main);
    }
  }
}

export const NullpathRouterWidget = new RouterWidget();
