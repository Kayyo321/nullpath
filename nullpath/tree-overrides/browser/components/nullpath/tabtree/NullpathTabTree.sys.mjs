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
  NullpathTabBridge: "moz-src:///browser/components/nullpath/tabtree/NullpathTabBridge.sys.mjs",
  NullpathProfileMode: "moz-src:///browser/components/nullpath/network/NullpathProfileMode.sys.mjs",
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
    new ProfileSidebar(win);
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

const PROFILE_MODES = ["i2p-sites", "i2p-publicweb", "direct"];
const PROFILE_L10N = {
  "i2p-sites": "nullpath-mode-i2p-sites",
  "i2p-publicweb": "nullpath-mode-i2p-publicweb",
  direct: "nullpath-mode-direct",
};
const PROFILE_ICONS = {
  "i2p-sites": "sites",
  "i2p-publicweb": "publicweb",
  direct: "direct",
};

/** Profile directory UI. Remote entries contain only the bridge's allowlist. */
class ProfileSidebar {
  #win;
  #doc;
  #currentMode;
  #profiles = [];
  #root;
  #blockState = new Map();
  #collapsedTabs = new Set();
  #listener = profiles => { this.#profiles = profiles; this.render(); };

  constructor(win) {
    this.#win = win;
    this.#doc = win.document;
    this.#currentMode = lazy.NullpathProfileMode.mode;
    // The native sidebar-main also renders its own tools below the slotted
    // tabstrip. Mount beside it so the two sidebars cannot overlap.
    let host = this.#doc.getElementById("sidebar-container");
    if (!host || host.querySelector("#nullpath-profiles-sidebar")) return;
    this.#root = this.#doc.createXULElement("vbox");
    this.#root.id = "nullpath-profiles-sidebar";
    this.#root.setAttribute("data-expanded", Services.prefs.getBoolPref("nullpath.sidebar.expanded", false));
    for (let mode of PROFILE_MODES) {
      this.#blockState.set(mode, Services.prefs.getBoolPref(`nullpath.sidebar.collapsed.${mode}`, false));
    }
    host.append(this.#root);
    lazy.NullpathTabBridge.addListener(this.#listener);
    win.addEventListener("unload", () => lazy.NullpathTabBridge.removeListener(this.#listener), { once: true });
    this.render();
  }

  #button(label, className, activate, title = "") {
    let button = this.#doc.createXULElement("toolbarbutton");
    button.className = className;
    button.setAttribute("label", label);
    button.setAttribute("tabindex", "0");
    if (title) button.setAttribute("tooltiptext", title);
    button.addEventListener("command", activate);
    return button;
  }

  #icon(mode) {
    let icon = this.#doc.createElementNS("http://www.w3.org/1999/xhtml", "img");
    icon.src = `chrome://browser/skin/nullpath/mode-${PROFILE_ICONS[mode]}.svg`;
    icon.alt = "";
    return icon;
  }

  #focusMode(mode, tab = null) {
    lazy.NullpathTabBridge.command(mode, "focus", tab?.windowId ?? "", tab?.id ?? "");
  }

  #renderBlock(mode) {
    let data = this.#profiles.find(p => p.mode == mode) ?? { mode, count: 0, windows: [] };
    let tabs = data.windows.flatMap(w => w.tabs).sort((a, b) => Number(b.pinned) - Number(a.pinned));
    let current = mode == this.#currentMode;
    let collapsed = this.#blockState.get(mode);
    let block = this.#doc.createXULElement("vbox");
    block.className = "nullpath-profile-block";
    block.setAttribute("data-current", current);
    block.setAttribute("data-collapsed", collapsed);
    let name = this.#doc.createXULElement("label");
    this.#doc.l10n.setAttributes(name, PROFILE_L10N[mode]);
    let count = data.count > 99 ? "99+" : String(data.count);
    let header = this.#doc.createXULElement("toolbarbutton");
    header.id = `nullpath-profile-header-${mode}`;
    header.className = "nullpath-profile-header";
    header.setAttribute("tabindex", "0");
    header.setAttribute("aria-expanded", String(!collapsed));
    this.#doc.l10n.formatValue(PROFILE_L10N[mode]).then(profileName =>
      header.setAttribute("tooltiptext", `${profileName} · ${count} tabs${current ? " · Current profile" : ""}`)
    );
    let iconBox = this.#doc.createXULElement("hbox");
    iconBox.className = "nullpath-profile-icon";
    iconBox.append(this.#icon(mode));
    let badge = this.#doc.createXULElement("label");
    badge.className = "nullpath-profile-count";
    badge.setAttribute("value", count);
    let chevron = this.#doc.createXULElement("image");
    chevron.className = "nullpath-profile-chevron";
    chevron.setAttribute("aria-hidden", "true");
    header.append(iconBox, name, badge, chevron);
    header.addEventListener("command", () => {
      if (!this.#root.getAttribute("data-expanded").includes("true")) {
        this.#root.setAttribute("data-expanded", "true");
        Services.prefs.setBoolPref("nullpath.sidebar.expanded", true);
        if (!current && data.count) this.#focusMode(mode, tabs.find(t => t.selected) ?? tabs[0]);
      } else {
        let next = !this.#blockState.get(mode);
        this.#blockState.set(mode, next);
        Services.prefs.setBoolPref(`nullpath.sidebar.collapsed.${mode}`, next);
        this.render();
      }
    });
    header.addEventListener("keydown", event => {
      if (event.key == "ArrowLeft" || event.key == "ArrowRight") {
        let collapse = event.key == "ArrowLeft";
        this.#blockState.set(mode, collapse);
        Services.prefs.setBoolPref(`nullpath.sidebar.collapsed.${mode}`, collapse);
        this.render();
        event.preventDefault();
      }
    });
    block.append(header);
    if (!collapsed && this.#root.getAttribute("data-expanded") == "true") {
      if (!tabs.length) {
        let empty = this.#doc.createXULElement("label");
        this.#doc.l10n.setAttributes(empty, "nullpath-sidebar-no-tabs");
        empty.className = "nullpath-profile-empty";
        block.append(empty);
      }
      for (let tab of tabs) {
        if (!this.#hiddenByCollapsedAncestor(tab, tabs)) block.append(this.#renderTab(mode, tab, tabs));
      }
      let add = this.#button("+ New tab", "nullpath-profile-newtab", () => lazy.NullpathTabBridge.command(mode, "new", "", "", this.#win));
      block.append(add);
    }
    return block;
  }

  #renderTab(mode, tab, siblings) {
    let row = this.#doc.createXULElement("hbox");
    row.id = `nullpath-profile-tab-${mode}-${tab.id}`;
    row.className = "nullpath-profile-tab";
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.setAttribute("aria-label", `${mode}: ${tab.title}`);
    row.setAttribute("tooltiptext", tab.title);
    row.setAttribute("data-selected", tab.selected);
    row.setAttribute("data-depth", String(Math.min(6, this.#depth(tab, siblings))));
    if (tab.parent && siblings.some(t => t.id == tab.parent)) row.setAttribute("data-parent", tab.parent);
    let favicon = this.#doc.createElementNS("http://www.w3.org/1999/xhtml", "img");
    favicon.className = "nullpath-profile-favicon";
    if (tab.favicon) favicon.src = tab.favicon;
    favicon.alt = "";
    let title = this.#doc.createXULElement("label");
    title.className = "nullpath-profile-tab-title";
    title.setAttribute("value", tab.title);
    let close = this.#button("", "nullpath-profile-tab-close", event => {
      event.stopPropagation();
      lazy.NullpathTabBridge.command(mode, "close", tab.windowId, tab.id);
    }, "Close tab");
    close.id = `nullpath-profile-close-${mode}-${tab.id}`;
    close.addEventListener("command", event => event.stopPropagation());
    let hasChildren = siblings.some(candidate => candidate.parent == tab.id);
    if (hasChildren) {
      let twisty = this.#doc.createXULElement("toolbarbutton");
      twisty.id = `nullpath-profile-twisty-${mode}-${tab.id}`;
      twisty.className = "nullpath-profile-twisty";
      twisty.setAttribute("tabindex", "0");
      twisty.setAttribute("aria-label", "Toggle related tabs");
      twisty.setAttribute("aria-expanded", String(!this.#collapsedTabs.has(tab.id)));
      twisty.addEventListener("click", event => { event.stopPropagation(); this.#toggleTree(tab.id); });
      twisty.addEventListener("command", event => { event.stopPropagation(); this.#toggleTree(tab.id); });
      row.append(twisty);
    }
    row.append(favicon, title, close);
    row.addEventListener("click", () => this.#focusMode(mode, tab));
    row.addEventListener("keydown", event => {
      if (event.key == "Enter" || event.key == " ") { this.#focusMode(mode, tab); event.preventDefault(); }
    });
    return row;
  }

  #toggleTree(tabId) {
    if (this.#collapsedTabs.has(tabId)) this.#collapsedTabs.delete(tabId);
    else this.#collapsedTabs.add(tabId);
    this.render();
  }

  #depth(tab, siblings) {
    let byId = new Map(siblings.map(t => [t.id, t]));
    let depth = 0, parent = tab.parent, seen = new Set([tab.id]);
    while (parent && byId.has(parent) && !seen.has(parent)) { seen.add(parent); depth++; parent = byId.get(parent).parent; }
    return depth;
  }

  #hiddenByCollapsedAncestor(tab, siblings) {
    let byId = new Map(siblings.map(t => [t.id, t]));
    let parent = tab.parent, seen = new Set();
    while (parent && byId.has(parent) && !seen.has(parent)) {
      if (this.#collapsedTabs.has(parent)) return true;
      seen.add(parent);
      parent = byId.get(parent).parent;
    }
    return false;
  }

  render() {
    if (!this.#root || this.#win.closed) return;
    let focusedId = this.#doc.activeElement?.id;
    this.#root.setAttribute("data-expanded", this.#root.getAttribute("data-expanded") == "true" ? "true" : "false");
    let expand = this.#button(this.#root.getAttribute("data-expanded") == "true" ? "Collapse sidebar" : "Expand sidebar", "nullpath-sidebar-toggle", () => {
      let next = this.#root.getAttribute("data-expanded") != "true";
      this.#root.setAttribute("data-expanded", String(next));
      Services.prefs.setBoolPref("nullpath.sidebar.expanded", next);
      this.render();
    });
    expand.id = "nullpath-sidebar-toggle";
    this.#doc.l10n.setAttributes(expand, this.#root.getAttribute("data-expanded") == "true" ? "nullpath-sidebar-collapse" : "nullpath-sidebar-expand");
    let heading = this.#doc.createXULElement("label");
    heading.className = "nullpath-sidebar-heading";
    this.#doc.l10n.setAttributes(heading, "nullpath-sidebar-profiles");
    let top = this.#doc.createXULElement("hbox");
    top.className = "nullpath-sidebar-top";
    top.append(heading, expand);
    let list = this.#doc.createXULElement("vbox");
    list.className = "nullpath-profile-list";
    for (let mode of PROFILE_MODES) list.append(this.#renderBlock(mode));
    let compactNew = this.#button("", "nullpath-sidebar-newtab", () => lazy.NullpathTabBridge.command(this.#currentMode, "new", "", "", this.#win), "New tab");
    compactNew.setAttribute("aria-label", "New tab");
    let spacer = this.#doc.createXULElement("spacer");
    spacer.setAttribute("flex", "1");
    let footer = this.#doc.createXULElement("hbox");
    footer.className = "nullpath-sidebar-footer";
    for (let [label, id] of [["History", "history-panelmenu"], ["Settings", "preferences-button"]]) {
      let button = this.#doc.createXULElement("toolbarbutton");
      button.className = "nullpath-sidebar-bottom-control";
      button.setAttribute("label", this.#root.getAttribute("data-expanded") == "true" ? label : "");
      button.setAttribute("aria-label", label);
      button.setAttribute("tooltiptext", label);
      button.setAttribute("data-action-id", id);
      button.addEventListener("command", () => {
        let target = this.#doc.getElementById(id);
        target?.doCommand?.();
      });
      footer.append(button);
    }
    this.#root.replaceChildren(top, list, compactNew, spacer, footer);
    this.#root.setAttribute("data-mode", this.#currentMode);
    if (focusedId) this.#doc.getElementById(focusedId)?.focus();
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
    lazy.NullpathTabBridge.onWindowReady(win);
    if (doc.getElementById("sidebar-container") && !doc.getElementById("nullpath-profiles-sidebar")) new ProfileSidebar(win);
  },

  forWindow(win) {
    return trees.get(win);
  },
};
