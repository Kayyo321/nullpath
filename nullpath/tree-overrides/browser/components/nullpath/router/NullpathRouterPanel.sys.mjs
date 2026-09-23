/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The router panel (§3) and its subviews, the setup chooser (§4) and the
 * guided-setup screens (§5.2–5.3). One NullpathRouterPanel per browser
 * window. All of it is parent-process chrome (§9).
 *
 * The panelviews are added to the window's appMenu-viewCache template at
 * runtime (see NullpathRouterWidget), so browser.xhtml needs no patch.
 */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = XPCOMUtils.declareLazy({
  detectRouter:
    "moz-src:///browser/components/nullpath/router/NullpathRouterDetect.sys.mjs",
  FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
  formatEndpoint:
    "moz-src:///browser/components/nullpath/router/NullpathRouterConfig.sys.mjs",
  isLoopbackHost:
    "moz-src:///browser/components/nullpath/router/NullpathRouterConfig.sys.mjs",
  Modes: "moz-src:///browser/components/nullpath/network/NullpathProfileMode.sys.mjs",
  NullpathManagedRouter:
    "moz-src:///browser/components/nullpath/router/NullpathManagedRouter.sys.mjs",
  NullpathProfileMode:
    "moz-src:///browser/components/nullpath/network/NullpathProfileMode.sys.mjs",
  NullpathRouter:
    "moz-src:///browser/components/nullpath/router/NullpathRouter.sys.mjs",
  NullpathRouterConfig:
    "moz-src:///browser/components/nullpath/router/NullpathRouterConfig.sys.mjs",
  NULLPATH_I2PD_SIZE_BYTES:
    "moz-src:///browser/components/nullpath/router/NullpathRouterManifest.sys.mjs",
  NULLPATH_I2PD_VERSION:
    "moz-src:///browser/components/nullpath/router/NullpathRouterManifest.sys.mjs",
  parseEndpoint:
    "moz-src:///browser/components/nullpath/router/NullpathRouterConfig.sys.mjs",
  parseLocalURL:
    "moz-src:///browser/components/nullpath/router/NullpathRouterConfig.sys.mjs",
  parseOutproxyDestination:
    "moz-src:///browser/components/nullpath/router/NullpathRouterConfig.sys.mjs",
  testProxy:
    "moz-src:///browser/components/nullpath/router/NullpathRouterDetect.sys.mjs",
  ClipboardHelper: {
    service: "@mozilla.org/widget/clipboardhelper;1",
    iid: Ci.nsIClipboardHelper,
  },
});

export const VIEWS = Object.freeze({
  MAIN: "nullpath-router-panel",
  SETTINGS: "nullpath-router-settings",
  MANAGE: "nullpath-router-manage",
  OWN: "nullpath-router-own",
  OUTPROXY: "nullpath-router-outproxy",
  ADVANCED: "nullpath-router-advanced",
  WHATIS: "nullpath-router-whatis",
});

const I2P_FAQ = "https://geti2p.net/en/faq";
const I2P_FAQ_OUTPROXY = "https://geti2p.net/en/faq#outproxy";
const RELAY_HELP_PREF = "nullpath.router.relayHelpSeen";
const PANEL_OPENED_PREF = "nullpath.router.panelOpened";

const SETUP_STEPS = ["download", "verify", "install", "ports", "start"];

/**
 * Guided setup runs once per application, whichever window started it, so
 * every window's panel shows the same progress.
 */
const SetupTask = {
  running: false,
  steps: {},
  error: null,
  controller: null,
  listeners: new Set(),

  notify() {
    for (let l of this.listeners) {
      l();
    }
  },

  async start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.error = null;
    this.steps = Object.fromEntries(SETUP_STEPS.map(s => [s, { status: "pending" }]));
    this.controller = new AbortController();
    this.notify();
    try {
      await lazy.NullpathManagedRouter.install({
        signal: this.controller.signal,
        onStep: (step, status, detail) => {
          this.steps[step] = { status, detail };
          this.notify();
        },
      });
      this.running = false;
      this.notify();
      // Step 5: start the router and move to Connecting (§5.3).
      await lazy.NullpathRouter.setEnabled(true);
    } catch (e) {
      this.running = false;
      this.error = e.l10nId ?? "nullpath-setup-error-generic";
      this.notify();
    }
  },

  cancel() {
    this.controller?.abort();
  },

  // Reinstalling after i2pd.exe went missing: same download and checks as
  // setup, but the router's identity, address book and settings are kept.
  reinstalling: false,
  reinstallError: null,

  async reinstall() {
    if (this.reinstalling) {
      return;
    }
    this.reinstalling = true;
    this.reinstallError = null;
    this.notify();
    try {
      await lazy.NullpathManagedRouter.update();
      await lazy.NullpathRouter.retry({ restart: true });
    } catch (e) {
      this.reinstallError = e.l10nId ?? "nullpath-setup-error-generic";
    }
    this.reinstalling = false;
    this.notify();
  },
};

// ---------------------------------------------------------------------------
// DOM helpers

function h(doc, tag, attrs = {}, ...children) {
  let el = tag.includes(":")
    ? doc.createXULElement(tag.split(":")[1])
    : doc.createElementNS("http://www.w3.org/1999/xhtml", tag);
  for (let [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) {
      continue;
    }
    if (k == "l10n") {
      doc.l10n.setAttributes(el, v.id, v.args);
    } else if (k.startsWith("on")) {
      el.addEventListener(k.slice(2), v);
    } else if (k == "class") {
      el.className = v;
    } else if (v === true) {
      el.setAttribute(k, "");
    } else {
      el.setAttribute(k, v);
    }
  }
  for (let child of children.flat()) {
    if (child == null || child === false) {
      continue;
    }
    el.append(typeof child == "string" ? doc.createTextNode(child) : child);
  }
  return el;
}

/** Builds an empty panelview with a header and a body. */
export function createPanelView(doc, id, titleL10nId, { main = false } = {}) {
  let view = doc.createXULElement("panelview");
  view.id = id;
  view.className = "PanelUI-subView nullpath-router-view";
  if (main) {
    view.setAttribute("mainview-with-header", "true");
    view.setAttribute("has-custom-header", "true");
  } else {
    view.setAttribute("title", "");
    view.setAttribute("data-l10n-id", titleL10nId);
    view.setAttribute("data-l10n-attrs", "title");
  }
  let body = doc.createXULElement("vbox");
  body.className = "panel-subview-body nullpath-router-body";
  view.append(body);
  return view;
}

// ---------------------------------------------------------------------------

export class NullpathRouterPanel {
  #win;
  #detection = null;
  #detecting = false;
  #chooserOverride = false; // "Restart guided setup"
  #screen = null; // null | "explain"
  #ownForm = {};
  #ownTest = null;
  #outproxyForm = null;
  #outproxyTestShown = false;
  #removeConfirm = false;
  #showPassword = false;
  #observer = () => this.update();
  #setupListener = () => this.update();

  constructor(win) {
    this.#win = win;
    Services.obs.addObserver(this.#observer, "nullpath-router-state-changed");
    SetupTask.listeners.add(this.#setupListener);
  }

  uninit() {
    Services.obs.removeObserver(this.#observer, "nullpath-router-state-changed");
    SetupTask.listeners.delete(this.#setupListener);
  }

  get #doc() {
    return this.#win.document;
  }

  #view(id) {
    return this.#doc.getElementById(id);
  }

  #body(id) {
    return this.#view(id)?.querySelector(".nullpath-router-body");
  }

  #isShown(id) {
    let view = this.#view(id);
    return !!view && view.hasAttribute("visible");
  }

  get #router() {
    return lazy.NullpathRouter;
  }

  get #config() {
    return lazy.NullpathRouter.config;
  }

  // --- events from the widget ---------------------------------------------

  showing(view) {
    if (view.id == VIEWS.MAIN) {
      Services.prefs.setBoolPref(PANEL_OPENED_PREF, true);
      if (this.#showChooser && !this.#detection && !this.#detecting) {
        this.#runDetection();
      }
      if (this.#router.isConnected) {
        this.#router.refreshDetails();
      }
    }
    this.#render(view.id);
  }

  hiding() {
    this.#removeConfirm = false;
    this.#outproxyTestShown = false;
    this.#screen = null;
    if (!this.#config.setup || this.#chooserOverride) {
      // The chooser runs detection again next time it opens.
      this.#detection = null;
    }
  }

  update() {
    for (let id of Object.values(VIEWS)) {
      if (this.#isShown(id)) {
        this.#render(id);
      }
    }
  }

  get #showChooser() {
    return (!this.#config.setup || this.#chooserOverride) && !SetupTask.running;
  }

  async #runDetection() {
    this.#detecting = true;
    this.update();
    try {
      this.#detection = await lazy.detectRouter();
    } catch (e) {
      this.#detection = { proxy: null };
    }
    this.#detecting = false;
    this.update();
  }

  #close() {
    this.#view(VIEWS.MAIN)?.closest("panel")?.hidePopup();
  }

  #showSubView(id, anchor) {
    let multiView = this.#view(VIEWS.MAIN)?.closest("panelmultiview");
    multiView?.showSubView(id, anchor);
  }

  #openTab(url) {
    this.#win.openTrustedLinkIn(url, "tab");
    this.#close();
  }

  // --- rendering ----------------------------------------------------------

  #render(id) {
    let body = this.#body(id);
    if (!body) {
      return;
    }
    let focusedId = this.#doc.activeElement?.id;
    let content;
    switch (id) {
      case VIEWS.MAIN:
        content = this.#renderMain();
        break;
      case VIEWS.SETTINGS:
        content = this.#renderSettings();
        break;
      case VIEWS.MANAGE:
        content = this.#renderManage();
        break;
      case VIEWS.OWN:
        content = this.#renderOwn();
        break;
      case VIEWS.OUTPROXY:
        content = this.#renderOutproxy();
        break;
      case VIEWS.ADVANCED:
        content = this.#renderAdvanced();
        break;
      case VIEWS.WHATIS:
        content = this.#renderWhatIs();
        break;
    }
    // Keep the aria-live status line node so screen readers hear changes.
    let live = body.querySelector("#nullpath-router-status");
    body.replaceChildren(...[content].flat().filter(Boolean));
    let newLive = body.querySelector("#nullpath-router-status");
    if (live && newLive) {
      live.replaceChildren(...newLive.childNodes);
      for (let a of ["data-l10n-id", "data-l10n-args", "class"]) {
        if (newLive.hasAttribute(a)) {
          live.setAttribute(a, newLive.getAttribute(a));
        } else {
          live.removeAttribute(a);
        }
      }
      newLive.replaceWith(live);
    }
    if (focusedId) {
      this.#doc.getElementById(focusedId)?.focus();
    }
  }

  // --- main view (§3.2) ---------------------------------------------------

  #renderMain() {
    let d = this.#doc;
    if (SetupTask.running || SetupTask.error) {
      return this.#renderProgress();
    }
    if (this.#screen == "explain") {
      return this.#renderExplain();
    }
    if (this.#showChooser) {
      return this.#renderChooser();
    }
    let router = this.#router;
    let config = this.#config;
    let state = router.state;
    let on = router.desired == "on";

    let header = h(d, "div", { class: "nullpath-router-header" },
      h(d, "h1", { class: "nullpath-router-title", l10n: { id: "nullpath-router-title" } }),
      h(d, "moz-toggle", {
        id: "nullpath-router-switch",
        pressed: on,
        l10n: { id: on ? "nullpath-router-switch-on" : "nullpath-router-switch-off" },
        "data-l10n-attrs": "label, aria-label",
        ontoggle: e => this.#onSwitch(e.target.pressed),
      })
    );

    let status = h(d, "p", {
      id: "nullpath-router-status",
      class: `nullpath-router-status nullpath-state-${state}`,
      "aria-live": "polite",
      l10n: this.#statusL10n(),
    });

    let extra = [];
    if (state == "connecting") {
      extra.push(this.#renderStages());
      extra.push(h(d, "button", {
        id: "nullpath-router-cancel",
        class: "text-link nullpath-router-link",
        l10n: { id: "nullpath-router-cancel" },
        onclick: () => this.#onSwitch(false),
      }));
    } else if (state == "attention") {
      extra.push(...this.#renderAttention());
    } else if (state == "connected") {
      extra.push(h(d, "p", { class: "nullpath-router-note", l10n: { id: "nullpath-router-first-site-note" } }));
    }

    let modes = h(d, "div", { class: "nullpath-router-section", role: "group", "aria-labelledby": "nullpath-router-modes-heading" },
      h(d, "h2", { id: "nullpath-router-modes-heading", l10n: { id: "nullpath-router-modes-heading" } }),
      this.#modeRow(lazy.Modes.SITES),
      this.#modeRow(lazy.Modes.PUBLIC_WEB),
      this.#modeRow(lazy.Modes.DIRECT)
    );

    let sites = null;
    try {
      sites = router.sitesProxy();
    } catch (e) {}
    let detailsId = "nullpath-router-details-unavailable";
    let detailsArgs = {};
    if (router.details && state == "connected") {
      detailsId = "nullpath-router-details";
      detailsArgs = {
        uptime: router.details.uptime ?? "—",
        peers: router.details.peers ?? 0,
      };
    }
    let info = h(d, "div", { class: "nullpath-router-section nullpath-router-info" },
      h(d, "div", { class: "nullpath-router-kv" },
        h(d, "span", { l10n: { id: "nullpath-router-proxy-label" } }),
        h(d, "span", {}, sites ? lazy.formatEndpoint(sites) : "—")
      ),
      h(d, "div", { class: "nullpath-router-kv" },
        h(d, "span", { l10n: { id: "nullpath-router-router-label" } }),
        h(d, "span", { l10n: { id: detailsId, args: detailsArgs } })
      ),
      this.#renderRelay()
    );

    let consoleURL = config.advanced?.showConsoleLink !== false ? router.consoleURL() : null;
    let footer = h(d, "div", { class: "nullpath-router-footer" },
      h(d, "div", { class: "nullpath-router-buttons" },
        lazy.NullpathProfileMode.mode != lazy.Modes.SITES
          ? h(d, "button", {
              id: "nullpath-router-open-i2p",
              class: "footer-button",
              l10n: { id: "nullpath-router-open-i2p-window" },
              onclick: () => {
                lazy.NullpathProfileMode.openInMode(lazy.Modes.SITES);
                this.#close();
              },
            })
          : null,
        consoleURL
          ? h(d, "button", {
              id: "nullpath-router-console",
              class: "footer-button",
              l10n: { id: "nullpath-router-console" },
              onclick: () => this.#openTab(consoleURL),
            })
          : null
      ),
      h(d, "div", { class: "nullpath-router-nav" },
        h(d, "button", {
          id: "nullpath-router-settings-button",
          class: "subviewbutton subviewbutton-nav",
          l10n: { id: "nullpath-router-settings" },
          onclick: e => this.#showSubView(VIEWS.SETTINGS, e.target),
        }),
        h(d, "button", {
          id: "nullpath-router-help-button",
          class: "subviewbutton subviewbutton-nav",
          l10n: { id: "nullpath-router-help" },
          onclick: e => this.#showSubView(VIEWS.WHATIS, e.target),
        })
      )
    );
    return [header, status, ...extra, h(d, "hr"), modes, h(d, "hr"), info, h(d, "hr"), footer];
  }

  #statusL10n() {
    let router = this.#router;
    let setup = this.#config.setup;
    let routerName = "none";
    let endpoint = "";
    if (setup == "managed") {
      routerName = "managed";
    } else if (setup == "external") {
      let kind = this.#config.external?.kind;
      routerName = kind == "java-i2p" ? "java" : kind == "i2pd" ? "i2pd" : "other";
      endpoint = this.#config.external?.sitesProxy ?? "";
    }
    return {
      id: "nullpath-router-status",
      args: { state: router.state, router: routerName, endpoint },
    };
  }

  #renderStages() {
    let d = this.#doc;
    let order = ["starting", "peers", "proxy"];
    let managed = this.#config.setup == "managed";
    let current = order.indexOf(this.#router.stage);
    return h(d, "ol", { class: "nullpath-router-stages" },
      order
        .filter(s => managed || s != "starting")
        .map(s => {
          let i = order.indexOf(s);
          let status = i < current ? "done" : i == current ? "running" : "pending";
          return h(d, "li", {
            class: `nullpath-step nullpath-step-${status}`,
            l10n: { id: `nullpath-router-stage-${s}` },
          });
        }),
      managed && !this.#config.managed?.firstStartDone
        ? h(d, "p", { class: "nullpath-router-note", l10n: { id: "nullpath-router-first-start-note" } })
        : null
    );
  }

  #renderAttention() {
    let d = this.#doc;
    let reason = this.#router.reason;
    let actions = {
      ROUTER_EXITED: [["nullpath-router-action-restart", () => this.#router.retry({ restart: true })]],
      ROUTER_MISSING: [
        ["nullpath-router-action-reinstall", () => SetupTask.reinstall()],
        ["nullpath-router-action-restart", () => this.#router.retry({ restart: true })],
      ],
      PROXY_UNREACHABLE: [
        ["nullpath-router-action-retry", () => this.#router.retry()],
        ["nullpath-router-action-edit", e => this.#showSubView(VIEWS.OWN, e.target)],
      ],
      PROXY_NOT_I2P: [["nullpath-router-action-edit", e => this.#showSubView(VIEWS.OWN, e.target)]],
      START_TIMEOUT: [
        ["nullpath-router-action-wait", () => this.#router.retry()],
        ["nullpath-router-action-console", () => this.#router.consoleURL() && this.#openTab(this.#router.consoleURL())],
      ],
    }[reason] ?? [];
    if (this.#config.setup == "managed") {
      actions = actions.map(a =>
        a[0] == "nullpath-router-action-edit"
          ? ["nullpath-router-action-manage", e => this.#showSubView(VIEWS.MANAGE, e.target)]
          : a
      );
    }
    let busy = SetupTask.reinstalling;
    return [
      h(d, "p", {
        id: "nullpath-router-attention-reason",
        class: "nullpath-router-note",
        l10n: { id: "nullpath-router-attention-reason", args: { reason: reason ?? "" } },
      }),
      busy
        ? h(d, "p", { class: "nullpath-router-note", role: "status", l10n: { id: "nullpath-router-reinstalling" } })
        : null,
      SetupTask.reinstallError && !busy
        ? h(d, "p", { class: "nullpath-router-error", role: "alert", l10n: { id: SetupTask.reinstallError } })
        : null,
      h(d, "div", { class: "nullpath-router-attention" },
        actions.map(([id, fn], i) =>
          h(d, "button", { id: `nullpath-router-attention-${i}`, class: "footer-button", disabled: busy, l10n: { id }, onclick: fn })
        )
      ),
    ];
  }

  #modeRow(mode) {
    let d = this.#doc;
    let router = this.#router;
    let current = lazy.NullpathProfileMode.mode == mode;
    let statusId;
    if (mode == lazy.Modes.DIRECT) {
      statusId = "nullpath-mode-status-direct";
    } else if (mode == lazy.Modes.SITES) {
      statusId = router.isConnected ? "nullpath-mode-status-ready" : "nullpath-mode-status-unavailable";
    } else {
      statusId = {
        ready: "nullpath-mode-status-ready",
        "no-outproxy": "nullpath-mode-status-no-outproxy",
        "outproxy-unreachable": "nullpath-mode-status-outproxy-unreachable",
      }[router.publicWebReadiness()] ?? "nullpath-mode-status-unavailable";
      if (router.outproxy.status == "checking") {
        statusId = "nullpath-mode-status-checking";
      }
    }
    return h(d, "button", {
      id: `nullpath-mode-row-${mode}`,
      class: "subviewbutton nullpath-mode-row" + (current ? "" : " subviewbutton-nav"),
      disabled: current,
      onclick: e => this.#onModeRow(mode, e.target),
    },
      h(d, "span", { class: "nullpath-mode-name", l10n: { id: `nullpath-mode-${mode}` } }),
      current
        ? h(d, "span", { class: "nullpath-mode-tag", l10n: { id: "nullpath-mode-this-window" } })
        : h(d, "span", { class: "nullpath-mode-status", l10n: { id: statusId } })
    );
  }

  async #onModeRow(mode, anchor) {
    if (mode == lazy.Modes.PUBLIC_WEB && this.#router.publicWebReadiness() != "ready") {
      this.#showSubView(VIEWS.OUTPROXY, anchor);
      return;
    }
    await lazy.NullpathProfileMode.openInMode(mode);
    this.#close();
  }

  #renderRelay() {
    let d = this.#doc;
    let managed = this.#config.setup == "managed";
    let on = !!this.#config.managed?.relay;
    let seen = Services.prefs.getBoolPref(RELAY_HELP_PREF, false);
    return h(d, "div", { class: "nullpath-router-relay" },
      h(d, "moz-toggle", {
        id: "nullpath-router-relay",
        pressed: managed && on,
        disabled: !managed,
        l10n: { id: "nullpath-router-relay" },
        "data-l10n-attrs": "label",
        ontoggle: e => this.#onRelay(e.target.pressed),
      }),
      managed
        ? h(d, "p", {
            class: "nullpath-router-help-text",
            l10n: { id: this.#router.relayPending ? "nullpath-router-relay-restart" : seen || !on ? "nullpath-router-relay-help-short" : "nullpath-router-relay-help" },
          })
        : h(d, "p", { class: "nullpath-router-help-text" },
            h(d, "span", { l10n: { id: "nullpath-router-relay-external" } }),
            this.#router.consoleURL()
              ? h(d, "button", {
                  class: "text-link nullpath-router-link",
                  l10n: { id: "nullpath-router-console" },
                  onclick: () => this.#openTab(this.#router.consoleURL()),
                })
              : null
          ),
      managed && on ? h(d, "p", { class: "nullpath-router-help-text", l10n: { id: "nullpath-router-relay-expire" } }) : null
    );
  }

  async #onSwitch(on) {
    try {
      await this.#router.setEnabled(on);
    } catch (e) {
      console.error(e);
    }
    this.update();
  }

  async #onRelay(on) {
    if (on && !Services.prefs.getBoolPref(RELAY_HELP_PREF, false)) {
      // The full text shows the first time relaying is turned on (§3.6).
      this.update();
      Services.prefs.setBoolPref(RELAY_HELP_PREF, true);
    }
    try {
      await this.#router.setRelay(on);
    } catch (e) {
      console.error(e);
    }
    this.update();
  }

  // --- chooser (§4.3) -----------------------------------------------------

  #renderChooser() {
    let d = this.#doc;
    let found = this.#detection?.proxy;
    let sizeMB = Math.round(lazy.NULLPATH_I2PD_SIZE_BYTES / 1e5) / 10;
    let card = (id, titleId, bodyEl, recommended, onclick) =>
      h(d, "button", { id, class: "nullpath-choice", onclick },
        h(d, "span", { class: "nullpath-choice-title" },
          h(d, "span", { l10n: { id: titleId } }),
          recommended ? h(d, "span", { class: "nullpath-choice-tag", l10n: { id: "nullpath-chooser-recommended" } }) : null
        ),
        bodyEl
      );
    return [
      h(d, "h1", { class: "nullpath-router-title", l10n: { id: "nullpath-chooser-title" } }),
      h(d, "p", { l10n: { id: "nullpath-chooser-intro" } }),
      card(
        "nullpath-choice-managed",
        "nullpath-chooser-managed",
        h(d, "span", { class: "nullpath-choice-body", l10n: { id: "nullpath-chooser-managed-body", args: { size: sizeMB } } }),
        !found,
        () => {
          this.#screen = "explain";
          this.update();
        }
      ),
      card(
        "nullpath-choice-own",
        "nullpath-chooser-own",
        this.#detecting
          ? h(d, "span", { class: "nullpath-choice-body", l10n: { id: "nullpath-chooser-detecting" } })
          : found
            ? h(d, "span", { class: "nullpath-choice-body", l10n: { id: "nullpath-chooser-found", args: { endpoint: lazy.formatEndpoint(found) } } })
            : null,
        !!found,
        e => {
          this.#ownForm = this.#formFromDetection();
          this.#showSubView(VIEWS.OWN, e.currentTarget);
        }
      ),
      h(d, "div", { class: "nullpath-router-nav" },
        h(d, "button", {
          id: "nullpath-chooser-not-now",
          class: "footer-button",
          l10n: { id: "nullpath-chooser-not-now" },
          onclick: () => {
            this.#chooserOverride = false;
            this.#close();
          },
        }),
        h(d, "button", {
          id: "nullpath-chooser-whatis",
          class: "subviewbutton subviewbutton-nav",
          l10n: { id: "nullpath-chooser-whatis" },
          onclick: e => this.#showSubView(VIEWS.WHATIS, e.target),
        })
      ),
    ];
  }

  #formFromDetection() {
    let det = this.#detection ?? {};
    let ext = this.#config.external;
    if (ext) {
      return {
        kind: ext.kind ?? "other",
        sitesProxy: ext.sitesProxy ?? "",
        publicWebProxy: ext.publicWebProxy ?? "",
        consoleURL: ext.consoleURL ?? "",
        controlURL: ext.control?.url ?? "",
        controlPassword: ext.control?.password ?? "",
        lanConfirmed: !!ext.allowLan,
      };
    }
    return {
      kind: det.kind ?? "other",
      sitesProxy: det.proxy ? lazy.formatEndpoint(det.proxy) : "127.0.0.1:4444",
      publicWebProxy: "",
      consoleURL: det.consoleURL ?? "",
      controlURL: det.controlURL ?? "",
      controlPassword: "",
      lanConfirmed: false,
    };
  }

  // --- guided setup (§5.2–5.3) --------------------------------------------

  #renderExplain() {
    let d = this.#doc;
    let items = [
      ["nullpath-setup-what", { version: lazy.NULLPATH_I2PD_VERSION }],
      ["nullpath-setup-where", {}],
      ["nullpath-setup-network-download", {}],
      ["nullpath-setup-network-router", {}],
      ["nullpath-setup-network-firewall", {}],
      ["nullpath-setup-network-relay", {}],
      ["nullpath-setup-unchanged", {}],
      ["nullpath-setup-remove", {}],
    ];
    return [
      h(d, "h1", { class: "nullpath-router-title", l10n: { id: "nullpath-setup-title" } }),
      h(d, "ul", { class: "nullpath-setup-explain" },
        items.map(([id, args]) => h(d, "li", { l10n: { id, args } }))
      ),
      h(d, "div", { class: "nullpath-router-buttons" },
        h(d, "button", {
          id: "nullpath-setup-back",
          class: "footer-button",
          l10n: { id: "nullpath-setup-back" },
          onclick: () => {
            this.#screen = null;
            this.update();
          },
        }),
        h(d, "button", {
          id: "nullpath-setup-install",
          class: "footer-button primary",
          l10n: { id: "nullpath-setup-install" },
          onclick: () => {
            this.#screen = null;
            this.#chooserOverride = false;
            SetupTask.start();
          },
        })
      ),
    ];
  }

  #renderProgress() {
    let d = this.#doc;
    let cancellable = SetupTask.running && SetupTask.steps.start?.status == "pending";
    return [
      h(d, "h1", { class: "nullpath-router-title", l10n: { id: "nullpath-setup-title" } }),
      h(d, "ol", { class: "nullpath-router-stages", "aria-live": "polite" },
        SETUP_STEPS.map(step => {
          let s = SetupTask.steps[step] ?? { status: "pending" };
          let status = s.status == "progress" ? "running" : s.status;
          let args = { percent: 0 };
          if (step == "download" && s.detail?.total) {
            args.percent = Math.floor((s.detail.received / s.detail.total) * 100);
          }
          return h(d, "li", {
            class: `nullpath-step nullpath-step-${status}`,
            l10n: { id: `nullpath-setup-step-${step}`, args },
          });
        })
      ),
      SetupTask.error
        ? h(d, "p", { class: "nullpath-router-error", role: "alert", l10n: { id: SetupTask.error } })
        : h(d, "p", { class: "nullpath-router-note", l10n: { id: "nullpath-router-first-start-note" } }),
      h(d, "div", { class: "nullpath-router-buttons" },
        cancellable
          ? h(d, "button", {
              id: "nullpath-setup-cancel",
              class: "footer-button",
              l10n: { id: "nullpath-router-cancel" },
              onclick: () => SetupTask.cancel(),
            })
          : null,
        SetupTask.error
          ? [
              h(d, "button", {
                id: "nullpath-setup-retry",
                class: "footer-button primary",
                l10n: { id: "nullpath-router-action-retry" },
                onclick: () => SetupTask.start(),
              }),
              h(d, "button", {
                id: "nullpath-setup-use-own",
                class: "footer-button",
                l10n: { id: "nullpath-chooser-own" },
                onclick: e => {
                  SetupTask.error = null;
                  this.#ownForm = this.#formFromDetection();
                  this.#showSubView(VIEWS.OWN, e.target);
                },
              }),
            ]
          : null
      ),
    ];
  }

  // --- own router form (§4.3) ---------------------------------------------

  #renderOwn() {
    let d = this.#doc;
    if (!this.#ownForm.sitesProxy && !this.#ownForm.kind) {
      this.#ownForm = this.#formFromDetection();
    }
    let f = this.#ownForm;
    let allowLan = !!this.#config.advanced?.allowLan;
    let field = (key, labelId, attrs = {}) => {
      let id = `nullpath-own-${key}`;
      return h(d, "div", { class: "nullpath-field" },
        h(d, "label", { for: id, l10n: { id: labelId } }),
        h(d, "input", {
          id,
          type: attrs.type ?? "text",
          value: f[key] ?? "",
          spellcheck: "false",
          "aria-describedby": `${id}-error`,
          oninput: e => {
            f[key] = e.target.value;
            this.#ownTest = null;
          },
        }),
        h(d, "p", { id: `${id}-error`, class: "nullpath-router-error", role: "alert", "data-for": key })
      );
    };
    let lanEndpoints = this.#lanHosts(f);
    return [
      h(d, "div", { class: "nullpath-field" },
        h(d, "label", { for: "nullpath-own-kind", l10n: { id: "nullpath-own-kind" } }),
        h(d, "select", {
          id: "nullpath-own-kind",
          onchange: e => {
            f.kind = e.target.value;
          },
        },
          ["java-i2p", "i2pd", "other"].map(k =>
            h(d, "option", { value: k, selected: f.kind == k, l10n: { id: `nullpath-own-kind-${k}` } })
          )
        )
      ),
      field("sitesProxy", "nullpath-own-sites-proxy"),
      field("publicWebProxy", "nullpath-own-publicweb-proxy"),
      field("consoleURL", "nullpath-own-console"),
      field("controlURL", "nullpath-own-control"),
      field("controlPassword", "nullpath-own-control-password", { type: "password" }),
      f.controlPassword
        ? h(d, "p", { class: "nullpath-router-help-text", l10n: { id: "nullpath-own-password-warning" } })
        : null,
      allowLan && lanEndpoints
        ? h(d, "label", { class: "nullpath-check" },
            h(d, "input", {
              type: "checkbox",
              id: "nullpath-own-lan-confirm",
              checked: f.lanConfirmed,
              onchange: e => {
                f.lanConfirmed = e.target.checked;
              },
            }),
            h(d, "span", { l10n: { id: "nullpath-own-lan-warning" } })
          )
        : null,
      this.#ownTest
        ? h(d, "p", { class: "nullpath-router-test-result", role: "status", l10n: { id: this.#ownTest.id, args: this.#ownTest.args } })
        : null,
      h(d, "div", { class: "nullpath-router-buttons" },
        h(d, "button", { id: "nullpath-own-test", class: "footer-button", l10n: { id: "nullpath-own-test" }, onclick: () => this.#testOwn() }),
        h(d, "button", { id: "nullpath-own-save", class: "footer-button", l10n: { id: "nullpath-own-save" }, onclick: () => this.#saveOwn(false) }),
        h(d, "button", { id: "nullpath-own-save-connect", class: "footer-button primary", l10n: { id: "nullpath-own-save-connect" }, onclick: () => this.#saveOwn(true) })
      ),
    ];
  }

  #lanHosts(f) {
    return [f.sitesProxy, f.publicWebProxy].some(v => {
      let host = /^\[?([^\]]+?)\]?:\d+$/.exec(String(v ?? "").trim())?.[1];
      return host && !lazy.isLoopbackHost(host);
    });
  }

  #showFieldError(key, l10nId) {
    let el = this.#body(VIEWS.OWN)?.querySelector(`[data-for="${key}"]`);
    if (el) {
      if (l10nId) {
        this.#doc.l10n.setAttributes(el, l10nId);
      } else {
        el.removeAttribute("data-l10n-id");
        el.textContent = "";
      }
    }
  }

  /** Validates the form; returns the external block or null. */
  #validateOwn() {
    let f = this.#ownForm;
    let allowLan = !!this.#config.advanced?.allowLan;
    let ok = true;
    let check = (key, fn) => {
      try {
        let v = fn();
        this.#showFieldError(key, null);
        return v;
      } catch (e) {
        this.#showFieldError(key, e.message);
        ok = false;
        return null;
      }
    };
    let sites = check("sitesProxy", () => lazy.parseEndpoint(f.sitesProxy, { allowLan }));
    let publicWeb = f.publicWebProxy?.trim()
      ? check("publicWebProxy", () => lazy.parseEndpoint(f.publicWebProxy, { allowLan }))
      : null;
    let consoleURL = f.consoleURL?.trim()
      ? check("consoleURL", () => lazy.parseLocalURL(f.consoleURL, { allowLan }).href)
      : null;
    let controlURL = f.controlURL?.trim()
      ? check("controlURL", () => lazy.parseLocalURL(f.controlURL, { allowLan }).href)
      : null;
    if (!ok) {
      return null;
    }
    let lan = this.#lanHosts(f);
    if (lan && !f.lanConfirmed) {
      this.#showFieldError("sitesProxy", "nullpath-own-lan-confirm-needed");
      return null;
    }
    return {
      kind: f.kind || "other",
      sitesProxy: lazy.formatEndpoint(sites),
      publicWebProxy: publicWeb ? lazy.formatEndpoint(publicWeb) : null,
      consoleURL,
      control: controlURL ? { url: controlURL, password: f.controlPassword ?? "" } : null,
      allowLan: lan,
    };
  }

  async #testOwn() {
    let allowLan = !!this.#config.advanced?.allowLan;
    let endpoint;
    try {
      endpoint = lazy.parseEndpoint(this.#ownForm.sitesProxy, { allowLan });
    } catch (e) {
      this.#showFieldError("sitesProxy", e.message);
      return;
    }
    this.#ownTest = { id: "nullpath-router-test-running", args: {} };
    this.update();
    let id = await lazy.testProxy(endpoint);
    this.#ownTest = { id, args: { endpoint: lazy.formatEndpoint(endpoint) } };
    this.update();
  }

  async #saveOwn(connect) {
    let external = this.#validateOwn();
    if (!external) {
      return;
    }
    await lazy.NullpathRouterConfig.update(c => {
      c.external = external;
      c.setup = "external";
    });
    this.#chooserOverride = false;
    if (connect) {
      await this.#router.setEnabled(false);
      await this.#router.setEnabled(true);
    }
    this.#view(VIEWS.MAIN)?.closest("panelmultiview")?.goBack?.();
    this.update();
  }

  // --- settings (§3.4) ----------------------------------------------------

  #renderSettings() {
    let d = this.#doc;
    let c = this.#config;
    let setRouter = async setup => {
      if (setup == c.setup) {
        return;
      }
      let wasOn = this.#router.desired == "on";
      if (wasOn) {
        await this.#router.setEnabled(false);
      }
      await lazy.NullpathRouterConfig.update(cfg => {
        cfg.setup = setup;
      });
      if (wasOn) {
        await this.#router.setEnabled(true);
      }
      this.update();
    };
    let radio = (setup, labelId, detail, buttonId, view, enabled) =>
      h(d, "div", { class: "nullpath-settings-row" },
        h(d, "label", { class: "nullpath-check" },
          h(d, "input", {
            type: "radio",
            name: "nullpath-router-choice",
            id: `nullpath-settings-${setup}`,
            checked: c.setup == setup,
            disabled: !enabled,
            onchange: () => setRouter(setup),
          }),
          h(d, "span", { l10n: { id: labelId } })
        ),
        h(d, "span", { class: "nullpath-settings-detail" }, detail),
        h(d, "button", {
          class: "subviewbutton subviewbutton-nav",
          id: `nullpath-settings-${setup}-edit`,
          l10n: { id: buttonId },
          onclick: e => {
            if (!enabled && setup == "managed") {
              this.#chooserOverride = false;
              this.#screen = "explain";
              this.#view(VIEWS.MAIN)?.closest("panelmultiview")?.goBack?.();
              this.update();
              return;
            }
            if (setup == "external") {
              this.#ownForm = this.#formFromDetection();
            }
            this.#showSubView(view, e.target);
          },
        })
      );
    return [
      h(d, "h2", { l10n: { id: "nullpath-settings-router" } }),
      radio(
        "managed",
        "nullpath-settings-managed",
        c.managed ? `v${c.managed.i2pdVersion}` : "",
        c.managed ? "nullpath-settings-manage" : "nullpath-settings-install",
        VIEWS.MANAGE,
        !!c.managed
      ),
      radio(
        "external",
        "nullpath-settings-external",
        c.external?.sitesProxy ?? "",
        "nullpath-settings-edit",
        VIEWS.OWN,
        !!c.external
      ),
      h(d, "button", {
        id: "nullpath-settings-outproxy",
        class: "subviewbutton subviewbutton-nav",
        l10n: { id: "nullpath-settings-outproxy" },
        onclick: e => this.#showSubView(VIEWS.OUTPROXY, e.target),
      }),
      h(d, "button", {
        id: "nullpath-settings-advanced",
        class: "subviewbutton subviewbutton-nav",
        l10n: { id: "nullpath-settings-advanced" },
        onclick: e => this.#showSubView(VIEWS.ADVANCED, e.target),
      }),
      h(d, "button", {
        id: "nullpath-settings-restart-setup",
        class: "subviewbutton",
        l10n: { id: "nullpath-settings-restart-setup" },
        onclick: () => {
          this.#chooserOverride = true;
          this.#detection = null;
          this.#runDetection();
          this.#view(VIEWS.MAIN)?.closest("panelmultiview")?.goBack?.();
          this.update();
        },
      }),
    ];
  }

  #renderManage() {
    let d = this.#doc;
    let m = this.#config.managed;
    if (!m) {
      return h(d, "p", { l10n: { id: "nullpath-manage-none" } });
    }
    let managed = lazy.NullpathManagedRouter;
    let kv = (labelId, value) =>
      h(d, "div", { class: "nullpath-router-kv" }, h(d, "span", { l10n: { id: labelId } }), h(d, "span", {}, value));
    return [
      kv("nullpath-manage-version", m.i2pdVersion),
      h(d, "div", { class: "nullpath-router-kv" },
        h(d, "span", { l10n: { id: "nullpath-manage-folder" } }),
        h(d, "button", {
          id: "nullpath-manage-open-folder",
          class: "text-link nullpath-router-link",
          l10n: { id: "nullpath-manage-open-folder" },
          onclick: () => {
            try {
              new lazy.FileUtils.File(m.dir).reveal();
            } catch (e) {
              console.error(e);
            }
          },
        })
      ),
      kv("nullpath-manage-ports", `${m.ports.sites}, ${m.ports.publicWeb}, ${m.ports.console}, ${m.ports.control}, ${m.ports.router}`),
      h(d, "div", { class: "nullpath-field" },
        h(d, "label", { for: "nullpath-manage-bandwidth", l10n: { id: "nullpath-manage-bandwidth" } }),
        h(d, "select", {
          id: "nullpath-manage-bandwidth",
          onchange: async e => {
            await managed.setBandwidth(e.target.value);
            this.update();
          },
        },
          [["L", "low"], ["O", "medium"], ["P", "high"]].map(([v, name]) =>
            h(d, "option", { value: v, selected: m.bandwidth == v, l10n: { id: `nullpath-manage-bandwidth-${name}` } })
          )
        ),
        h(d, "p", { class: "nullpath-router-help-text", l10n: { id: "nullpath-manage-restart-note" } })
      ),
      h(d, "moz-toggle", {
        id: "nullpath-manage-keep-running",
        pressed: !!m.keepRunningWhenDisconnected,
        l10n: { id: "nullpath-manage-keep-running" },
        "data-l10n-attrs": "label",
        ontoggle: async e => {
          await managed.setKeepRunning(e.target.pressed);
          this.update();
        },
      }),
      h(d, "moz-toggle", {
        id: "nullpath-manage-upnp",
        pressed: !!m.upnp,
        l10n: { id: "nullpath-manage-upnp" },
        "data-l10n-attrs": "label",
        ontoggle: async e => {
          await managed.setUpnp(e.target.pressed);
          this.update();
        },
      }),
      h(d, "p", { class: "nullpath-router-help-text", l10n: { id: "nullpath-manage-upnp-help" } }),
      h(d, "div", { class: "nullpath-router-kv" },
        h(d, "span", { l10n: { id: "nullpath-manage-console-password" } }),
        this.#showPassword
          ? h(d, "span", { class: "nullpath-password" },
              h(d, "code", {}, m.consolePassword),
              h(d, "button", {
                id: "nullpath-manage-copy-password",
                class: "text-link nullpath-router-link",
                l10n: { id: "nullpath-copy" },
                onclick: () => lazy.ClipboardHelper.copyString(m.consolePassword),
              })
            )
          : h(d, "button", {
              id: "nullpath-manage-show-password",
              class: "text-link nullpath-router-link",
              l10n: { id: "nullpath-show" },
              onclick: () => {
                this.#showPassword = true;
                this.update();
              },
            })
      ),
      managed.updateAvailable
        ? h(d, "button", {
            id: "nullpath-manage-update",
            class: "footer-button",
            l10n: { id: "nullpath-manage-update", args: { version: lazy.NULLPATH_I2PD_VERSION } },
            onclick: async () => {
              try {
                await managed.update();
              } catch (e) {
                console.error(e);
              }
              this.update();
            },
          })
        : null,
      this.#removeConfirm
        ? h(d, "div", { class: "nullpath-router-confirm", role: "alertdialog", "aria-labelledby": "nullpath-remove-warning" },
            h(d, "p", { id: "nullpath-remove-warning", l10n: { id: "nullpath-manage-remove-warning" } }),
            h(d, "div", { class: "nullpath-router-buttons" },
              h(d, "button", {
                id: "nullpath-manage-remove-cancel",
                class: "footer-button",
                l10n: { id: "nullpath-setup-back" },
                onclick: () => {
                  this.#removeConfirm = false;
                  this.update();
                },
              }),
              h(d, "button", {
                id: "nullpath-manage-remove-confirm",
                class: "footer-button destructive",
                l10n: { id: "nullpath-manage-remove" },
                onclick: async () => {
                  this.#removeConfirm = false;
                  if (this.#config.setup == "managed") {
                    await this.#router.setEnabled(false).catch(() => {});
                  }
                  await managed.remove();
                  this.#view(VIEWS.MAIN)?.closest("panelmultiview")?.goBack?.();
                  this.update();
                },
              })
            )
          )
        : h(d, "button", {
            id: "nullpath-manage-remove",
            class: "footer-button destructive",
            l10n: { id: "nullpath-manage-remove" },
            onclick: () => {
              this.#removeConfirm = true;
              this.update();
            },
          }),
    ];
  }

  // --- outproxy (§3.5) ----------------------------------------------------

  #renderOutproxy() {
    let d = this.#doc;
    let c = this.#config;
    let managed = c.setup == "managed";
    if (!this.#outproxyForm) {
      this.#outproxyForm = {
        destination: c.outproxy?.destination ?? "",
        operatorNote: c.outproxy?.operatorNote ?? "",
        publicWebProxy: c.external?.publicWebProxy ?? "",
        acknowledged: !!c.outproxy?.acknowledged,
      };
    }
    let f = this.#outproxyForm;
    let input = (key, labelId) =>
      h(d, "div", { class: "nullpath-field" },
        h(d, "label", { for: `nullpath-outproxy-${key}`, l10n: { id: labelId } }),
        h(d, "input", {
          id: `nullpath-outproxy-${key}`,
          type: "text",
          value: f[key],
          spellcheck: "false",
          oninput: e => {
            f[key] = e.target.value;
          },
        }),
        h(d, "p", { class: "nullpath-router-error", role: "alert", "data-for": key })
      );
    let op = this.#router.outproxy;
    let resultId = {
      ok: "nullpath-outproxy-reachable",
      // No status means the router gave up or closed without answering.
      unreachable: op.httpStatus ? "nullpath-outproxy-unreachable" : "nullpath-outproxy-no-response",
      checking: "nullpath-router-test-running",
    }[op.status];
    if (!c.setup) {
      return h(d, "p", { l10n: { id: "nullpath-outproxy-needs-router" } });
    }
    return [
      h(d, "p", { l10n: { id: "nullpath-outproxy-intro" } }),
      managed ? input("destination", "nullpath-outproxy-destination") : input("publicWebProxy", "nullpath-own-publicweb-proxy"),
      managed ? input("operatorNote", "nullpath-outproxy-note") : null,
      managed
        ? h(d, "button", {
            id: "nullpath-outproxy-suggestions",
            class: "text-link nullpath-router-link",
            l10n: { id: "nullpath-outproxy-suggestions" },
            onclick: () => this.#openTab(I2P_FAQ_OUTPROXY),
          })
        : null,
      h(d, "blockquote", { id: "nullpath-outproxy-ack-text", class: "nullpath-router-ack", l10n: { id: "nullpath-outproxy-ack" } }),
      h(d, "label", { class: "nullpath-check" },
        h(d, "input", {
          type: "checkbox",
          id: "nullpath-outproxy-ack-box",
          checked: f.acknowledged,
          "aria-describedby": "nullpath-outproxy-ack-text",
          onchange: e => {
            f.acknowledged = e.target.checked;
            this.update();
          },
        }),
        h(d, "span", { l10n: { id: "nullpath-outproxy-ack-check" } })
      ),
      h(d, "div", { class: "nullpath-router-buttons" },
        h(d, "button", {
          id: "nullpath-outproxy-save",
          class: "footer-button primary",
          disabled: !f.acknowledged,
          l10n: { id: "nullpath-own-save" },
          onclick: () => this.#saveOutproxy(),
        }),
        h(d, "button", {
          id: "nullpath-outproxy-test",
          class: "footer-button",
          disabled: !this.#router.publicWebProxy(),
          l10n: { id: this.#outproxyTestShown ? "nullpath-outproxy-test-send" : "nullpath-outproxy-test" },
          onclick: () => {
            if (!this.#outproxyTestShown) {
              // Show the URL before sending anything (§3.5).
              this.#outproxyTestShown = true;
              this.update();
              return;
            }
            this.#router.checkOutproxy();
          },
        })
      ),
      this.#outproxyTestShown
        ? h(d, "p", { class: "nullpath-router-help-text", l10n: { id: "nullpath-outproxy-test-url", args: { url: this.#router.outproxyTestURL } } })
        : null,
      resultId
        ? h(d, "p", { class: "nullpath-router-test-result", role: "status", l10n: { id: resultId, args: { status: op.httpStatus } } })
        : null,
    ];
  }

  async #saveOutproxy() {
    let f = this.#outproxyForm;
    let c = this.#config;
    let body = this.#body(VIEWS.OUTPROXY);
    let err = (key, id) => {
      let el = body?.querySelector(`[data-for="${key}"]`);
      if (el) {
        this.#doc.l10n.setAttributes(el, id);
      }
    };
    if (!f.acknowledged) {
      return;
    }
    if (c.setup == "managed") {
      let dest;
      try {
        dest = lazy.parseOutproxyDestination(f.destination);
      } catch (e) {
        err("destination", e.message);
        return;
      }
      await lazy.NullpathRouterConfig.update(cfg => {
        cfg.outproxy = { destination: dest || null, operatorNote: f.operatorNote.trim(), acknowledged: true };
      });
      await lazy.NullpathManagedRouter.setOutproxy(dest || null);
    } else {
      let allowLan = !!c.advanced?.allowLan;
      let endpoint = null;
      if (f.publicWebProxy.trim()) {
        try {
          endpoint = lazy.formatEndpoint(lazy.parseEndpoint(f.publicWebProxy, { allowLan }));
        } catch (e) {
          err("publicWebProxy", e.message);
          return;
        }
      }
      await lazy.NullpathRouterConfig.update(cfg => {
        cfg.external.publicWebProxy = endpoint;
        cfg.outproxy = { ...cfg.outproxy, acknowledged: true };
      });
    }
    this.#outproxyForm = null;
    Services.obs.notifyObservers(null, "nullpath-router-state-changed");
    this.#router.checkOutproxy();
  }

  // --- advanced -----------------------------------------------------------

  #renderAdvanced() {
    let d = this.#doc;
    let adv = this.#config.advanced ?? {};
    let setAdv = async (key, value) => {
      await lazy.NullpathRouterConfig.update(c => {
        c.advanced = { ...c.advanced, [key]: value };
      });
      this.update();
    };
    return [
      h(d, "div", { class: "nullpath-field" },
        h(d, "label", { for: "nullpath-advanced-interval", l10n: { id: "nullpath-advanced-interval" } }),
        h(d, "input", {
          id: "nullpath-advanced-interval",
          type: "number",
          min: "5",
          max: "300",
          value: String(adv.checkIntervalSec ?? 15),
          onchange: e => setAdv("checkIntervalSec", Math.min(300, Math.max(5, Number(e.target.value) || 15))),
        })
      ),
      h(d, "moz-toggle", {
        id: "nullpath-advanced-console-link",
        pressed: adv.showConsoleLink !== false,
        l10n: { id: "nullpath-advanced-console-link" },
        "data-l10n-attrs": "label",
        ontoggle: e => setAdv("showConsoleLink", e.target.pressed),
      }),
      h(d, "moz-toggle", {
        id: "nullpath-advanced-allow-lan",
        pressed: !!adv.allowLan,
        l10n: { id: "nullpath-advanced-allow-lan" },
        "data-l10n-attrs": "label",
        ontoggle: e => setAdv("allowLan", e.target.pressed),
      }),
      h(d, "button", {
        id: "nullpath-advanced-diagnostics",
        class: "footer-button",
        l10n: { id: "nullpath-advanced-diagnostics" },
        onclick: async e => {
          lazy.ClipboardHelper.copyString(await this.#diagnostics());
          this.#doc.l10n.setAttributes(e.target, "nullpath-advanced-diagnostics-copied");
        },
      }),
    ];
  }

  /** State, redacted endpoints, the last check and the log tail. Never sent anywhere. */
  async #diagnostics() {
    let r = this.#router;
    let c = this.#config;
    let redact = s => (s ? String(s).replace(/:\d+/, ":<port>") : null);
    let lines = [
      `Nullpath ${Services.appinfo.version}`,
      `mode: ${lazy.NullpathProfileMode.mode}`,
      `setup: ${c.setup}`,
      `desired: ${r.desired}`,
      `state: ${r.state}${r.reason ? " (" + r.reason + ")" : ""}${r.stage ? " stage " + r.stage : ""}`,
      `sites proxy: ${redact(c.setup == "external" ? c.external?.sitesProxy : "127.0.0.1:managed")}`,
      `public-web proxy: ${redact(c.external?.publicWebProxy) ?? (c.outproxy?.destination ? "managed" : "none")}`,
      `outproxy check: ${r.outproxy.status} ${r.outproxy.httpStatus || ""}`,
      `i2pd: ${c.managed?.i2pdVersion ?? "-"}`,
    ];
    if (c.setup == "managed") {
      lines.push("", "--- i2pd.log (last 50 lines) ---", await lazy.NullpathManagedRouter.readLogTail(50));
    }
    return lines.join("\n");
  }

  #renderWhatIs() {
    let d = this.#doc;
    return [
      h(d, "p", { l10n: { id: "nullpath-whatis-router" } }),
      h(d, "p", { l10n: { id: "nullpath-whatis-browser-only" } }),
      h(d, "p", { l10n: { id: "nullpath-whatis-other-apps" } }),
      h(d, "button", {
        id: "nullpath-whatis-faq",
        class: "text-link nullpath-router-link",
        l10n: { id: "nullpath-whatis-faq" },
        onclick: () => this.#openTab(I2P_FAQ),
      }),
    ];
  }
}
