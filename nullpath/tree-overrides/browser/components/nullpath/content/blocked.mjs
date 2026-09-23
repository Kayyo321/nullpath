/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// about:nullpath-blocked. Unprivileged: it can only ask the NullpathBlocked
// actor to run one of this page's actions. There is never an "open directly"
// or "open in Direct web" action (§7.4).

const params = new URLSearchParams(document.location.search);
const kind = params.get("kind") ?? "not-connected";
let reason = params.get("reason") ?? "";
const blockedURL = params.get("u") ?? "";

let retried = false;

function send(action) {
  document.dispatchEvent(
    new CustomEvent("NullpathBlocked:Action", { bubbles: true, detail: { action } })
  );
}

/** Buttons for each page kind and readiness reason. */
function actionsFor(kind, reason) {
  switch (kind) {
    case "not-connected":
      return [["connect", "nullpath-blocked-connect", true], ["open-panel", "nullpath-blocked-open-panel"]];
    case "cant-open":
      return {
        "not-connected": [["connect", "nullpath-blocked-connect", true]],
        connecting: [],
        "no-outproxy": [["outproxy-settings", "nullpath-blocked-setup-outproxy", true]],
        "outproxy-unreachable": [
          ["retry", "nullpath-blocked-try-again", true],
          ["outproxy-settings", "nullpath-blocked-change-outproxy"],
        ],
      }[reason] ?? [["open-panel", "nullpath-blocked-open-panel"]];
    case "outproxy-unavailable":
      return reason == "no-outproxy"
        ? [["outproxy-settings", "nullpath-blocked-setup-outproxy", true]]
        : [
            ["retry", "nullpath-blocked-try-again", true],
            ["outproxy-settings", "nullpath-blocked-change-outproxy"],
          ];
    case "handed-off":
      return [["go-back", "nullpath-blocked-go-back"], ["switch-window", "nullpath-blocked-switch-window", true]];
    case "form-blocked":
    case "local-blocked":
    default:
      return [["go-back", "nullpath-blocked-go-back", true]];
  }
}

function render() {
  document.l10n.setAttributes(document.getElementById("blocked-title"), `nullpath-blocked-${kind}-title`);
  document.l10n.setAttributes(document.getElementById("blocked-description"), `nullpath-blocked-${kind}-desc`);
  let reasonEl = document.getElementById("blocked-reason");
  if (reason && (kind == "cant-open" || kind == "outproxy-unavailable")) {
    document.l10n.setAttributes(reasonEl, `nullpath-blocked-reason-${reason}`);
    reasonEl.hidden = false;
  } else {
    reasonEl.hidden = true;
  }
  if (blockedURL) {
    document.getElementById("blocked-url").textContent = blockedURL;
    document.getElementById("blocked-url-line").hidden = false;
  }
  let container = document.getElementById("blocked-buttons");
  container.replaceChildren();
  for (let [action, l10nId, primary] of actionsFor(kind, reason)) {
    let button = document.createElement("button");
    if (primary) {
      button.className = "primary";
    }
    document.l10n.setAttributes(button, l10nId);
    button.addEventListener("click", () => send(action));
    container.append(button);
  }
  container.querySelector(".primary")?.focus();
}

/** Continues automatically once the path is ready (§7.4). */
function onState({ detail }) {
  let status = document.getElementById("blocked-status");
  if (detail.connecting) {
    document.l10n.setAttributes(status, "nullpath-blocked-status-connecting");
  } else {
    status.removeAttribute("data-l10n-id");
    status.textContent = "";
  }
  let ready = false;
  if (kind == "not-connected") {
    ready = detail.connected;
  } else if (kind == "cant-open" || kind == "outproxy-unavailable") {
    ready = detail.publicWeb == "ready";
    if (!ready && detail.publicWeb && detail.publicWeb != reason && reason != "no-profile") {
      reason = detail.publicWeb;
      render();
    }
  }
  if (ready && !retried && blockedURL) {
    retried = true;
    send("retry");
  }
}

window.addEventListener("NullpathBlocked:State", onState);
render();
send("get-state");
