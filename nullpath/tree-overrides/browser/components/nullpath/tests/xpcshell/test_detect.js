/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { identifyProxy, probePort, checkOutproxy } = importNullpath(
  "router/NullpathLoopback.sys.mjs"
);
const { testProxy } = importNullpath("router/NullpathRouterDetect.sys.mjs");

const I2P_ERROR =
  "HTTP/1.1 404 Not Found\r\nContent-Type: text/html\r\n\r\n" +
  "<html><head><title>I2Pd HTTP proxy</title></head><body>Host not found</body></html>";
const OTHER_ERROR = "HTTP/1.1 502 Bad Gateway\r\nServer: nginx\r\n\r\n<html>Bad gateway</html>";

add_task(async function test_nothing_listening() {
  let port = closedPort();
  Assert.ok(!(await probePort("127.0.0.1", port)));
  Assert.equal(await identifyProxy({ host: "127.0.0.1", port }), "none");
  Assert.equal(await testProxy({ host: "127.0.0.1", port }), "nullpath-router-test-none");
});

add_task(async function test_i2p_proxy() {
  let s = startFakeServer(I2P_ERROR);
  Assert.ok(await probePort("127.0.0.1", s.port));
  Assert.equal(await identifyProxy({ host: "127.0.0.1", port: s.port }), "i2p");
  Assert.ok(s.received.join("").startsWith("GET http://nullpath-probe.invalid.i2p/"));
  s.stop();
});

add_task(async function test_non_i2p_listener() {
  let s = startFakeServer(OTHER_ERROR);
  Assert.equal(await identifyProxy({ host: "127.0.0.1", port: s.port }), "other");
  Assert.equal(await testProxy({ host: "127.0.0.1", port: s.port }), "nullpath-router-test-other");
  s.stop();
});

add_task(async function test_outproxy_connect() {
  let target = { host: "github.com", port: 443 };
  let ok = startFakeServer("HTTP/1.1 200 Connection established\r\n\r\n");
  Assert.ok((await checkOutproxy({ host: "127.0.0.1", port: ok.port }, target)).ok);
  Assert.ok(ok.received.join("").startsWith("CONNECT github.com:443"));
  ok.stop();

  let bad = startFakeServer("HTTP/1.1 503 Service Unavailable\r\n\r\n");
  let r = await checkOutproxy({ host: "127.0.0.1", port: bad.port }, target);
  Assert.ok(!r.ok);
  Assert.equal(r.status, 503);
  bad.stop();
});
