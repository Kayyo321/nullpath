/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// The §8.4 decision table, including the §7.4 hand-off.
const { decide, Kinds } = importNullpath("network/NullpathRequestBlocker.sys.mjs");

function req(overrides) {
  return {
    mode: "i2p-sites",
    connected: true,
    scheme: "http",
    host: "example.i2p",
    topLevel: true,
    method: "GET",
    isConsole: false,
    userStarted: false,
    publicWeb: "no-outproxy",
    ...overrides,
  };
}

add_task(function test_not_connected_blocks_everything() {
  for (let mode of ["i2p-sites", "i2p-publicweb"]) {
    let d = decide(req({ mode, connected: false }));
    Assert.ok(!d.allow);
    Assert.equal(d.kind, Kinds.NOT_CONNECTED);
    Assert.ok(!decide(req({ mode, connected: false, topLevel: false })).allow);
  }
});

add_task(function test_i2p_sites() {
  Assert.ok(decide(req({})).allow);
  Assert.ok(decide(req({ scheme: "wss", topLevel: false })).allow);
  // Public web, top-level GET: hand off when ready, otherwise explain.
  Assert.ok(decide(req({ host: "example.com", publicWeb: "ready" })).handoff);
  for (let reason of ["not-connected", "connecting", "no-outproxy", "outproxy-unreachable"]) {
    let d = decide(req({ host: "example.com", publicWeb: reason }));
    Assert.equal(d.kind, Kinds.CANT_OPEN);
    Assert.equal(d.reason, reason);
    Assert.ok(!d.handoff);
  }
  // POST and subresources never move to another profile.
  Assert.equal(
    decide(req({ host: "example.com", method: "POST", publicWeb: "ready" })).kind,
    Kinds.FORM_BLOCKED
  );
  let sub = decide(req({ host: "example.com", topLevel: false, publicWeb: "ready" }));
  Assert.ok(!sub.allow && !sub.handoff && !sub.kind);
});

add_task(function test_public_web() {
  let mode = "i2p-publicweb";
  Assert.ok(decide(req({ mode, host: "example.com", publicWeb: "ready" })).allow);
  Assert.ok(decide(req({ mode, host: "example.i2p", publicWeb: "no-outproxy" })).allow);
  let d = decide(req({ mode, host: "example.com", publicWeb: "outproxy-unreachable" }));
  Assert.equal(d.kind, Kinds.OUTPROXY);
});

add_task(function test_local_addresses() {
  for (let host of ["127.0.0.1", "localhost", "foo.localhost", "192.168.0.1", "::1", "10.1.2.3"]) {
    Assert.equal(decide(req({ host })).kind, Kinds.LOCAL, host);
  }
  // The configured console opens when the user starts it, and can then use
  // itself: links, forms, refreshes and subresources.
  let console = { host: "127.0.0.1", isConsole: true };
  Assert.ok(decide(req({ ...console, userStarted: true })).allow);
  Assert.ok(decide(req({ ...console, fromConsole: true })).allow, "console link or refresh");
  Assert.ok(decide(req({ ...console, fromConsole: true, method: "POST" })).allow, "console form");
  Assert.ok(decide(req({ ...console, fromConsole: true, topLevel: false })).allow, "console subresource");
  // Nothing else reaches it: not an I2P page, and not a frame on one.
  Assert.ok(!decide(req({ ...console, userStarted: false })).allow);
  Assert.ok(!decide(req({ ...console, userStarted: true, topLevel: false })).allow);
  Assert.ok(!decide(req({ ...console, topLevel: false })).allow);
  // A console page can't reach other local addresses.
  Assert.equal(decide(req({ host: "127.0.0.1", fromConsole: true })).kind, Kinds.LOCAL);
});

add_task(function test_schemes() {
  Assert.ok(decide(req({ scheme: "about", host: "" })).allow);
  Assert.ok(!decide(req({ scheme: "ftp" })).allow);
});
