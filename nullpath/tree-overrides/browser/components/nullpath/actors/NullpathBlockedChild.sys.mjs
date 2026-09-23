/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Relays about:nullpath-blocked's button clicks to the parent, and the
 * parent's readiness updates back to the page. Only the page's fixed set of
 * actions passes; the parent re-reads the blocked URL from the page's own
 * location, never from the message.
 */

const ACTIONS = new Set([
  "open-panel",
  "connect",
  "retry",
  "go-back",
  "switch-window",
  "outproxy-settings",
  "get-state",
]);

export class NullpathBlockedChild extends JSWindowActorChild {
  handleEvent(event) {
    if (event.type != "NullpathBlocked:Action") {
      return;
    }
    let action = String(event.detail?.action ?? "");
    if (ACTIONS.has(action)) {
      this.sendAsyncMessage("NullpathBlocked:Action", { action });
    }
  }

  receiveMessage(message) {
    if (message.name != "NullpathBlocked:State") {
      return;
    }
    let win = this.contentWindow;
    let detailData = {
      connected: !!message.data.connected,
      connecting: !!message.data.connecting,
      publicWeb: String(message.data.publicWeb ?? ""),
      dark: !!message.data.dark,
    };
    let detail = Cu.cloneInto(
      detailData,
      win
    );
    win.dispatchEvent(new win.CustomEvent("NullpathBlocked:State", { detail }));
  }
}
