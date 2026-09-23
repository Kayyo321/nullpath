/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// §2.1: the button is present, can't be removed, doesn't overflow, and goes
// back to the end of the nav bar.

const WIDGET_ID = "nullpath-router-button";

add_task(async function test_widget_placement() {
  let placement = CustomizableUI.getPlacementOfWidget(WIDGET_ID);
  Assert.equal(placement?.area, CustomizableUI.AREA_NAVBAR, "in the nav bar");
  let ids = CustomizableUI.getWidgetIdsInArea(CustomizableUI.AREA_NAVBAR);
  Assert.equal(ids.at(-1), WIDGET_ID, "last customizable item, left of ☰");
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
