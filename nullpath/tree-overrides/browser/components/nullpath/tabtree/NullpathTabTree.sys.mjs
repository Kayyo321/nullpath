/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Tree tabs for the vertical tab strip (PROJECT.md default, §10).
 *
 * A tab opened from another tab (its openerTab) becomes that tab's child.
 * The parent is kept in SessionStore tab values, so trees survive restarts.
 * Each tab gets a `nullpath-depth` attribute (capped at 6) that CSS uses for
 * indentation. Parents get a twisty that collapses and expands their
 * children, `aria-expanded`, and ← / → keyboard handling.
 */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = XPCOMUtils.declareLazy({
  SessionStore: "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
  verticalTabs: { pref: "sidebar.verticalTabs", default: false },
});

const MAX_DEPTH = 6;
const KEY_ID = "nullpath-tab-id";
const KEY_PARENT = "nullpath-tab-parent";
const KEY_COLLAPSED = "nullpath-tab-collapsed";
const HIDE_SOURCE = "nullpath-tabtree";
const STYLESHEET = "chrome://browser/content/nullpath/tabtree.css";

function newId() {
  return Math.random().toString(36).slice(2, 12);
}

class WindowTree {
  #win;
  #gBrowser;

  constructor(win) {
    this.#win = win;
    this.#gBrowser = win.gBrowser;
    let container = this.#gBrowser.tabContainer;
    for (let type of ["TabOpen", "TabClose", "TabMove", "SSTabRestoring", "TabAttrModified"]) {
      container.addEventListener(type, this);
    }
    container.addEventListener("keydown", this, { capture: true });
    container.addEventListener("click", this, { capture: true });
    for (let tab of this.#gBrowser.tabs) {
      this.#ensureId(tab);
    }
    this.refresh();
  }

  #value(tab, key) {
    return lazy.SessionStore.getCustomTabValue(tab, key);
  }

  #setValue(tab, key, value) {
    if (value) {
      lazy.SessionStore.setCustomTabValue(tab, key, String(value));
    } else {
      lazy.SessionStore.deleteCustomTabValue(tab, key);
    }
  }

  #ensureId(tab) {
    let id = this.#value(tab, KEY_ID);
    if (!id) {
      id = newId();
      this.#setValue(tab, KEY_ID, id);
    }
    return id;
  }

  #byId() {
    let map = new Map();
    for (let tab of this.#gBrowser.tabs) {
      map.set(this.#value(tab, KEY_ID), tab);
    }
    return map;
  }

  parentOf(tab, map = this.#byId()) {
    let parentId = this.#value(tab, KEY_PARENT);
    return (parentId && map.get(parentId)) || null;
  }

  childrenOf(tab, map = this.#byId()) {
    let id = this.#value(tab, KEY_ID);
    return this.#gBrowser.tabs.filter(t => t != tab && this.#value(t, KEY_PARENT) == id && map.has(id));
  }

  descendantsOf(tab, map = this.#byId()) {
    let out = [];
    for (let child of this.childrenOf(tab, map)) {
      out.push(child, ...this.descendantsOf(child, map));
    }
    return out;
  }

  handleEvent(event) {
    let tab = event.target;
    switch (event.type) {
      case "TabOpen": {
        this.#ensureId(tab);
        let opener = tab.openerTab;
        if (opener && !opener.pinned && opener.documentGlobal == this.#win) {
          this.#setValue(tab, KEY_PARENT, this.#ensureId(opener));
          if (this.#value(opener, KEY_COLLAPSED)) {
            this.setCollapsed(opener, false);
          }
        }
        this.refresh();
        break;
      }
      case "TabClose": {
        // Children move up to the closed tab's parent.
        let map = this.#byId();
        let parentId = this.#value(tab, KEY_PARENT);
        let wasCollapsed = !!this.#value(tab, KEY_COLLAPSED);
        for (let child of this.childrenOf(tab, map)) {
          this.#setValue(child, KEY_PARENT, parentId);
          if (wasCollapsed) {
            this.#gBrowser.showTab(child);
          }
        }
        this.#win.setTimeout(() => this.refresh(), 0);
        break;
      }
      case "SSTabRestoring":
      case "TabMove":
        this.refresh();
        break;
      case "keydown":
        this.#onKeyDown(event);
        break;
      case "click":
        if (event.target.closest?.(".nullpath-twisty")) {
          event.stopPropagation();
          event.preventDefault();
          let t = event.target.closest("tab");
          this.setCollapsed(t, !this.#value(t, KEY_COLLAPSED));
        }
        break;
    }
  }

  #onKeyDown(event) {
    if (!lazy.verticalTabs || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    let tab = event.target.closest?.("tab");
    if (!tab || (event.key != "ArrowLeft" && event.key != "ArrowRight")) {
      return;
    }
    let rtl = this.#win.RTL_UI;
    let collapse = (event.key == "ArrowLeft") != rtl;
    let map = this.#byId();
    let hasChildren = this.childrenOf(tab, map).length > 0;
    let collapsed = !!this.#value(tab, KEY_COLLAPSED);
    if (collapse) {
      if (hasChildren && !collapsed) {
        this.setCollapsed(tab, true);
      } else {
        let parent = this.parentOf(tab, map);
        if (!parent) {
          return;
        }
        this.#gBrowser.tabContainer.ariaFocusedItem = parent;
        parent.focus?.();
      }
    } else if (hasChildren && collapsed) {
      this.setCollapsed(tab, false);
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  setCollapsed(tab, collapsed) {
    this.#setValue(tab, KEY_COLLAPSED, collapsed ? "1" : "");
    this.refresh();
  }

  /** Recomputes depth, twisties, aria and visibility for every tab. */
  refresh() {
    let map = this.#byId();
    let doc = this.#win.document;
    let hiddenByTree = new Set();
    for (let tab of this.#gBrowser.tabs) {
      if (this.#value(tab, KEY_COLLAPSED)) {
        for (let d of this.descendantsOf(tab, map)) {
          hiddenByTree.add(d);
        }
      }
    }
    for (let tab of this.#gBrowser.tabs) {
      let depth = 0;
      let seen = new Set([tab]);
      for (let p = this.parentOf(tab, map); p && !seen.has(p); p = this.parentOf(p, map)) {
        seen.add(p);
        depth++;
      }
      depth = Math.min(depth, MAX_DEPTH);
      tab.setAttribute("nullpath-depth", depth);
      let hasChildren = this.childrenOf(tab, map).length > 0;
      let collapsed = !!this.#value(tab, KEY_COLLAPSED);
      let twisty = tab.querySelector(".nullpath-twisty");
      if (hasChildren) {
        tab.setAttribute("aria-expanded", collapsed ? "false" : "true");
        if (!twisty) {
          twisty = doc.createXULElement("image");
          twisty.className = "nullpath-twisty";
          twisty.setAttribute("role", "presentation");
          tab.querySelector(".tab-content")?.prepend(twisty);
        }
        twisty.toggleAttribute("collapsed-tree", collapsed);
      } else {
        tab.removeAttribute("aria-expanded");
        twisty?.remove();
      }
      if (tab._nullpathLevel != depth + 1) {
        tab._nullpathLevel = depth + 1;
        doc.l10n
          .formatValue("nullpath-tab-level", { level: depth + 1 })
          .then(text => tab.setAttribute("aria-description", text));
      }

      let shouldHide = hiddenByTree.has(tab) && !tab.selected;
      if (shouldHide && !tab.hidden) {
        this.#gBrowser.hideTab(tab, HIDE_SOURCE);
        tab.setAttribute("nullpath-tree-hidden", "true");
      } else if (!shouldHide && tab.hasAttribute("nullpath-tree-hidden")) {
        tab.removeAttribute("nullpath-tree-hidden");
        this.#gBrowser.showTab(tab);
      }
    }
  }
}

const trees = new WeakMap();

export const NullpathTabTree = {
  /** browser-window-delayed-startup */
  onWindowReady(win) {
    if (trees.has(win) || !win.gBrowser) {
      return;
    }
    let doc = win.document;
    let link = doc.createElementNS("http://www.w3.org/1999/xhtml", "link");
    link.rel = "stylesheet";
    link.href = STYLESHEET;
    (doc.head ?? doc.documentElement).append(link);
    win.MozXULElement?.insertFTLIfNeeded("browser/nullpath/router.ftl");
    trees.set(win, new WindowTree(win));
  },

  forWindow(win) {
    return trees.get(win);
  },
};
