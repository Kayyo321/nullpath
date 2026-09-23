/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function disconnected_home_replaces_search() {
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, "about:newtab");
  try {
    await SpecialPowers.spawn(tab.linkedBrowser, [], async () => {
      await ContentTaskUtils.waitForCondition(
        () => content.document.getElementById("nullpath-connection-screen"),
        "local connection screen appears"
      );
      let doc = content.document;
      Assert.ok(doc.documentElement.hasAttribute("nullpath-disconnected"));
      Assert.ok(doc.getElementById("nullpath-connection-button"));
      let root = doc.getElementById("root");
      if (root) Assert.equal(content.getComputedStyle(root).display, "none", "search UI is hidden");
    });
    Assert.ok(!gNotificationBox.getNotificationWithValue("nullpath-not-connected"), "old banner is absent");
  } finally {
    BrowserTestUtils.removeTab(tab);
  }
});

add_task(async function theme_button_reports_current_mode() {
  let button = document.getElementById("nullpath-theme-button");
  Assert.ok(button, "theme button exists");
  let prior = Services.prefs.getStringPref("nullpath.appearance", "system");
  try {
    button.doCommand();
    await TestUtils.waitForCondition(() => document.documentElement.hasAttribute("nullpath-theme"));
    let mode = document.documentElement.getAttribute("nullpath-theme");
    Assert.equal(button.getAttribute("tooltiptext"), mode == "dark" ? "Dark mode" : "Light mode");
    button.doCommand();
    Assert.notEqual(document.documentElement.getAttribute("nullpath-theme"), mode, "mode changes on click");
  } finally {
    if (prior == "system") Services.prefs.clearUserPref("nullpath.appearance");
    else Services.prefs.setStringPref("nullpath.appearance", prior);
  }
});

add_task(async function sidebar_has_single_compact_surface() {
  let container = document.getElementById("sidebar-container");
  let custom = document.getElementById("nullpath-profiles-sidebar");
  Assert.ok(custom, "profile sidebar exists");
  Assert.equal(custom.parentElement, container, "profile sidebar is outside the native sidebar main");
  Assert.equal(getComputedStyle(container.querySelector("sidebar-main")).display, "none");
  Assert.equal(Math.round(container.getBoundingClientRect().width), 46, "compact sidebar is 46 px");
});
