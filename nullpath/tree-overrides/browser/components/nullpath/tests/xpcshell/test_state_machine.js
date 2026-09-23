/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// The state machine with a fake proxy (§6): off at launch, connecting ->
// connected, lost proxy -> Needs attention, and the reason codes.

const { NullpathRouter, RouterStates, Reasons } = importNullpath("router/NullpathRouter.sys.mjs");
const { NullpathRouterConfig } = importNullpath("router/NullpathRouterConfig.sys.mjs");
const { TestUtils } = ChromeUtils.importESModule("resource://testing-common/TestUtils.sys.mjs");

const I2P_ERROR = "HTTP/1.1 404 Not Found\r\n\r\n<html><title>I2Pd HTTP proxy</title></html>";

async function useExternal(port) {
  await NullpathRouterConfig.update(c => {
    c.setup = "external";
    c.external = {
      kind: "i2pd",
      sitesProxy: `127.0.0.1:${port}`,
      publicWebProxy: null,
      consoleURL: null,
      control: null,
      allowLan: false,
    };
    c.advanced = { ...c.advanced, checkIntervalSec: 5 };
  });
}

add_setup(async function () {
  await IOUtils.makeDirectory(NullpathRouterConfig.dir, { ignoreExisting: true });
  // A stale "on" from a previous session.
  await IOUtils.writeJSON(NullpathRouterConfig.statePath, {
    desired: "on",
    changedAt: 1,
    processes: [],
  });
});

add_task(async function test_starts_off() {
  await NullpathRouter.init();
  Assert.equal(NullpathRouter.state, RouterStates.OFF, "always off at launch");
  Assert.equal(NullpathRouter.desired, "off", "desired resets when no other process runs");
});

add_task(async function test_connect_and_lose_proxy() {
  let server = startFakeServer(I2P_ERROR);
  await useExternal(server.port);
  await NullpathRouter.setEnabled(true);
  await TestUtils.waitForCondition(() => NullpathRouter.state == RouterStates.CONNECTED, "connects");
  Assert.equal((await NullpathRouterConfig.readState()).desired, "on");

  server.stop();
  await NullpathRouter.checkNow();
  await TestUtils.waitForCondition(
    () => NullpathRouter.state == RouterStates.ATTENTION,
    "needs attention after two failed checks",
    500,
    40
  );
  Assert.equal(NullpathRouter.reason, Reasons.PROXY_UNREACHABLE);

  await NullpathRouter.setEnabled(false);
  Assert.equal(NullpathRouter.state, RouterStates.OFF);
});

add_task(async function test_not_i2p() {
  let server = startFakeServer("HTTP/1.1 502 Bad Gateway\r\nServer: nginx\r\n\r\n");
  await useExternal(server.port);
  await NullpathRouter.setEnabled(true);
  await TestUtils.waitForCondition(() => NullpathRouter.state == RouterStates.ATTENTION);
  Assert.equal(NullpathRouter.reason, Reasons.PROXY_NOT_I2P);
  await NullpathRouter.setEnabled(false);
  server.stop();
});

add_task(async function test_managed_exe_missing() {
  // Installed, then antivirus software quarantined i2pd.exe.
  let dir = PathUtils.join(PathUtils.profileDir, "managed-missing");
  await IOUtils.makeDirectory(PathUtils.join(dir, "bin"), { createAncestors: true });
  await NullpathRouterConfig.update(c => {
    c.setup = "managed";
    c.managed = {
      dir,
      i2pdVersion: "0",
      ports: { sites: closedPort(), publicWeb: closedPort(), console: closedPort(), control: closedPort(), router: 1 },
      firstStartDone: true,
    };
  });
  await NullpathRouter.setEnabled(true);
  await TestUtils.waitForCondition(() => NullpathRouter.state == RouterStates.ATTENTION);
  Assert.equal(NullpathRouter.reason, Reasons.ROUTER_MISSING);
  await NullpathRouter.setEnabled(false);
  await NullpathRouterConfig.update(c => {
    c.setup = null;
    c.managed = null;
  });
});

add_task(async function test_public_web_readiness() {
  Assert.equal(NullpathRouter.publicWebReadiness(), "not-connected");
});
