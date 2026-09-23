/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// The router has its own island immediately before Downloads and theme.

const WIDGET_ID = "nullpath-router-button";

add_task(async function test_widget_placement() {
  let placement = CustomizableUI.getPlacementOfWidget(WIDGET_ID);
  Assert.equal(placement?.area, CustomizableUI.AREA_NAVBAR, "in the nav bar");
  let ids = CustomizableUI.getWidgetIdsInArea(CustomizableUI.AREA_NAVBAR);
  Assert.equal(ids.indexOf(WIDGET_ID) + 1, ids.indexOf("downloads-button"), "router before Downloads");
  Assert.equal(ids.indexOf("downloads-button") + 1, ids.indexOf("nullpath-theme-button"), "theme after Downloads");
  Assert.ok(!CustomizableUI.isWidgetRemovable(WIDGET_ID), "can't be removed");
  let node = document.getElementById(WIDGET_ID);
  Assert.equal(node.getAttribute("overflows"), "false", "never overflows");
});

add_task(async function test_narrow_window() {
  let win = await BrowserTestUtils.openNewBrowserWindow();
  win.resizeTo(500, 600);
  await TestUtils.waitForCondition(() => win.outerWidth <= 520);
  let node = win.document.getElementById(WIDGET_ID);
  Assert.ok(!node.hasAttribute("overflowedItem"), "still visible at 500 px");
  Assert.ok(BrowserTestUtils.isVisible(node));
  await BrowserTestUtils.closeWindow(win);
});

add_task(async function test_state_classes() {
  let node = document.getElementById(WIDGET_ID);
  Assert.ok(node.classList.contains("nullpath-state-off"), "starts Not connected");
  await document.l10n.translateElements([node]);
  Assert.ok(node.getAttribute("tooltiptext").includes("Not connected"));
});
