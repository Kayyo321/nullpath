/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Local-only tab directory shared by Nullpath's three isolated profile
 * processes. Its schema contains only profile/window/tab ids, title, favicon
 * URI, tree parent, selected/pinned/muted/unloaded state, sidebar color and
 * count. Commands are one-shot files scoped to a profile and acknowledged by
 * the owning process after the operation. They name a tab and an action, never
 * a URL: the owning process reads its own tab's URL when an action needs it.
 */
import { setInterval, clearInterval, setTimeout } from "resource://gre/modules/Timer.sys.mjs";

const MODES = ["i2p-sites", "i2p-publicweb", "direct"];
export const TAB_COLORS = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "gray"];
const VERSION = 1;
// Other profiles' tabs and commands arrive by polling; a short interval keeps
// cross-profile opens and closes feeling immediate. Our own snapshot is only
// rewritten when it changes, or often enough to stay inside SNAPSHOT_TTL.
const POLL_MS = 200;
const REPUBLISH_MS = 3000;
const SNAPSHOT_TTL = 10000;
const WINDOW_ID = "nullpath-window-id";
const TAB_ID = "nullpath-tab-id";
const TAB_PARENT = "nullpath-tab-parent";
const TAB_TITLE = "nullpath-tab-title";
const TAB_COLOR = "nullpath-tab-color";
const TAB_GROUP = "nullpath-tab-group";

function mode() {
  return Services.prefs.getStringPref("nullpath.mode", "i2p-sites");
}
function startTime(pid) {
  try {
    return ChromeUtils.importESModule("moz-src:///browser/components/nullpath/router/NullpathProcess.sys.mjs").NullpathProcess.startTime(pid);
  } catch (e) { return 0; }
}
function dataDir() {
  let dir = Services.dirsvc.get("UAppData", Ci.nsIFile);
  dir.append("i2p"); dir.append("tabs");
  return dir.path;
}
function safeId(s) { return /^[a-z0-9_-]{1,64}$/i.test(String(s ?? "")); }
function safeFavicon(value) {
  value = String(value ?? "");
  // Tab favicons arrive as data: URLs from FaviconLoader (any image type,
  // often well over 4 KB) or as chrome:// URLs for built-in pages. Remote URLs
  // are refused: the sidebar renders every profile's tabs, and fetching one
  // here would load it over this profile's network path.
  return /^(?:chrome:\/\/|data:image\/(?:png|jpeg|webp|gif|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml);base64,)/i.test(value) && value.length < 65536 ? value : "";
}
const HOME_URLS = new Set(["about:blank", "about:home", "about:newtab", "about:privatebrowsing", "about:welcome"]);
function isHomeTab(tab) {
  let spec = tab.linkedBrowser?.currentURI?.spec ?? "about:blank";
  return HOME_URLS.has(spec.replace(/[?#].*$/, ""));
}
function safeColor(value) { return TAB_COLORS.includes(value) ? value : ""; }

// Every command and a check of its argument. Tab actions run in the owning
// profile through NullpathTabTree.perform().
const none = arg => arg == null;
const optionalId = value => value === "" || safeId(value);
const COMMANDS = new Map([
  ["focus", none], ["close", none], ["new", none],
  ["reload", none], ["mute", none], ["bookmark", none], ["undo-close", none],
  ["pin", none], ["duplicate", none], ["unload", none], ["copy-url", none],
  ["copy-title", none], ["flatten", none], ["configure", none],
  ["set-title", arg => typeof arg == "string" && arg.length <= 300],
  ["set-color", arg => arg === "" || TAB_COLORS.includes(arg)],
  ["sort", arg => ["title", "url", "recent"].includes(arg)],
  ["group", arg => safeId(arg?.id) && typeof arg.title == "string" && arg.title.length <= 300],
  ["move-window", arg => arg === "new" || safeId(arg)],
  ["reopen", arg => MODES.includes(arg)],
  ["move", arg => optionalId(arg?.before) && optionalId(arg?.parent)],
]);
function validCommand(action, arg) { return COMMANDS.get(action)?.(arg ?? null) ?? false; }

class TabBridge {
  #windows = new Set();
  #timer;
  #publishing = Promise.resolve();
  #listeners = new Set();
  #commands = new Set();
  #seen = new Set();
  #publishedKey = "";
  #publishedAt = 0;
  #ticking = null;
  #tickAgain = false;
  #tickSoon = false;

  constructor() {
    if (Services.appinfo.processType != Services.appinfo.PROCESS_TYPE_DEFAULT) return;
    this.#timer = setInterval(() => this.#tick(), POLL_MS);
    Services.obs.addObserver(() => this.#shutdown(), "quit-application-granted");
  }

  addListener(callback) { this.#listeners.add(callback); this.#requestTick(); }
  removeListener(callback) { this.#listeners.delete(callback); }
  /** Publishes now, for changes that fire no tab event (SessionStore values). */
  refresh() { this.#requestTick(); }

  onWindowReady(win) {
    if (!win?.gBrowser || Services.appinfo.processType != Services.appinfo.PROCESS_TYPE_DEFAULT) return;
    if (!win.document.documentElement.hasAttribute(WINDOW_ID)) {
      win.document.documentElement.setAttribute(WINDOW_ID, `w-${Services.appinfo.processID}-${Math.random().toString(36).slice(2, 10)}`);
    }
    for (let tab of win.gBrowser.tabs) this.#ensureTabId(tab);
    // Local tab changes reach the sidebar at once instead of on the next poll.
    let listener = () => this.#requestTick();
    let container = win.gBrowser.tabContainer;
    for (let event of ["TabOpen", "TabClose", "TabSelect", "TabAttrModified", "TabPinned", "TabUnpinned"]) container.addEventListener(event, listener);
    win.addEventListener("unload", () => {
      for (let event of ["TabOpen", "TabClose", "TabSelect", "TabAttrModified", "TabPinned", "TabUnpinned"]) container.removeEventListener(event, listener);
      this.#windows.delete(win);
      this.#requestTick();
    }, { once: true });
    this.#windows.add(win);
    this.#requestTick();
  }

  #ensureTabId(tab) {
    let id = lazy.SessionStore.getCustomTabValue(tab, TAB_ID);
    if (!safeId(id)) {
      id = `t-${Math.random().toString(36).slice(2, 14)}`;
      lazy.SessionStore.setCustomTabValue(tab, TAB_ID, id);
    }
    return id;
  }

  #snapshot() {
    let windows = [];
    for (let win of this.#windows) {
      if (win.closed || !win.gBrowser || lazy.PrivateBrowsingUtils.isWindowPrivate(win)) continue;
      // A closing tab stays in gBrowser.tabs until its close animation ends.
      let value = (tab, key) => lazy.SessionStore.getCustomTabValue(tab, key);
      let tabs = win.gBrowser.tabs.filter(tab => !tab.closing).map(tab => ({
        id: this.#ensureTabId(tab),
        title: String(value(tab, TAB_TITLE) || tab.label || "New tab").slice(0, 300),
        favicon: safeFavicon(tab.image),
        home: isHomeTab(tab),
        selected: tab.selected,
        pinned: tab.pinned,
        muted: tab.muted,
        unloaded: !tab.linkedPanel,
        color: safeColor(value(tab, TAB_COLOR)),
        group: !!value(tab, TAB_GROUP),
        parent: value(tab, TAB_PARENT) || "",
        windowId: win.document.documentElement.getAttribute(WINDOW_ID),
      }));
      windows.push({ id: win.document.documentElement.getAttribute(WINDOW_ID), tabs, canReopen: lazy.SessionStore.getClosedTabCountForWindow(win) > 0 });
    }
    return { version: VERSION, mode: mode(), pid: Services.appinfo.processID, startTime: startTime(Services.appinfo.processID), updated: Date.now(), windows, count: windows.reduce((n, w) => n + w.tabs.length, 0) };
  }

  #publish() {
    this.#publishing = this.#publishing.then(async () => {
      try {
        let snapshot = this.#snapshot();
        let key = JSON.stringify({ ...snapshot, updated: 0 });
        if (key == this.#publishedKey && Date.now() - this.#publishedAt < REPUBLISH_MS) return;
        let dir = dataDir();
        await IOUtils.makeDirectory(dir, { ignoreExisting: true });
        await IOUtils.writeJSON(PathUtils.join(dir, `${mode()}.json`), snapshot, { tmpPath: PathUtils.join(dir, `${mode()}.tmp`) });
        this.#publishedKey = key;
        this.#publishedAt = snapshot.updated;
      } catch (e) { console.error("nullpath.tabs: publish failed", e); }
    });
    return this.#publishing;
  }

  async #readSnapshot(profileMode) {
    try {
      let path = PathUtils.join(dataDir(), `${profileMode}.json`);
      let data = await IOUtils.readJSON(path);
      if (data.version != VERSION || data.mode != profileMode || Date.now() - data.updated > SNAPSHOT_TTL || !Number.isInteger(data.pid)) return { mode: profileMode, count: 0, windows: [] };
      let alive = Services.appinfo.OS == "WINNT"
        ? ChromeUtils.importESModule("moz-src:///browser/components/nullpath/router/NullpathProcess.sys.mjs").NullpathProcess.isAlive(data.pid, data.startTime)
        : true; // Fresh periodic snapshots provide the liveness check elsewhere.
      if (!alive) return { mode: profileMode, count: 0, windows: [] };
      return { mode: profileMode, count: Number(data.count) || 0, windows: Array.isArray(data.windows) ? data.windows.map(w => ({ id: safeId(w.id) ? w.id : "", canReopen: !!w.canReopen, tabs: Array.isArray(w.tabs) ? w.tabs.filter(t => safeId(t.id)).map(t => ({ id: t.id, title: String(t.title || "New tab").slice(0, 300), favicon: safeFavicon(t.favicon), home: !!t.home, selected: !!t.selected, pinned: !!t.pinned, muted: !!t.muted, unloaded: !!t.unloaded, color: safeColor(t.color), group: !!t.group, parent: safeId(t.parent) ? t.parent : "", windowId: safeId(t.windowId) ? t.windowId : "" })) : [] })) : [] };
    } catch (e) { return { mode: profileMode, count: 0, windows: [] }; }
  }

  async listProfiles() { return Promise.all(MODES.map(m => this.#readSnapshot(m))); }

  /** Runs a tick now, or right after the one in flight. Coalesces bursts of tab events. */
  #requestTick() {
    if (this.#tickSoon) return;
    this.#tickSoon = true;
    Promise.resolve().then(() => { this.#tickSoon = false; this.#tick(); });
  }

  #tick() {
    if (this.#ticking) { this.#tickAgain = true; return this.#ticking; }
    this.#ticking = (async () => {
      try {
        do {
          this.#tickAgain = false;
          await this.#publish();
          await this.#processCommands();
          let profiles = await this.listProfiles();
          for (let listener of this.#listeners) { try { listener(profiles); } catch (e) {} }
        } while (this.#tickAgain);
      } finally { this.#ticking = null; }
    })();
    return this.#ticking;
  }

  async command(profileMode, action, windowId = "", tabId = "", sourceWindow = null, arg = null) {
    if (!MODES.includes(profileMode) || !validCommand(action, arg) || (windowId && !safeId(windowId)) || (tabId && !safeId(tabId))) return false;
    if (profileMode == mode() && action == "new") {
      let win = sourceWindow?.gBrowser ? sourceWindow : Services.wm.getMostRecentWindow("navigator:browser");
      if (win?.gBrowser) { win.gBrowser.addTab("about:newtab", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); win.focus(); return true; }
    }
    // Our own tabs need no command file round trip.
    if (profileMode == mode() && action != "new") {
      let found = this.#findTab(windowId, tabId);
      if (found) return this.#perform(found.win, found.tab, action, arg);
    }
    let id = `r-${Services.appinfo.processID}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    let path = PathUtils.join(dataDir(), `${profileMode}-command-${id}.json`);
    await IOUtils.writeJSON(path, { version: VERSION, id, mode: profileMode, action, arg: arg ?? null, windowId, tabId, from: Services.appinfo.processID, created: Date.now(), status: "pending" }, { tmpPath: `${path}.tmp` });
    let snapshot = await this.#readSnapshot(profileMode);
    if (!snapshot.count && profileMode != mode()) {
      await IOUtils.remove(path).catch(() => {});
      let profiles = ChromeUtils.importESModule("moz-src:///browser/components/nullpath/network/NullpathProfileMode.sys.mjs").NullpathProfileMode;
      await profiles.openInMode(profileMode);
      return true;
    }
    for (let n = 0; n < 60; n++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      try { let reply = await IOUtils.readJSON(path); if (reply.status != "pending") { await IOUtils.remove(path).catch(() => {}); return reply.status == "done"; } } catch (e) {}
    }
    await IOUtils.remove(path).catch(() => {});
    return false;
  }

  async #perform(win, tab, action, arg) {
    if (action == "focus") { win.gBrowser.selectedTab = tab; win.focus(); return true; }
    if (action == "close") { win.gBrowser.removeTab(tab); return true; }
    let ok = await lazy.NullpathTabTree.perform(win, tab, action, arg);
    this.#requestTick();
    return !!ok;
  }

  #findTab(windowId, tabId) {
    for (let win of this.#windows) {
      if (win.closed || !win.gBrowser || lazy.PrivateBrowsingUtils.isWindowPrivate(win)) continue;
      if (windowId && win.document.documentElement.getAttribute(WINDOW_ID) != windowId) continue;
      let tab = win.gBrowser.tabs.find(t => !t.closing && lazy.SessionStore.getCustomTabValue(t, TAB_ID) == tabId);
      if (tab) return { win, tab };
    }
    return null;
  }

  async #processCommands() {
    let dir = dataDir();
    let paths;
    try { paths = await IOUtils.getChildren(dir); } catch (e) { return; }
    for (let path of paths) {
      let match = /^(.+)-command-(r-[a-z0-9_-]+\.json)$/.exec(PathUtils.filename(path));
      if (!match || match[1] != mode() || this.#commands.has(path)) continue;
      this.#commands.add(path);
      this.#runCommand(path).finally(() => this.#commands.delete(path));
    }
  }

  async #runCommand(path) {
    let request;
    try { request = await IOUtils.readJSON(path); } catch (e) { return; }
    if (request.version != VERSION || request.mode != mode()) return;
    // An answered request stays until its sender reads it. The sender gives up
    // after a few seconds, so a late answer is left behind: never rerun one.
    if (request.status != "pending" || Date.now() - request.created > 30000) {
      if (Date.now() - request.created > 30000) await IOUtils.remove(path).catch(() => {});
      return;
    }
    if (!validCommand(request.action, request.arg)) return;
    let ok = false;
    try {
      if (request.action == "new") {
        let win = [...this.#windows].filter(w => !w.closed && !lazy.PrivateBrowsingUtils.isWindowPrivate(w)).at(-1);
        if (win?.gBrowser) { win.gBrowser.addTab("about:newtab", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); win.focus(); ok = true; }
      } else {
        for (let win of this.#windows) {
          if (lazy.PrivateBrowsingUtils.isWindowPrivate(win)) continue;
          if (request.windowId && win.document.documentElement.getAttribute(WINDOW_ID) != request.windowId) continue;
          let tab = win.gBrowser.tabs.find(t => lazy.SessionStore.getCustomTabValue(t, TAB_ID) == request.tabId);
          if (!tab) continue;
          if (request.action != "close") ok = await this.#perform(win, tab, request.action, request.arg ?? null);
          else {
            let targetClosed = false;
            await new Promise(resolve => {
              let done = event => {
                if (event?.target == tab) targetClosed = true;
                if (!event && !win.gBrowser?.tabs.includes(tab)) targetClosed = true;
                if (targetClosed || !win.gBrowser) {
                  win.gBrowser?.tabContainer.removeEventListener("TabClose", done);
                  resolve();
                }
              };
              win.gBrowser.tabContainer.addEventListener("TabClose", done);
              win.gBrowser.removeTab(tab);
              win.setTimeout(done, 2500);
            });
            ok = targetClosed || !win.gBrowser?.tabs.includes(tab);
          }
          break;
        }
      }
    } catch (e) { console.error("nullpath.tabs: command failed", e); }
    try { await IOUtils.writeJSON(path, { ...request, status: ok ? "done" : "failed", acknowledged: Date.now() }, { tmpPath: `${path}.tmp` }); } catch (e) {}
  }

  async #shutdown() {
    clearInterval(this.#timer);
    await this.#publishing;
    try { await IOUtils.remove(PathUtils.join(dataDir(), `${mode()}.json`)); } catch (e) {}
  }
}

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  SessionStore: "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  NullpathTabTree: "moz-src:///browser/components/nullpath/tabtree/NullpathTabTree.sys.mjs",
});
export const NullpathTabBridge = new TabBridge();
