/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// §4: the first click shows the chooser, "Not now" leaves the state off,
// and "Use my own I2P router" → "Save and connect" turns the switch on.

const { NullpathRouter } = ChromeUtils.importESModule(
  "moz-src:///browser/components/nullpath/router/NullpathRouter.sys.mjs"
);
const { NullpathRouterConfig } = ChromeUtils.importESModule(
  "moz-src:///browser/components/nullpath/router/NullpathRouterConfig.sys.mjs"
);

async function openPanel() {
  let button = document.getElementById("nullpath-router-button");
  let shown = BrowserTestUtils.waitForEvent(document, "ViewShown");
  button.click();
  await shown;
  return document.getElementById("nullpath-router-panel");
}

add_setup(async function () {
  await NullpathRouterConfig.update(c => {
    c.setup = null;
    c.external = null;
    c.managed = null;
  });
  registerCleanupFunction(() => NullpathRouter.setEnabled(false).catch(() => {}));
});

add_task(async function test_chooser_not_now() {
  let view = await openPanel();
  let choice = await TestUtils.waitForCondition(() => view.querySelector("#nullpath-choice-own"));
  Assert.ok(choice, "chooser is shown");
  Assert.ok(view.querySelector("#nullpath-choice-managed"));
  let hidden = BrowserTestUtils.waitForEvent(view.closest("panel"), "popuphidden");
  view.querySelector("#nullpath-chooser-not-now").click();
  await hidden;
  Assert.equal(NullpathRouter.state, "off");
  Assert.equal(NullpathRouter.setup, null);
});

add_task(async function test_own_router_save_and_connect() {
  let view = await openPanel();
  let own = await TestUtils.waitForCondition(() => view.querySelector("#nullpath-choice-own"));
  let ownShown = BrowserTestUtils.waitForEvent(document, "ViewShown");
  own.click();
  await ownShown;
  let form = document.getElementById("nullpath-router-own");
  let input = form.querySelector("#nullpath-own-sitesProxy");
  input.value = "127.0.0.1:4444";
  input.dispatchEvent(new Event("input"));
  form.querySelector("#nullpath-own-save-connect").click();
  await TestUtils.waitForCondition(() => NullpathRouter.setup == "external");
  Assert.equal(NullpathRouter.desired, "on", "the switch is on");
  Assert.equal(NullpathRouter.config.external.sitesProxy, "127.0.0.1:4444");
  view.closest("panel").hidePopup();
});

add_task(async function test_rejects_hostnames() {
  let view = await openPanel();
  await TestUtils.waitForCondition(() => view.querySelector("#nullpath-router-switch"));
  let settingsShown = BrowserTestUtils.waitForEvent(document, "ViewShown");
  view.querySelector("#nullpath-router-settings-button").click();
  await settingsShown;
  let editShown = BrowserTestUtils.waitForEvent(document, "ViewShown");
  document.getElementById("nullpath-settings-external-edit").click();
  await editShown;
  let form = document.getElementById("nullpath-router-own");
  let input = form.querySelector("#nullpath-own-sitesProxy");
  input.value = "localhost:4444";
  input.dispatchEvent(new Event("input"));
  form.querySelector("#nullpath-own-save").click();
  let error = form.querySelector('[data-for="sitesProxy"]');
  await TestUtils.waitForCondition(() => error.getAttribute("data-l10n-id"));
  Assert.equal(error.getAttribute("data-l10n-id"), "nullpath-router-error-endpoint-format");
  view.closest("panel").hidePopup();
});
