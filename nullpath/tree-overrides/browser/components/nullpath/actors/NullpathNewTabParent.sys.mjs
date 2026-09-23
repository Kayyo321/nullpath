/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = XPCOMUtils.declareLazy({
  NullpathRouter: "moz-src:///browser/components/nullpath/router/NullpathRouter.sys.mjs",
  NullpathRouterWidget: "moz-src:///browser/components/nullpath/router/NullpathRouterWidget.sys.mjs",
  NullpathProfileMode: "moz-src:///browser/components/nullpath/network/NullpathProfileMode.sys.mjs",
  Modes: "moz-src:///browser/components/nullpath/network/NullpathProfileMode.sys.mjs",
});

export class NullpathNewTabParent extends JSWindowActorParent {
  #observer = () => this.#sendState();
  #prefObserver = { observe: () => this.#sendState() };
  actorCreated() {
    Services.obs.addObserver(this.#observer, "nullpath-router-state-changed");
    Services.obs.addObserver(this.#observer, "look-and-feel-changed");
    Services.prefs.addObserver("nullpath.appearance", this.#prefObserver);
    this.#sendState();
  }
  didDestroy() {
    Services.obs.removeObserver(this.#observer, "nullpath-router-state-changed");
    Services.obs.removeObserver(this.#observer, "look-and-feel-changed");
    Services.prefs.removeObserver("nullpath.appearance", this.#prefObserver);
  }

  #state() {
    let router = lazy.NullpathRouter;
    let mode = lazy.NullpathProfileMode.mode;
    let show = mode != lazy.Modes.DIRECT && router.state != "connected";
    let appearance = Services.prefs.getStringPref("nullpath.appearance", "system");
    let win = this.browsingContext.top.embedderElement?.ownerGlobal;
    return {
      show,
      state: router.state,
      setup: !!router.setup,
      mode,
      dark: appearance == "dark" ||
        (appearance == "system" &&
          !!win?.matchMedia?.("(prefers-color-scheme: dark)").matches),
    };
  }

  #sendState() {
    try { this.sendAsyncMessage("NullpathNewTab:State", this.#state()); } catch (e) {}
  }

  async receiveMessage(message) {
    if (message.name != "NullpathNewTab:Action" || !["state", "open-panel"].includes(message.data?.action)) return;
    let browser = this.browsingContext.top.embedderElement;
    if (!browser) return;
    if (message.data.action == "state") { this.#sendState(); return; }
    if (!["about:newtab", "about:home"].includes(browser.currentURI?.spec)) return;
    lazy.NullpathRouterWidget.openPanel(browser.ownerGlobal);
  }
}
