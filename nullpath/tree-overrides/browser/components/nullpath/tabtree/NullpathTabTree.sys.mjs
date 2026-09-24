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
 *
 * The profile sidebar's tab context menu, drag reordering and title edits run
 * here too (WindowTree.perform), in whichever profile process owns the tab.
 */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = XPCOMUtils.declareLazy({
  SessionStore: "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
  SessionWindowUI: "moz-src:///browser/components/sessionstore/SessionWindowUI.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  NullpathTabBridge: "moz-src:///browser/components/nullpath/tabtree/NullpathTabBridge.sys.mjs",
  TAB_COLORS: "moz-src:///browser/components/nullpath/tabtree/NullpathTabBridge.sys.mjs",
  NullpathProfileMode: "moz-src:///browser/components/nullpath/network/NullpathProfileMode.sys.mjs",
  ClipboardHelper: { service: "@mozilla.org/widget/clipboardhelper;1", iid: Ci.nsIClipboardHelper },
  verticalTabs: { pref: "sidebar.verticalTabs", default: false },
});

const MAX_DEPTH = 6;
const KEY_ID = "nullpath-tab-id";
const KEY_PARENT = "nullpath-tab-parent";
const KEY_COLLAPSED = "nullpath-tab-collapsed";
// Sidebar-only tab state: a custom title, a color and the group-header flag.
const KEY_TITLE = "nullpath-tab-title";
const KEY_COLOR = "nullpath-tab-color";
const KEY_GROUP = "nullpath-tab-group";
const WINDOW_ID = "nullpath-window-id";
const HIDE_SOURCE = "nullpath-tabtree";
const STYLESHEET = "chrome://browser/content/nullpath/tabtree.css";
const XHTML = "http://www.w3.org/1999/xhtml";
// Marks a sidebar row drag. The payload is a constant: a page the row is
// dropped on can read it, so the dragged tab lives in ProfileSidebar#drag.
const DRAG_TYPE = "application/x-nullpath-tab";

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
        this.#dedupeId(tab);
        this.refresh();
        break;
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

  /** A duplicated tab restores its source's session values, id included. */
  #dedupeId(tab) {
    let id = this.#value(tab, KEY_ID);
    for (let win of Services.wm.getEnumerator("navigator:browser")) {
      if (win.gBrowser?.tabs.some(t => t != tab && this.#value(t, KEY_ID) == id)) {
        this.#setValue(tab, KEY_ID, newId());
        return;
      }
    }
  }

  /** The sidebar title: the user's own title, else the page's. */
  titleOf(tab) {
    return this.#value(tab, KEY_TITLE) || tab.label;
  }

  /**
   * Runs a profile sidebar command on one of this window's tabs.
   * NullpathTabBridge has already checked `arg` for the action.
   *
   * @returns {Promise<boolean>|boolean} false when the action did nothing.
   */
  perform(tab, action, arg) {
    let win = this.#win;
    let gBrowser = this.#gBrowser;
    let map = this.#byId();
    switch (action) {
      case "reload":
        gBrowser.reloadTab(tab);
        break;
      case "mute":
        tab.toggleMuteAudio();
        break;
      case "bookmark":
        // Opens a dialog: don't hold the command's acknowledgement on it.
        win.focus();
        win.PlacesCommandHook.bookmarkTabs([tab]).catch(console.error);
        break;
      case "undo-close":
        lazy.SessionWindowUI.undoCloseTab(win);
        break;
      case "pin":
        if (tab.pinned) {
          gBrowser.unpinTab(tab);
        } else {
          // Pinned tabs sit outside the tree.
          this.#detach(tab, map);
          gBrowser.pinTab(tab);
        }
        break;
      case "duplicate": {
        // After the tab's branch, so the copy doesn't adopt its children.
        let last = Math.max(...[tab, ...this.descendantsOf(tab, map)].map(t => t.index));
        gBrowser.duplicateTab(tab, true, { tabIndex: last + 1 });
        break;
      }
      case "unload":
        if (tab.linkedPanel) {
          gBrowser.explicitUnloadTabs([tab]).catch(console.error);
        }
        break;
      case "copy-url":
        lazy.ClipboardHelper.copyString(Services.io.createExposableURI(tab.linkedBrowser.currentURI).displaySpec);
        break;
      case "copy-title":
        lazy.ClipboardHelper.copyString(this.titleOf(tab));
        break;
      case "set-title":
        this.#setValue(tab, KEY_TITLE, arg);
        break;
      case "set-color":
        this.#setValue(tab, KEY_COLOR, arg);
        break;
      case "sort":
        this.#sort(arg, map);
        break;
      case "group":
        if (!this.#group(tab, arg, map)) {
          return false;
        }
        break;
      case "flatten": {
        let parentId = this.#value(tab, KEY_PARENT);
        for (let d of this.descendantsOf(tab, map)) {
          this.#setValue(d, KEY_PARENT, parentId);
        }
        break;
      }
      case "configure": {
        let browser = tab.linkedBrowser;
        gBrowser.selectedTab = tab;
        win.focus();
        win.BrowserCommands.pageInfo(browser.currentURI.spec, "permTab", null, browser.browsingContext, browser);
        break;
      }
      case "move-window":
        return this.#moveToWindow(tab, arg);
      case "reopen":
        return this.#reopen(tab, arg);
      case "move":
        if (!this.#move(tab, arg, map)) {
          return false;
        }
        break;
      default:
        return false;
    }
    this.refresh();
    return true;
  }

  /** Lifts the tab out of the tree; its children take its place. */
  #detach(tab, map) {
    let parentId = this.#value(tab, KEY_PARENT);
    for (let child of this.childrenOf(tab, map)) {
      this.#setValue(child, KEY_PARENT, parentId);
    }
    this.#setValue(tab, KEY_PARENT, "");
  }

  /** Sorts the window's unpinned tabs, each level of the tree on its own. */
  #sort(key, map) {
    let gBrowser = this.#gBrowser;
    let tabs = gBrowser.tabs.filter(t => !t.pinned);
    let kids = new Map();
    for (let tab of tabs) {
      let parent = this.parentOf(tab, map);
      let parentId = parent && !parent.pinned ? this.#value(parent, KEY_ID) : "";
      kids.set(parentId, [...(kids.get(parentId) ?? []), tab]);
    }
    let collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    let address = tab => tab.linkedBrowser.currentURI.spec.replace(/^[a-z][a-z0-9+.-]*:(\/\/)?(www\.)?/i, "");
    let compare = {
      title: (a, b) => collator.compare(this.titleOf(a), this.titleOf(b)),
      url: (a, b) => collator.compare(address(a), address(b)),
      recent: (a, b) => b.lastAccessed - a.lastAccessed,
    }[key];
    let ordered = [];
    let seen = new Set();
    let visit = parentId => {
      for (let tab of (kids.get(parentId) ?? []).sort(compare)) {
        if (!seen.has(tab)) {
          seen.add(tab);
          ordered.push(tab);
          visit(this.#value(tab, KEY_ID));
        }
      }
    };
    visit("");
    // Tabs in a parent cycle are unreachable from the roots; keep them last.
    ordered.push(...tabs.filter(t => !seen.has(t)));
    // Each tab moves back to its slot, so later indexes never shift.
    let start = gBrowser.pinnedTabCount;
    ordered.forEach((tab, i) => gBrowser.moveTabTo(tab, { tabIndex: start + i }));
  }

  /**
   * Puts the tab (and its branch) under a new group header: an unloaded
   * about:blank tab the sidebar draws as a folder. The sender picks the id so
   * it can start renaming the group as soon as it appears.
   */
  #group(tab, { id, title }, map) {
    if (tab.pinned || map.has(id)) {
      return false;
    }
    let group = this.#gBrowser.addTrustedTab("about:blank", {
      tabIndex: tab.index,
      createLazyBrowser: true,
      lazyTabTitle: title,
      inBackground: true,
      skipAnimation: true,
    });
    this.#setValue(group, KEY_ID, id);
    this.#setValue(group, KEY_PARENT, this.#value(tab, KEY_PARENT));
    this.#setValue(group, KEY_GROUP, "1");
    this.#setValue(group, KEY_TITLE, title);
    this.#setValue(tab, KEY_PARENT, id);
    return true;
  }

  /**
   * Drag reordering: moves the tab and its branch before `before` (or to the
   * end of its pinned or unpinned run) under `parent`.
   */
  #move(tab, { before, parent }, map) {
    let gBrowser = this.#gBrowser;
    let branch = new Set(tab.pinned ? [tab] : [tab, ...this.descendantsOf(tab, map)]);
    let target = before ? map.get(before) : null;
    let parentTab = parent && !tab.pinned ? map.get(parent) : null;
    if ((before && !target) || (parent && !tab.pinned && !parentTab)) {
      return false;
    }
    if (branch.has(target) || branch.has(parentTab) || (target && target.pinned != tab.pinned) || parentTab?.pinned) {
      return false;
    }
    let moving = gBrowser.tabs.filter(t => branch.has(t));
    this.#setValue(tab, KEY_PARENT, parentTab ? parent : "");
    if (target) {
      gBrowser.moveTabsBefore(moving, target);
    } else {
      let last = gBrowser.tabs.filter(t => t.pinned == tab.pinned && !branch.has(t)).at(-1);
      if (last) {
        gBrowser.moveTabsAfter(moving, last);
      }
    }
    return true;
  }

  /** Moves the tab to a new window, or to another window of this profile. */
  #moveToWindow(tab, target) {
    let gBrowser = this.#gBrowser;
    if (target == "new") {
      return gBrowser.tabs.length > 1 && !!gBrowser.replaceTabWithWindow(tab);
    }
    let win = [...Services.wm.getEnumerator("navigator:browser")].find(
      w => w != this.#win && !w.closed && w.gBrowser && !lazy.PrivateBrowsingUtils.isWindowPrivate(w) && w.document.documentElement.getAttribute(WINDOW_ID) == target
    );
    let moved = win?.gBrowser.adoptTab(tab, { tabIndex: win.gBrowser.tabs.length, selectTab: true });
    if (!moved) {
      return false;
    }
    // Its parent stayed behind in this window.
    lazy.SessionStore.deleteCustomTabValue(moved, KEY_PARENT);
    trees.get(win)?.refresh();
    win.focus();
    return true;
  }

  /**
   * Opens the tab's page in another profile through the §7.4 hand-off (the
   * URL only: no referrer, cookies or form data). The tab stays where it is:
   * a tab never moves into another profile or changes its routing mode.
   */
  #reopen(tab, mode) {
    if (mode == lazy.NullpathProfileMode.mode) {
      return false;
    }
    let uri = tab.linkedBrowser.currentURI;
    if (!uri.schemeIs("http") && !uri.schemeIs("https")) {
      return lazy.NullpathTabBridge.command(mode, "new");
    }
    return lazy.NullpathProfileMode.openInMode(mode, Services.io.createExposableURI(uri).spec);
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
// Keep in sync with the nullpath-tab-enter / nullpath-tab-leave keyframes.
const TAB_ENTER_MS = 180;
const TAB_LEAVE_MS = 160;
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
  #toggle;
  // Resolved Fluent strings. Rebuilt nodes get their text synchronously so
  // they do not render blank until async DOM localization catches up.
  #strings = new Map();
  // The bridge polls every second; only rebuild when the directory changed.
  #profilesKey = "";
  // Row animations. render() rebuilds every row, so each animation is keyed by
  // "mode:tabId" and resumed with a negative animation-delay on rebuilds.
  #knownTabs = null;
  #entering = new Map();
  #leaving = new Map();
  // Tabs whose close button was clicked, hidden before the owner confirms.
  #closing = new Set();
  // Per render: each row's tab, and each block's tabs (all, and shown rows).
  #rowData = new WeakMap();
  #blockTabs = new Map();
  #shownTabs = new Map();
  // The tab context menu, its items, and the row it was opened on.
  #menu;
  #items = {};
  #context = null;
  // The row being dragged ({ mode, id, windowId, pinned, branch, row }) and
  // where it would land ({ rowId, where, before, parent, depth }).
  #drag = null;
  #drop = null;
  // Inline title editor ({ key, mode, id, windowId, original, input, collapse }),
  // and a group header that should open in it once the owner reports it.
  #editing = null;
  #pendingEdit = null;
  #listener = profiles => {
    let key = JSON.stringify(profiles);
    if (key == this.#profilesKey) return;
    this.#profilesKey = key;
    this.#profiles = profiles;
    this.#trackTabs(profiles);
    this.render();
  };

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
    this.#mountToggle();
    this.#buildMenu();
    // Firefox's sidebar-main cancels every context menu in #sidebar-container
    // that isn't its own. Keep it from seeing a row's: the row's `context`
    // popup listener runs afterwards, in the system group.
    this.#root.addEventListener("contextmenu", event => {
      if (event.target.closest?.(".nullpath-profile-tab")) event.stopPropagation();
    });
    this.#root.addEventListener("dragover", event => this.#onDragOver(event));
    this.#root.addEventListener("drop", event => this.#onDrop(event));
    this.#root.addEventListener("dragleave", event => {
      if (this.#drag && !this.#root.contains(event.relatedTarget)) this.#setDrop(null);
    });
    lazy.NullpathTabBridge.addListener(this.#listener);
    win.addEventListener("unload", () => lazy.NullpathTabBridge.removeListener(this.#listener), { once: true });
    this.render();
    let ids = [...Object.values(PROFILE_L10N), "nullpath-sidebar-no-tabs", "nullpath-sidebar-profiles", "nullpath-tab-group-title"];
    this.#doc.l10n.formatValues(ids).then(values => {
      ids.forEach((id, i) => this.#strings.set(id, values[i]));
      this.render();
    }, () => {});
  }

  get #animate() {
    return !this.#win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  #trackTabs(profiles) {
    let now = Date.now();
    let current = new Set(profiles.flatMap(p => p.windows.flatMap(w => w.tabs.map(t => `${p.mode}:${t.id}`))));
    if (this.#knownTabs && this.#animate) {
      for (let key of current) {
        if (!this.#knownTabs.has(key)) this.#entering.set(key, now);
      }
      for (let key of this.#knownTabs) {
        if (!current.has(key) && !this.#leaving.has(key)) this.#startLeaving(key);
      }
    }
    for (let key of this.#closing) {
      if (!current.has(key)) this.#closing.delete(key);
    }
    for (let [key, entry] of this.#leaving) {
      if (current.has(key)) this.#finishLeaving(key, entry);
    }
    this.#knownTabs = current;
  }

  /** Keeps a removed tab's row in place as a ghost that collapses away. */
  #startLeaving(key) {
    let [mode, id] = key.split(":");
    let row = this.#doc.getElementById(`nullpath-profile-tab-${mode}-${id}`);
    if (!row?.isConnected || !this.#animate) return;
    let prev = row.previousElementSibling;
    while (prev?.hasAttribute("data-leaving")) prev = prev.previousElementSibling;
    row.removeAttribute("data-entering");
    row.setAttribute("data-leaving", "true");
    row.setAttribute("aria-hidden", "true");
    row.removeAttribute("tabindex");
    let entry = { mode, node: row, prevId: prev?.classList.contains("nullpath-profile-tab") ? prev.id : "", start: Date.now() };
    entry.timer = this.#win.setTimeout(() => this.#finishLeaving(key, entry), TAB_LEAVE_MS + 50);
    this.#leaving.set(key, entry);
  }

  #finishLeaving(key, entry) {
    this.#win.clearTimeout(entry.timer);
    entry.node.remove();
    if (this.#leaving.get(key) == entry) this.#leaving.delete(key);
  }

  #closeTab(mode, tab) {
    let key = `${mode}:${tab.id}`;
    this.#startLeaving(key);
    this.#closing.add(key);
    this.render();
    lazy.NullpathTabBridge.command(mode, "close", tab.windowId, tab.id).then(ok => {
      if (!ok && this.#closing.delete(key)) this.render();
    });
  }

  /** Sends a tab command to the profile that owns the tab. */
  #send(mode, action, tab, arg = null) {
    return lazy.NullpathTabBridge.command(mode, action, tab.windowId, tab.id, this.#win, arg);
  }

  /** The tab's entry in the current directory (menu and drag data can be older). */
  #liveTab(mode, id) {
    return this.#profiles.find(p => p.mode == mode)?.windows.flatMap(w => w.tabs).find(t => t.id == id) ?? null;
  }

  get #expanded() {
    return this.#root.getAttribute("data-expanded") == "true";
  }

  #setExpanded(expanded) {
    this.#root.setAttribute("data-expanded", String(expanded));
    Services.prefs.setBoolPref("nullpath.sidebar.expanded", expanded);
    this.render();
  }

  /** Replaces the native sidebar button left of Back (hidden in tabtree.css). */
  #mountToggle() {
    let target = this.#doc.getElementById("nav-bar-customization-target");
    if (!target || this.#doc.getElementById("nullpath-sidebar-toggle")) return;
    this.#toggle = this.#doc.createXULElement("toolbarbutton");
    this.#toggle.id = "nullpath-sidebar-toggle";
    this.#toggle.className = "toolbarbutton-1 chromeclass-toolbar-additional";
    this.#toggle.addEventListener("command", () => this.#setExpanded(!this.#expanded));
    target.before(this.#toggle);
  }

  /**
   * The tab context menu shared by every row in this window: an icon row
   * (reopen closed tab, mute, reload, bookmark), then the tab actions.
   */
  #buildMenu() {
    let doc = this.#doc;
    let menu = doc.createXULElement("menupopup");
    menu.id = "nullpath-tab-context";
    let item = (parent, id, l10n, action, arg = null) => {
      let el = doc.createXULElement("menuitem");
      el.id = `nullpath-tab-context-${id}`;
      el.className = "menuitem-iconic";
      if (l10n) doc.l10n.setAttributes(el, l10n.id ?? l10n, l10n.args);
      el.addEventListener("command", () => this.#runMenuAction(action, arg));
      parent.append(el);
      return el;
    };
    let submenu = id => {
      let el = doc.createXULElement("menu");
      el.id = `nullpath-tab-context-${id}`;
      el.className = "menu-iconic";
      doc.l10n.setAttributes(el, `nullpath-tab-context-${id}`);
      let popup = doc.createXULElement("menupopup");
      el.append(popup);
      menu.append(el);
      return popup;
    };
    let separator = () => menu.append(doc.createXULElement("menuseparator"));

    let actions = doc.createXULElement("menugroup");
    actions.id = "nullpath-tab-context-actions";
    menu.append(actions);
    for (let action of ["undo-close", "mute", "reload", "bookmark"]) {
      this.#items[action] = item(actions, action, `nullpath-tab-context-${action}`, action);
    }
    separator();
    this.#items.move = submenu("move");
    this.#items.reopen = submenu("reopen");
    let colors = submenu("color");
    for (let color of ["", ...lazy.TAB_COLORS]) {
      let el = item(colors, `color-${color || "none"}`, { id: "nullpath-tab-context-color-option", args: { color: color || "none" } }, "set-color", color);
      el.classList.add("nullpath-tab-color-option");
      el.setAttribute("data-color", color);
    }
    let sort = submenu("sort");
    for (let key of ["title", "url", "recent"]) {
      item(sort, `sort-${key}`, `nullpath-tab-context-sort-${key}`, "sort", key);
    }
    separator();
    for (let action of ["pin", "duplicate", "unload", "copy-url", "copy-title", "edit-title"]) {
      this.#items[action] = item(menu, action, `nullpath-tab-context-${action}`, action);
    }
    separator();
    for (let action of ["group", "flatten"]) {
      this.#items[action] = item(menu, action, `nullpath-tab-context-${action}`, action);
    }
    separator();
    for (let action of ["configure", "close"]) {
      this.#items[action] = item(menu, action, `nullpath-tab-context-${action}`, action);
    }
    menu.addEventListener("popupshowing", event => {
      if (event.target == menu) this.#onMenuShowing(event);
    });
    menu.addEventListener("popuphidden", event => {
      if (event.target != menu) return;
      this.#context = null;
      for (let row of this.#root.querySelectorAll(".nullpath-profile-tab[data-context]")) row.removeAttribute("data-context");
    });
    (doc.getElementById("mainPopupSet") ?? doc.documentElement).append(menu);
    this.#menu = menu;
  }

  #onMenuShowing(event) {
    let row = this.#menu.triggerNode?.closest?.(".nullpath-profile-tab");
    let data = row && !row.hasAttribute("data-leaving") ? this.#rowData.get(row) : null;
    if (!data) {
      event.preventDefault();
      return;
    }
    let { mode, tab } = data;
    this.#context = { ...data, key: `${mode}:${tab.id}` };
    row.setAttribute("data-context", "true");
    let doc = this.#doc;
    let items = this.#items;
    let windows = this.#profiles.find(p => p.mode == mode)?.windows ?? [];
    let own = windows.find(w => w.id == tab.windowId);
    let hasChildren = (this.#blockTabs.get(mode) ?? []).some(t => t.parent == tab.id && t.windowId == tab.windowId);
    let label = (el, id) => {
      if (doc.l10n.getAttributes(el).id != id) doc.l10n.setAttributes(el, id);
    };
    let disable = (el, disabled) => el.toggleAttribute("disabled", !!disabled);

    disable(items["undo-close"], !own?.canReopen);
    label(items.mute, tab.muted ? "nullpath-tab-context-unmute" : "nullpath-tab-context-mute");
    items.mute.toggleAttribute("muted", tab.muted);
    disable(items.bookmark, tab.home);
    label(items.pin, tab.pinned ? "nullpath-tab-context-unpin" : "nullpath-tab-context-pin");
    disable(items.pin, tab.group);
    disable(items.duplicate, tab.group);
    disable(items.unload, tab.unloaded || tab.group);
    disable(items["copy-url"], tab.home);
    disable(items.group, tab.pinned);
    disable(items.flatten, !hasChildren);
    disable(items.configure, tab.home);

    // Move to: a new window, or another window of the tab's own profile.
    let move = [];
    let newWindow = doc.createXULElement("menuitem");
    newWindow.id = "nullpath-tab-context-move-new-window";
    doc.l10n.setAttributes(newWindow, "nullpath-tab-context-move-new-window");
    disable(newWindow, (own?.tabs.length ?? 0) < 2);
    newWindow.addEventListener("command", () => this.#runMenuAction("move-window", "new"));
    move.push(newWindow);
    let others = windows.filter(w => w.id && w.id != tab.windowId);
    if (others.length) move.push(doc.createXULElement("menuseparator"));
    for (let w of others) {
      let el = doc.createXULElement("menuitem");
      let current = w.tabs.find(t => t.selected) ?? w.tabs[0];
      doc.l10n.setAttributes(el, "nullpath-tab-context-move-window", { title: current?.title ?? "" });
      el.addEventListener("command", () => this.#runMenuAction("move-window", w.id));
      move.push(el);
    }
    items.move.replaceChildren(...move);

    // Reopen in: the page opens in another profile; this tab stays.
    items.reopen.replaceChildren(...PROFILE_MODES.filter(m => m != mode).map(m => {
      let el = doc.createXULElement("menuitem");
      el.id = `nullpath-tab-context-reopen-${m}`;
      el.className = "menuitem-iconic";
      el.setAttribute("label", this.#strings.get(PROFILE_L10N[m]) ?? m);
      el.style.setProperty("--menuitem-icon", `url("chrome://browser/skin/nullpath/mode-${PROFILE_ICONS[m]}.svg")`);
      el.addEventListener("command", () => this.#runMenuAction("reopen", m));
      return el;
    }));
    disable(items.reopen.parentNode, tab.group);

    for (let el of this.#menu.querySelectorAll(".nullpath-tab-color-option")) {
      el.toggleAttribute("current", el.getAttribute("data-color") == tab.color);
    }
  }

  #runMenuAction(action, arg = null) {
    let context = this.#context;
    if (!context) return;
    let { mode, tab } = context;
    switch (action) {
      case "close":
        this.#closeTab(mode, tab);
        break;
      case "edit-title":
        this.#startEdit(mode, tab);
        break;
      case "group": {
        let id = `t-${Math.random().toString(36).slice(2, 14)}`;
        let title = this.#strings.get("nullpath-tab-group-title") || "Group";
        // Name the new group in place, unless that means widening the sidebar.
        if (this.#expanded) this.#pendingEdit = { mode, id, until: Date.now() + 5000 };
        this.#send(mode, "group", tab, { id, title });
        break;
      }
      default:
        this.#send(mode, action, tab, arg);
    }
  }

  /**
   * Edits a tab's sidebar title in place. The collapsed sidebar has no titles,
   * so it widens for the edit and narrows again afterwards.
   */
  #startEdit(mode, tab) {
    this.#finishEdit(false);
    let input = this.#doc.createElementNS(XHTML, "input");
    input.id = "nullpath-profile-title-input";
    input.className = "nullpath-profile-tab-title-input";
    input.value = tab.title;
    input.maxLength = 300;
    this.#doc.l10n.setAttributes(input, "nullpath-tab-title-input");
    input.addEventListener("keydown", event => {
      event.stopPropagation();
      if (event.key == "Enter" || event.key == "Escape") {
        event.preventDefault();
        this.#finishEdit(event.key == "Enter", true);
      }
    });
    input.addEventListener("blur", () => {
      // render() moves the input into a rebuilt row; only a real blur ends it.
      this.#win.setTimeout(() => {
        if (this.#editing?.input == input && this.#doc.activeElement != input) this.#finishEdit(true);
      }, 0);
    });
    for (let type of ["click", "mousedown", "dblclick", "dragstart"]) {
      input.addEventListener(type, event => event.stopPropagation());
    }
    let collapse = !this.#expanded;
    this.#editing = { key: `${mode}:${tab.id}`, mode, id: tab.id, windowId: tab.windowId, original: tab.title, input, collapse };
    if (collapse) this.#setExpanded(true);
    else this.render();
    if (!input.isConnected) {
      this.#finishEdit(false);
      return;
    }
    input.focus();
    input.select();
  }

  #finishEdit(commit, refocus = false) {
    let editing = this.#editing;
    if (!editing) return;
    this.#editing = null;
    let value = editing.input.value.replace(/\s+/g, " ").trim();
    if (commit && value != editing.original) {
      // Show the new title now rather than after the owner's next snapshot.
      let live = this.#liveTab(editing.mode, editing.id);
      if (live && value) live.title = value;
      lazy.NullpathTabBridge.command(editing.mode, "set-title", editing.windowId, editing.id, this.#win, value);
    }
    if (editing.collapse) this.#setExpanded(false);
    else this.render();
    if (refocus) this.#doc.getElementById(`nullpath-profile-tab-${editing.mode}-${editing.id}`)?.focus();
  }

  #localize(element, id) {
    this.#doc.l10n.setAttributes(element, id);
    if (this.#strings.has(id)) element.textContent = this.#strings.get(id);
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
    let icon = this.#doc.createElementNS(XHTML, "img");
    icon.src = `chrome://browser/skin/nullpath/mode-${PROFILE_ICONS[mode]}.svg`;
    icon.alt = "";
    icon.draggable = false;
    return icon;
  }

  #focusMode(mode, tab = null) {
    lazy.NullpathTabBridge.command(mode, "focus", tab?.windowId ?? "", tab?.id ?? "");
  }

  #renderBlock(mode) {
    let data = this.#profiles.find(p => p.mode == mode) ?? { mode, count: 0, windows: [] };
    let tabs = data.windows.flatMap(w => w.tabs).sort((a, b) => Number(b.pinned) - Number(a.pinned));
    let current = mode == this.#currentMode;
    // A block holding the title editor stays open until the edit ends.
    let collapsed = this.#blockState.get(mode) && this.#editing?.mode != mode;
    let block = this.#doc.createXULElement("vbox");
    block.className = "nullpath-profile-block";
    block.setAttribute("data-mode", mode);
    block.setAttribute("data-current", current);
    block.setAttribute("data-collapsed", collapsed);
    let name = this.#doc.createXULElement("label");
    this.#localize(name, PROFILE_L10N[mode]);
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
      if (!this.#expanded) {
        this.#setExpanded(true);
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
    // "+" sits beside the header button rather than inside it: a button nested
    // in a toolbarbutton would also fire the header's toggle.
    let headerRow = this.#doc.createXULElement("hbox");
    headerRow.className = "nullpath-profile-header-row";
    let add = this.#button("", "nullpath-profile-add", () => lazy.NullpathTabBridge.command(mode, "new", "", "", this.#win));
    add.id = `nullpath-profile-add-${mode}`;
    this.#doc.l10n.formatValue(PROFILE_L10N[mode]).then(profileName => {
      add.setAttribute("tooltiptext", `New tab in ${profileName}`);
      add.setAttribute("aria-label", `New tab in ${profileName}`);
    });
    headerRow.append(header, add);
    block.append(headerRow);
    let shown = [];
    this.#blockTabs.set(mode, tabs);
    this.#shownTabs.set(mode, shown);
    if (!collapsed || !this.#expanded) {
      if (this.#expanded && !tabs.some(tab => !this.#closing.has(`${mode}:${tab.id}`))) {
        let empty = this.#doc.createXULElement("label");
        this.#localize(empty, "nullpath-sidebar-no-tabs");
        empty.className = "nullpath-profile-empty";
        block.append(empty);
      }
      let now = Date.now();
      for (let tab of tabs) {
        if (this.#closing.has(`${mode}:${tab.id}`) || (this.#expanded && this.#hiddenByCollapsedAncestor(tab, tabs) && this.#editing?.key != `${mode}:${tab.id}`)) continue;
        let row = this.#renderTab(mode, tab, tabs);
        let started = this.#entering.get(`${mode}:${tab.id}`);
        if (started !== undefined && now - started < TAB_ENTER_MS) {
          row.setAttribute("data-entering", "true");
          row.style.animationDelay = `-${now - started}ms`;
        } else {
          this.#entering.delete(`${mode}:${tab.id}`);
        }
        block.append(row);
        shown.push(tab);
      }
      for (let entry of this.#leaving.values()) {
        if (entry.mode != mode) continue;
        entry.node.style.animationDelay = `-${now - entry.start}ms`;
        let anchor = [...block.children].find(child => entry.prevId && child.id == entry.prevId) ?? headerRow;
        anchor.after(entry.node);
      }
    }
    return block;
  }

  #renderTab(mode, tab, siblings) {
    let key = `${mode}:${tab.id}`;
    // The drag source row stays the same node: a rebuilt one would never get
    // the drag's dragend.
    if (this.#drag?.row && this.#drag.mode == mode && this.#drag.id == tab.id) return this.#drag.row;
    let row = this.#doc.createXULElement("hbox");
    row.id = `nullpath-profile-tab-${mode}-${tab.id}`;
    row.className = "nullpath-profile-tab";
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.setAttribute("aria-label", `${mode}: ${tab.title}`);
    row.setAttribute("tooltiptext", tab.title);
    row.setAttribute("context", "nullpath-tab-context");
    row.setAttribute("data-selected", tab.selected);
    row.setAttribute("data-unloaded", tab.unloaded);
    row.setAttribute("data-depth", String(Math.min(6, this.#depth(tab, siblings))));
    if (tab.parent && siblings.some(t => t.id == tab.parent)) row.setAttribute("data-parent", tab.parent);
    if (tab.color) row.setAttribute("data-color", tab.color);
    if (tab.group) row.setAttribute("data-group", "true");
    if (this.#context?.key == key && this.#menu.state != "closed") row.setAttribute("data-context", "true");
    if (this.#drag?.mode == mode && this.#drag.branch.has(tab.id)) row.setAttribute("data-dragging", "true");
    if (this.#drop?.rowId == row.id) {
      row.setAttribute("data-drop", this.#drop.where);
      row.style.setProperty("--drop-depth", this.#drop.depth);
    }
    // Group headers show a folder. Home/new-tab pages show the Nullpath mark
    // (themed in CSS); other pages show their own favicon, or the generic page
    // icon while none is known.
    let plain = tab.group || tab.home;
    let favicon = this.#doc.createElementNS(XHTML, plain ? "span" : "img");
    favicon.className = "nullpath-profile-favicon";
    if (tab.group) favicon.classList.add("nullpath-profile-favicon-group");
    else if (tab.home) favicon.classList.add("nullpath-profile-favicon-home");
    else {
      favicon.src = tab.favicon || "chrome://global/skin/icons/defaultFavicon.svg";
      favicon.alt = "";
      favicon.draggable = false;
    }
    let title = this.#editing?.key == key ? this.#editing.input : this.#doc.createXULElement("label");
    if (title.localName == "label") {
      title.className = "nullpath-profile-tab-title";
      title.setAttribute("value", tab.title);
    }
    let close = this.#button("", "nullpath-profile-tab-close", event => {
      event.stopPropagation();
      this.#closeTab(mode, tab);
    }, "Close tab");
    close.id = `nullpath-profile-close-${mode}-${tab.id}`;
    close.addEventListener("command", event => event.stopPropagation());
    // The row's own click would focus the tab being closed.
    close.addEventListener("click", event => event.stopPropagation());
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
    row.append(favicon, title);
    if (tab.muted) {
      let muted = this.#doc.createXULElement("image");
      muted.className = "nullpath-profile-tab-muted";
      muted.setAttribute("aria-hidden", "true");
      row.append(muted);
    }
    row.append(close);
    // A group header folds its tabs; any other row focuses its tab.
    let activate = () => {
      if (tab.group && hasChildren && this.#expanded) this.#toggleTree(tab.id);
      else this.#focusMode(mode, tab);
    };
    row.addEventListener("click", event => {
      if (event.button == 0) activate();
    });
    row.addEventListener("keydown", event => {
      if (event.ctrlKey && event.shiftKey && (event.key == "PageUp" || event.key == "PageDown")) {
        this.#moveByKey(mode, tab, event.key == "PageUp");
        event.preventDefault();
      } else if (event.key == "Enter" || event.key == " ") {
        activate();
        event.preventDefault();
      }
    });
    row.addEventListener("dragstart", event => this.#onDragStart(event, mode, tab, siblings));
    row.addEventListener("dragend", () => this.#endDrag());
    this.#rowData.set(row, { mode, tab });
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

  /** The tab plus everything nested under it; a pinned tab moves alone. */
  #branch(tab, siblings) {
    let branch = new Set([tab.id]);
    if (tab.pinned) return branch;
    for (let grew = true; grew;) {
      grew = false;
      for (let t of siblings) {
        if (t.windowId == tab.windowId && branch.has(t.parent) && !branch.has(t.id)) {
          branch.add(t.id);
          grew = true;
        }
      }
    }
    return branch;
  }

  #onDragStart(event, mode, tab, siblings) {
    if (this.#editing || event.target.closest?.(".nullpath-profile-tab-close, .nullpath-profile-twisty")) return;
    let row = event.currentTarget;
    this.#drag = { mode, id: tab.id, windowId: tab.windowId, pinned: tab.pinned, branch: this.#branch(tab, siblings), row };
    let dt = event.dataTransfer;
    dt.clearData();
    dt.setData(DRAG_TYPE, "tab");
    dt.effectAllowed = "move";
    let rect = row.getBoundingClientRect();
    dt.setDragImage(row, event.clientX - rect.left, event.clientY - rect.top);
    // Dim the branch after the drag image has been taken from the row.
    this.#win.setTimeout(() => {
      if (this.#drag?.row != row) return;
      for (let id of this.#drag.branch) this.#doc.getElementById(`nullpath-profile-tab-${mode}-${id}`)?.setAttribute("data-dragging", "true");
    }, 0);
  }

  #onDragOver(event) {
    if (!this.#drag || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
    this.#autoScroll(event);
    let drop = this.#dropAt(event);
    this.#setDrop(drop);
    if (drop) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }
  }

  /** The gap between two rows of the dragged tab's block nearest the pointer. */
  #dropAt(event) {
    let drag = this.#drag;
    let block = event.target.closest?.(".nullpath-profile-block");
    if (block?.getAttribute("data-mode") != drag.mode) return null;
    let rows = [...block.querySelectorAll(".nullpath-profile-tab:not([data-leaving])")];
    let index = rows.findIndex(row => {
      let rect = row.getBoundingClientRect();
      return event.clientY < rect.top + rect.height / 2;
    });
    if (index < 0) index = rows.length;
    let above = rows[index - 1], below = rows[index];
    let gap = this.#gap(drag, above && this.#rowData.get(above)?.tab, below && this.#rowData.get(below)?.tab);
    return gap && { ...gap, rowId: (below ?? above).id, where: below ? "before" : "after" };
  }

  /**
   * Where the dragged branch lands between rows `a` and `b` (either may be
   * missing). Tabs stay in their own window and pinned run. The branch joins
   * `b`'s level, or becomes `a`'s first child when `b` is.
   *
   * @returns {?{before: string, parent: string, depth: number}}
   */
  #gap(drag, a, b) {
    // A gap touching the dragged branch is where it already is.
    if ((a && drag.branch.has(a.id)) || (b && drag.branch.has(b.id))) return null;
    let fits = t => t && t.windowId == drag.windowId && t.pinned == drag.pinned;
    a = fits(a) ? a : null;
    b = fits(b) ? b : null;
    if (!a && !b) return null;
    let tabs = this.#blockTabs.get(drag.mode) ?? [];
    let parent = !drag.pinned && b ? (b.parent == a?.id ? a.id : b.parent) : "";
    let parentTab = parent ? tabs.find(t => t.id == parent && t.windowId == drag.windowId) : null;
    return {
      before: b?.id ?? "",
      parent: parentTab ? parent : "",
      depth: parentTab ? Math.min(6, this.#depth(parentTab, tabs) + 1) : 0,
    };
  }

  #setDrop(drop) {
    let old = this.#drop;
    this.#drop = drop;
    if (old?.rowId == drop?.rowId && old?.where == drop?.where && old?.depth == drop?.depth) return;
    this.#doc.getElementById(old?.rowId)?.removeAttribute("data-drop");
    let row = drop && this.#doc.getElementById(drop.rowId);
    if (row) {
      row.setAttribute("data-drop", drop.where);
      row.style.setProperty("--drop-depth", drop.depth);
    }
  }

  #autoScroll(event) {
    let list = this.#root.querySelector(".nullpath-profile-list");
    if (!list) return;
    let { top, bottom } = list.getBoundingClientRect();
    if (event.clientY < top + 24) list.scrollTop -= 12;
    else if (event.clientY > bottom - 24) list.scrollTop += 12;
  }

  #onDrop(event) {
    let drag = this.#drag, drop = this.#drop;
    if (!drag || !drop) return;
    event.preventDefault();
    this.#moveTab(drag, drop);
    this.#endDrag();
  }

  #endDrag() {
    if (!this.#drag) return;
    this.#drag = null;
    this.#setDrop(null);
    this.render();
  }

  /** Ctrl+Shift+PageUp/PageDown: the keyboard version of dragging a row. */
  #moveByKey(mode, tab, up) {
    let shown = this.#shownTabs.get(mode) ?? [];
    let drag = { mode, id: tab.id, windowId: tab.windowId, pinned: tab.pinned, branch: this.#branch(tab, this.#blockTabs.get(mode) ?? []) };
    let indexes = shown.flatMap((t, i) => (drag.branch.has(t.id) ? [i] : []));
    if (!indexes.length) return;
    let first = Math.min(...indexes), last = Math.max(...indexes);
    let [a, b] = up ? [shown[first - 2], shown[first - 1]] : [shown[last + 1], shown[last + 2]];
    // The row being stepped over must share the tab's window and pinned run.
    let over = up ? b : a;
    if (!over || over.windowId != tab.windowId || over.pinned != tab.pinned) return;
    let gap = this.#gap(drag, a, b);
    if (!gap) return;
    this.#moveTab(drag, gap);
    this.render();
  }

  /** Moves the branch in the sidebar at once, then in the owning profile. */
  #moveTab(drag, { before, parent }) {
    let win = this.#profiles.find(p => p.mode == drag.mode)?.windows.find(w => w.id == drag.windowId);
    let moving = win?.tabs.filter(t => drag.branch.has(t.id)) ?? [];
    let rest = win?.tabs.filter(t => !drag.branch.has(t.id)) ?? [];
    let at = before ? rest.findIndex(t => t.id == before) : drag.pinned ? rest.filter(t => t.pinned).length : rest.length;
    let tab = moving.find(t => t.id == drag.id);
    if (tab && at >= 0) {
      tab.parent = parent;
      rest.splice(at, 0, ...moving);
      win.tabs = rest;
    }
    this.#send(drag.mode, "move", drag, { before, parent }).then(ok => {
      // Refused (the tabs changed meanwhile): redraw from the next snapshot.
      if (!ok) this.#profilesKey = "";
    });
  }

  render() {
    if (!this.#root || this.#win.closed) return;
    let focusedId = this.#doc.activeElement?.id;
    let expanded = this.#expanded;
    let input = this.#editing?.input;
    let selection = input && this.#doc.activeElement == input ? [input.selectionStart, input.selectionEnd, input.selectionDirection] : null;
    let scrollTop = this.#root.querySelector(".nullpath-profile-list")?.scrollTop ?? 0;
    this.#root.setAttribute("data-expanded", String(expanded));
    if (this.#toggle) {
      this.#toggle.setAttribute("aria-expanded", String(expanded));
      let id = expanded ? "nullpath-sidebar-collapse" : "nullpath-sidebar-expand";
      if (this.#doc.l10n.getAttributes(this.#toggle).id != id) this.#doc.l10n.setAttributes(this.#toggle, id);
    }
    let heading = this.#doc.createXULElement("label");
    heading.className = "nullpath-sidebar-heading";
    this.#localize(heading, "nullpath-sidebar-profiles");
    let top = this.#doc.createXULElement("hbox");
    top.className = "nullpath-sidebar-top";
    top.append(heading);
    let list = this.#doc.createXULElement("vbox");
    list.className = "nullpath-profile-list";
    for (let mode of PROFILE_MODES) list.append(this.#renderBlock(mode));
    let compactNew = this.#button("", "nullpath-sidebar-newtab", () => lazy.NullpathTabBridge.command(this.#currentMode, "new", "", "", this.#win), "New tab");
    compactNew.setAttribute("aria-label", "New tab");
    let spacer = this.#doc.createXULElement("spacer");
    spacer.setAttribute("flex", "1");
    let footer = this.#doc.createXULElement("hbox");
    footer.className = "nullpath-sidebar-footer";
    // Call the actions directly: the matching toolbar widgets usually sit in
    // the customization palette, outside the document.
    let footerActions = [
      ["History", "history-panelmenu", () => this.#win.PlacesCommandHook.showPlacesOrganizer("History")],
      ["Settings", "preferences-button", () => this.#win.openPreferences()],
    ];
    for (let [label, id, activate] of footerActions) {
      let button = this.#doc.createXULElement("toolbarbutton");
      button.className = "nullpath-sidebar-bottom-control";
      button.setAttribute("label", expanded ? label : "");
      button.setAttribute("aria-label", label);
      button.setAttribute("tooltiptext", label);
      button.setAttribute("data-action-id", id);
      button.addEventListener("command", activate);
      footer.append(button);
    }
    this.#root.replaceChildren(top, list, compactNew, spacer, footer);
    this.#root.setAttribute("data-mode", this.#currentMode);
    // Rebuilding the list would otherwise scroll it back to the top.
    if (scrollTop) list.scrollTop = scrollTop;
    if (focusedId) this.#doc.getElementById(focusedId)?.focus();
    if (selection && input.isConnected) input.setSelectionRange(...selection);
    let pending = this.#pendingEdit;
    if (pending && !this.#editing) {
      let tab = this.#liveTab(pending.mode, pending.id);
      if (tab || Date.now() > pending.until) this.#pendingEdit = null;
      if (tab) this.#startEdit(pending.mode, tab);
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
    // browser.xhtml links the sheet itself (nullpath-overlay.py).
    if (!doc.getElementById("nullpath-tabtree-stylesheet")) {
      let link = doc.createElementNS("http://www.w3.org/1999/xhtml", "link");
      link.id = "nullpath-tabtree-stylesheet";
      link.rel = "stylesheet";
      link.href = STYLESHEET;
      (doc.head ?? doc.documentElement).append(link);
    }
    win.MozXULElement?.insertFTLIfNeeded("browser/nullpath/router.ftl");
    trees.set(win, new WindowTree(win));
    lazy.NullpathTabBridge.onWindowReady(win);
    if (doc.getElementById("sidebar-container") && !doc.getElementById("nullpath-profiles-sidebar")) new ProfileSidebar(win);
  },

  forWindow(win) {
    return trees.get(win);
  },

  /** A profile sidebar command on one of this process's tabs (NullpathTabBridge). */
  perform(win, tab, action, arg) {
    return trees.get(win)?.perform(tab, action, arg) ?? false;
  },
};
