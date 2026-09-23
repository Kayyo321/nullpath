/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Local-only tab directory shared by Nullpath's three isolated profile
 * processes. Its schema contains only profile/window/tab ids, title, favicon
 * URI, selected/pinned state and count. Commands are one-shot files scoped to
 * a profile and acknowledged by the owning process after the operation.
 */
import { setInterval, clearInterval } from "resource://gre/modules/Timer.sys.mjs";

const MODES = ["i2p-sites", "i2p-publicweb", "direct"];
const VERSION = 1;
const POLL_MS = 1000;
const SNAPSHOT_TTL = 10000;
const WINDOW_ID = "nullpath-window-id";
const TAB_ID = "nullpath-tab-id";

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
  return /^(?:moz-anno:favicon:|data:image\/(?:png|jpeg|webp|gif);base64,)/i.test(value) && value.length < 4096 ? value : "";
}

class TabBridge {
  #windows = new Set();
  #timer;
  #publishing = Promise.resolve();
  #listeners = new Set();
  #commands = new Set();
  #seen = new Set();

  constructor() {
    if (Services.appinfo.processType != Services.appinfo.PROCESS_TYPE_DEFAULT) return;
    this.#timer = setInterval(() => this.#tick(), POLL_MS);
    Services.obs.addObserver(() => this.#shutdown(), "quit-application-granted");
  }

  addListener(callback) { this.#listeners.add(callback); this.#tick(); }
  removeListener(callback) { this.#listeners.delete(callback); }

  onWindowReady(win) {
    if (!win?.gBrowser || Services.appinfo.processType != Services.appinfo.PROCESS_TYPE_DEFAULT) return;
    if (!win.document.documentElement.hasAttribute(WINDOW_ID)) {
      win.document.documentElement.setAttribute(WINDOW_ID, `w-${Services.appinfo.processID}-${Math.random().toString(36).slice(2, 10)}`);
    }
    for (let tab of win.gBrowser.tabs) this.#ensureTabId(tab);
    let listener = () => this.#publish();
    let container = win.gBrowser.tabContainer;
    for (let event of ["TabOpen", "TabClose", "TabSelect", "TabAttrModified", "TabPinned", "TabUnpinned"]) container.addEventListener(event, listener);
    win.addEventListener("unload", () => {
      for (let event of ["TabOpen", "TabClose", "TabSelect", "TabAttrModified", "TabPinned", "TabUnpinned"]) container.removeEventListener(event, listener);
      this.#windows.delete(win);
      this.#publish();
    }, { once: true });
    this.#windows.add(win);
    this.#publish();
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
      let tabs = win.gBrowser.tabs.map(tab => ({
        id: this.#ensureTabId(tab),
        title: String(tab.label || "New tab").slice(0, 300),
        favicon: safeFavicon(tab.image),
        selected: tab.selected,
        pinned: tab.pinned,
        parent: lazy.SessionStore.getCustomTabValue(tab, "nullpath-tab-parent") || "",
        windowId: win.document.documentElement.getAttribute(WINDOW_ID),
      }));
      windows.push({ id: win.document.documentElement.getAttribute(WINDOW_ID), tabs });
    }
    return { version: VERSION, mode: mode(), pid: Services.appinfo.processID, startTime: startTime(Services.appinfo.processID), updated: Date.now(), windows, count: windows.reduce((n, w) => n + w.tabs.length, 0) };
  }

  #publish() {
    this.#publishing = this.#publishing.then(async () => {
      try {
        let dir = dataDir();
        await IOUtils.makeDirectory(dir, { ignoreExisting: true });
        await IOUtils.writeJSON(PathUtils.join(dir, `${mode()}.json`), this.#snapshot(), { tmpPath: PathUtils.join(dir, `${mode()}.tmp`) });
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
      return { mode: profileMode, count: Number(data.count) || 0, windows: Array.isArray(data.windows) ? data.windows.map(w => ({ id: safeId(w.id) ? w.id : "", tabs: Array.isArray(w.tabs) ? w.tabs.filter(t => safeId(t.id)).map(t => ({ id: t.id, title: String(t.title || "New tab").slice(0, 300), favicon: safeFavicon(t.favicon), selected: !!t.selected, pinned: !!t.pinned, parent: safeId(t.parent) ? t.parent : "", windowId: safeId(t.windowId) ? t.windowId : "" })) : [] })) : [] };
    } catch (e) { return { mode: profileMode, count: 0, windows: [] }; }
  }

  async listProfiles() { return Promise.all(MODES.map(m => this.#readSnapshot(m))); }

  async #tick() {
    await this.#publish();
    await this.#processCommands();
    let profiles = await this.listProfiles();
    for (let listener of this.#listeners) { try { listener(profiles); } catch (e) {} }
  }

  async command(profileMode, action, windowId = "", tabId = "", sourceWindow = null) {
    if (!MODES.includes(profileMode) || !["focus", "close", "new"].includes(action) || (windowId && !safeId(windowId)) || (tabId && !safeId(tabId))) return false;
    if (profileMode == mode() && action == "new") {
      let win = sourceWindow?.gBrowser ? sourceWindow : Services.wm.getMostRecentWindow("navigator:browser");
      if (win?.gBrowser) { win.gBrowser.addTab("about:newtab", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); win.focus(); return true; }
    }
    let id = `r-${Services.appinfo.processID}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    let path = PathUtils.join(dataDir(), `${profileMode}-command-${id}.json`);
    await IOUtils.writeJSON(path, { version: VERSION, id, mode: profileMode, action, windowId, tabId, from: Services.appinfo.processID, created: Date.now(), status: "pending" }, { tmpPath: `${path}.tmp` });
    let snapshot = await this.#readSnapshot(profileMode);
    if (!snapshot.count && profileMode != mode()) {
      await IOUtils.remove(path).catch(() => {});
      let profiles = ChromeUtils.importESModule("moz-src:///browser/components/nullpath/network/NullpathProfileMode.sys.mjs").NullpathProfileMode;
      await profiles.openInMode(profileMode);
      return true;
    }
    for (let n = 0; n < 30; n++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      try { let reply = await IOUtils.readJSON(path); if (reply.status != "pending") { await IOUtils.remove(path).catch(() => {}); return reply.status == "done"; } } catch (e) {}
    }
    await IOUtils.remove(path).catch(() => {});
    return false;
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
    if (request.version != VERSION || request.mode != mode() || Date.now() - request.created > 30000 || !["focus", "close", "new"].includes(request.action)) return;
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
          if (request.action == "focus") { win.gBrowser.selectedTab = tab; win.focus(); ok = true; }
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
});
export const NullpathTabBridge = new TabBridge();
