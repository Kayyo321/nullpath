/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Browsing modes as profiles (§7.1) and the locked network prefs of the I2P
 * profiles (§8.2).
 *
 * The mode is read once at startup from `nullpath.mode` and locked. A profile
 * without the pref is an I2P sites profile: that is the launch profile, and
 * it's also the safe default for any profile created some other way.
 */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = XPCOMUtils.declareLazy({
  NullpathRouter:
    "moz-src:///browser/components/nullpath/router/NullpathRouter.sys.mjs",
  NullpathRouterConfig:
    "moz-src:///browser/components/nullpath/router/NullpathRouterConfig.sys.mjs",
  SelectableProfileService:
    "resource:///modules/profiles/SelectableProfileService.sys.mjs",
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
});

export const Modes = Object.freeze({
  SITES: "i2p-sites",
  PUBLIC_WEB: "i2p-publicweb",
  DIRECT: "direct",
});

const MODE_PREF = "nullpath.mode";

/** Fluent ids for the profile names and mode labels. */
export const MODE_L10N = Object.freeze({
  [Modes.SITES]: "nullpath-mode-i2p-sites",
  [Modes.PUBLIC_WEB]: "nullpath-mode-i2p-publicweb",
  [Modes.DIRECT]: "nullpath-mode-direct",
});

/** Profile names (§7.1). Not localized: they're stored in profiles.ini. */
const PROFILE_NAMES = Object.freeze({
  [Modes.SITES]: "Nullpath: I2P sites",
  [Modes.PUBLIC_WEB]: "Nullpath: Public web via I2P",
  [Modes.DIRECT]: "Nullpath: Direct web",
});

/** Placeholder used until a router is set up. Every request is blocked anyway. */
const UNSET_PROXY = { host: "127.0.0.1", port: 14444 };

/**
 * Prefs locked in both I2P profiles (§8.2). Proxy host/port are set per
 * mode by applyProxyPrefs().
 */
const LOCKED_PREFS = Object.freeze({
  "network.proxy.type": 1,
  "network.proxy.share_proxy_settings": true,
  "network.proxy.socks": "",
  "network.proxy.socks_port": 0,
  "network.proxy.socks_remote_dns": true,
  "network.proxy.no_proxies_on": "",
  "network.proxy.allow_hijacking_localhost": true,
  "network.proxy.failover_direct": false,
  "network.proxy.allow_bypass": false,
  "network.dns.disabled": true,
  "network.trr.mode": 5,
  "network.dns.disablePrefetch": true,
  "network.dns.disablePrefetchFromHTTPS": true,
  "network.predictor.enabled": false,
  "network.prefetch-next": false,
  "network.http.speculative-parallel-limit": 0,
  "browser.urlbar.speculativeConnect.enabled": false,
  "browser.places.speculativeConnect.enabled": false,
  "network.http.http3.enable": false,
  "network.webtransport.enabled": false,
  "media.peerconnection.enabled": false,
  "network.captive-portal-service.enabled": false,
  "network.connectivity-service.enabled": false,
  "geo.enabled": false,
  "geo.provider.network.url": "",
  "dom.push.enabled": false,
  "dom.push.connection.enabled": false,
  "browser.safebrowsing.malware.enabled": false,
  "browser.safebrowsing.phishing.enabled": false,
  "browser.safebrowsing.downloads.enabled": false,
  "browser.safebrowsing.downloads.remote.enabled": false,
  "browser.safebrowsing.blockedURIs.enabled": false,
  "extensions.update.enabled": false,
  "extensions.getAddons.cache.enabled": false,
  "xpinstall.enabled": false,
  "services.settings.server": "data:,#remote-settings-disabled",
  "browser.ipProtection.enabled": false,
  "security.OCSP.enabled": 0,
  "network.protocol-handler.warn-external-default": true,
  // §8.5: local new-tab page only.
  "browser.newtabpage.activity-stream.feeds.section.topstories": false,
  "browser.newtabpage.activity-stream.feeds.topsites": false,
  "browser.newtabpage.activity-stream.showSponsored": false,
  "browser.newtabpage.activity-stream.showSponsoredTopSites": false,
  "browser.newtabpage.activity-stream.feeds.snippets": false,
  "browser.newtabpage.activity-stream.feeds.system.topstories": false,
  "browser.newtabpage.activity-stream.feeds.weatherfeed": false,
  "browser.newtabpage.activity-stream.showWeather": false,
  "browser.newtabpage.activity-stream.feeds.telemetry": false,
  "browser.newtabpage.activity-stream.telemetry": false,
  // Telemetry and studies are already off in LibreWolf; lock them anyway.
  "toolkit.telemetry.enabled": false,
  "toolkit.telemetry.unified": false,
  "datareporting.healthreport.uploadEnabled": false,
  "datareporting.policy.dataSubmissionEnabled": false,
  "app.shield.optoutstudies.enabled": false,
  "app.normandy.enabled": false,
  "breakpad.reportURL": "",
  "browser.tabs.crashReporting.sendReport": false,
  "app.update.auto": false,
});

function setLocked(name, value) {
  let prefs = Services.prefs;
  if (prefs.prefIsLocked(name)) {
    prefs.unlockPref(name);
  }
  let branch = prefs.getDefaultBranch("");
  switch (typeof value) {
    case "boolean":
      branch.setBoolPref(name, value);
      break;
    case "number":
      branch.setIntPref(name, value);
      break;
    default:
      branch.setStringPref(name, value);
  }
  if (prefs.prefHasUserValue(name)) {
    prefs.clearUserPref(name);
  }
  prefs.lockPref(name);
}

function prefLine(name, value) {
  return `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`;
}

class ProfileModeSingleton {
  #mode = null;

  /** The mode of this process's profile. Read once, then fixed. */
  get mode() {
    if (!this.#mode) {
      let value = Services.prefs.getStringPref(MODE_PREF, "");
      this.#mode = Object.values(Modes).includes(value) ? value : Modes.SITES;
      setLocked(MODE_PREF, this.#mode);
    }
    return this.#mode;
  }

  get isI2P() {
    return this.mode != Modes.DIRECT;
  }

  /**
   * Early startup: lock the mode and every I2P pref before a window opens.
   * Uses the synchronous config read so the proxy is right from the start.
   */
  initEarly() {
    let mode = this.mode;
    if (mode == Modes.DIRECT) {
      setLocked("browser.ipProtection.enabled", false);
      return;
    }
    lazy.NullpathRouterConfig.loadSync();
    for (let [name, value] of Object.entries(LOCKED_PREFS)) {
      setLocked(name, value);
    }
    this.applyProxyPrefs();
    Services.obs.addObserver(() => this.applyProxyPrefs(), "nullpath-router-state-changed");
  }

  /** The proxy this profile uses (the mode's proxy, or a placeholder). */
  proxyEndpoint() {
    let endpoint = null;
    try {
      endpoint =
        this.mode == Modes.PUBLIC_WEB
          ? lazy.NullpathRouter.publicWebProxy()
          : lazy.NullpathRouter.sitesProxy();
    } catch (e) {}
    return endpoint ?? UNSET_PROXY;
  }

  applyProxyPrefs() {
    if (!this.isI2P) {
      return;
    }
    let { host, port } = this.proxyEndpoint();
    let current = Services.prefs.getStringPref("network.proxy.http", "");
    let currentPort = Services.prefs.getIntPref("network.proxy.http_port", 0);
    if (current == host && currentPort == port && Services.prefs.prefIsLocked("network.proxy.http")) {
      return;
    }
    setLocked("network.proxy.http", host);
    setLocked("network.proxy.http_port", port);
    setLocked("network.proxy.ssl", host);
    setLocked("network.proxy.ssl_port", port);
  }

  // --- profiles (§7.1) ----------------------------------------------------

  get #mapPath() {
    return PathUtils.join(lazy.NullpathRouterConfig.dir, "profiles.json");
  }

  async #readMap() {
    try {
      return await IOUtils.readJSON(this.#mapPath);
    } catch (e) {
      return {};
    }
  }

  get #profiles() {
    let service = lazy.SelectableProfileService;
    return service?.isEnabled ? service : null;
  }

  async profileForMode(mode) {
    let service = this.#profiles;
    if (!service) {
      return null;
    }
    let map = await this.#readMap();
    if (!map[mode]) {
      return null;
    }
    let all = await service.getAllProfiles();
    return all.find(p => p.path == map[mode]) ?? null;
  }

  /**
   * Creates the three profiles in one group on first run (§7.1), from the
   * I2P sites (launch) profile. The current profile becomes I2P sites.
   */
  async ensureProfiles() {
    let service = this.#profiles;
    if (!service || this.mode != Modes.SITES) {
      return;
    }
    let map = await this.#readMap();
    let all = await service.getAllProfiles();
    let exists = mode => map[mode] && all.some(p => p.path == map[mode]);
    if (exists(Modes.SITES) && exists(Modes.PUBLIC_WEB) && exists(Modes.DIRECT)) {
      this.#pinLaunchProfile(map[Modes.SITES]);
      return;
    }

    await service.maybeSetupDataStore();
    let current = service.currentProfile;
    if (!exists(Modes.SITES)) {
      await current.setNameAsync(PROFILE_NAMES[Modes.SITES]);
      map[Modes.SITES] = current.path;
    }
    for (let mode of [Modes.PUBLIC_WEB, Modes.DIRECT]) {
      if (exists(mode)) {
        continue;
      }
      let profile = await service.createNewProfile(false);
      await profile.setNameAsync(PROFILE_NAMES[mode]);
      let rootDir = await profile.rootDir;
      let lines = [prefLine(MODE_PREF, mode)];
      if (mode == Modes.DIRECT) {
        // nullpath.cfg makes every profile start behind the I2P proxy with
        // DNS off (fail-closed before any Nullpath code runs). Direct web
        // is the one profile that undoes that, back to Firefox's defaults.
        lines.push(
          prefLine("network.proxy.type", 5),
          prefLine("network.dns.disabled", false),
          prefLine("network.proxy.allow_hijacking_localhost", false),
          prefLine("network.captive-portal-service.enabled", true),
          prefLine("network.connectivity-service.enabled", true)
        );
      }
      if (mode == Modes.PUBLIC_WEB) {
        // Proxy settings apply from the very first start, before the
        // component locks them.
        lines.push(
          prefLine("network.proxy.type", 1),
          prefLine("network.proxy.http", UNSET_PROXY.host),
          prefLine("network.proxy.http_port", UNSET_PROXY.port),
          prefLine("network.proxy.share_proxy_settings", true),
          prefLine("network.dns.disabled", true)
        );
      }
      await IOUtils.writeUTF8(
        PathUtils.join(rootDir.path, "user.js"),
        "// Written by Nullpath when this profile was created.\n" + lines.join("\n") + "\n"
      );
      map[mode] = profile.path;
    }
    await IOUtils.makeDirectory(lazy.NullpathRouterConfig.dir, { ignoreExisting: true });
    await IOUtils.writeJSON(this.#mapPath, map, { tmpPath: this.#mapPath + ".tmp" });
    // Launch into I2P sites, not the profile selector (§7.1).
    await service.setShowProfileSelectorWindow(false);
    this.#pinLaunchProfile(map[Modes.SITES]);
  }

  /**
   * Firefox makes the most recently used profile the group default. Nullpath
   * always launches the I2P sites profile, so pin the default to it.
   */
  async #pinLaunchProfile(sitesPath) {
    let service = this.#profiles;
    if (!service || !sitesPath || service._nullpathPinned) {
      return;
    }
    let original = service.setDefaultProfileForGroup;
    service.setDefaultProfileForGroup = async () => {
      let all = await service.getAllProfiles();
      let sites = all.find(p => p.path == sitesPath);
      return original.call(service, sites ?? service.currentProfile);
    };
    service._nullpathPinned = true;
    await service.setDefaultProfileForGroup();
  }

  /** Called at startup in every profile to pin the launch profile. */
  async initProfiles() {
    // Idempotent; BrowserGlue starts it at the same point, and the profile
    // list and enabled state are only known once it has run.
    await lazy.SelectableProfileService?.init();
    if (this.mode == Modes.SITES) {
      await this.ensureProfiles();
      return;
    }
    let map = await this.#readMap();
    await this.#pinLaunchProfile(map[Modes.SITES]);
  }

  /**
   * Opens a window of another mode's profile (the visible mode switch the
   * panel's mode rows and the §7.4 hand-off use). Only URLs are passed on:
   * no referrer, cookies or form data.
   *
   * @returns {Promise<boolean>} false when the profile doesn't exist.
   */
  async openInMode(mode, url = null) {
    if (mode == this.mode) {
      let win = lazy.BrowserWindowTracker.getTopWindow();
      if (url) {
        win?.openTrustedLinkIn(url, "tab");
      } else {
        win?.OpenBrowserWindow();
      }
      return true;
    }
    let profile = await this.profileForMode(mode);
    if (!profile) {
      return false;
    }
    lazy.SelectableProfileService.launchInstance(profile, url ? [url] : []);
    return true;
  }
}

export const NullpathProfileMode = new ProfileModeSingleton();
