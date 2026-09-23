/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const {
  parseEndpoint,
  parseLocalURL,
  parseOutproxyDestination,
  isLoopbackHost,
  isPrivateHost,
  formatEndpoint,
  NullpathRouterConfig,
} = importNullpath("router/NullpathRouterConfig.sys.mjs");

add_task(function test_endpoints() {
  Assert.deepEqual(parseEndpoint("127.0.0.1:4444"), { host: "127.0.0.1", port: 4444 });
  Assert.deepEqual(parseEndpoint("[::1]:4444"), { host: "::1", port: 4444 });
  for (let bad of ["localhost:4444", "127.0.0.1", "127.0.0.1:0", "127.0.0.1:70000", "example.com:80", ""]) {
    Assert.throws(() => parseEndpoint(bad), /nullpath-router-error/, bad);
  }
  Assert.throws(() => parseEndpoint("192.168.1.5:4444"), /not-loopback/);
  Assert.deepEqual(parseEndpoint("192.168.1.5:4444", { allowLan: true }), {
    host: "192.168.1.5",
    port: 4444,
  });
  Assert.throws(() => parseEndpoint("8.8.8.8:4444", { allowLan: true }), /not-lan/);
  Assert.equal(formatEndpoint({ host: "::1", port: 1 }), "[::1]:1");
});

add_task(function test_hosts() {
  Assert.ok(isLoopbackHost("127.0.0.5"));
  Assert.ok(isLoopbackHost("[::1]"));
  Assert.ok(!isLoopbackHost("10.0.0.1"));
  Assert.ok(isPrivateHost("10.0.0.1"));
  Assert.ok(isPrivateHost("172.20.1.1"));
  Assert.ok(!isPrivateHost("172.32.1.1"));
  Assert.ok(isPrivateHost("fd00::1"));
  Assert.ok(!isPrivateHost("93.184.216.34"));
});

add_task(function test_urls() {
  Assert.equal(parseLocalURL("http://127.0.0.1:7657/").port, "7657");
  Assert.throws(() => parseLocalURL("https://127.0.0.1:7657/"), /url-format/);
  Assert.throws(() => parseLocalURL("http://user:pw@127.0.0.1:7657/"), /url-format/);
  Assert.throws(() => parseLocalURL("http://localhost:7657/"), /url-format/);
});

add_task(function test_outproxy_destinations() {
  // What people paste from outproxy lists is accepted and stored bare.
  for (let [input, expected] of [
    ["exit.stormycloud.i2p", "exit.stormycloud.i2p"],
    ["  http://exit.stormycloud.i2p  ", "exit.stormycloud.i2p"],
    ["http://exit.stormycloud.i2p/", "exit.stormycloud.i2p"],
    ["HTTP://Exit.StormyCloud.I2P", "exit.stormycloud.i2p"],
    ["exit.example.i2p:4444", "exit.example.i2p:4444"],
    ["http://exit.example.i2p:80/", "exit.example.i2p"],
    ["abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrst.b32.i2p", "abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrst.b32.i2p"],
    ["", ""],
  ]) {
    Assert.equal(parseOutproxyDestination(input), expected, input);
  }
  for (let bad of [
    "exit.example.com",
    "https://exit.stormycloud.i2p",
    "socks://exit.example.i2p",
    "http://user:pw@exit.example.i2p",
    "http://exit.example.i2p/path",
    "http://exit.example.i2p/?q=1",
    "i2p",
    ".i2p",
    "exit..example.i2p",
    "-exit.example.i2p",
    "exit example.i2p",
  ]) {
    Assert.throws(() => parseOutproxyDestination(bad), /nullpath-outproxy-error-destination/, bad);
  }
});

add_task(async function test_roundtrip_and_atomic_write() {
  await NullpathRouterConfig.update(c => {
    c.setup = "external";
    c.external = {
      kind: "java-i2p",
      sitesProxy: "127.0.0.1:4444",
      publicWebProxy: null,
      consoleURL: null,
      control: null,
      allowLan: false,
    };
  });
  let loaded = await NullpathRouterConfig.load();
  Assert.equal(loaded.setup, "external");
  Assert.equal(loaded.external.sitesProxy, "127.0.0.1:4444");
  Assert.ok(!(await IOUtils.exists(NullpathRouterConfig.configPath + ".tmp")));

  // Switching setup never erases the other block.
  await NullpathRouterConfig.update(c => {
    c.managed = { dir: "x", ports: { sites: 14444 } };
    c.setup = "managed";
  });
  let both = await NullpathRouterConfig.load();
  Assert.ok(both.external && both.managed);

  // A hand-edited invalid endpoint is ignored, not trusted.
  await IOUtils.writeJSON(NullpathRouterConfig.configPath, {
    version: 1,
    setup: "external",
    external: { sitesProxy: "8.8.8.8:4444" },
  });
  let sanitized = await NullpathRouterConfig.load();
  Assert.equal(sanitized.external, null);
  Assert.equal(sanitized.setup, null);
});

add_task(async function test_state_registry_prunes_dead_pids() {
  await IOUtils.makeDirectory(NullpathRouterConfig.dir, { ignoreExisting: true });
  await IOUtils.writeJSON(NullpathRouterConfig.statePath, {
    desired: "on",
    changedAt: 1,
    processes: [{ pid: 999999, startTime: 1 }],
  });
  let state = await NullpathRouterConfig.registerProcess();
  // The only other process is dead, so desired resets to off (§6.1).
  Assert.equal(state.desired, "off");
  Assert.deepEqual(
    state.processes.map(p => p.pid),
    [Services.appinfo.processID]
  );
  Assert.ok(await NullpathRouterConfig.unregisterProcess());
});
