/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { buildI2pdConf, buildTunnelsConf, setConfKey } = importNullpath(
  "router/NullpathManagedRouter.sys.mjs"
);
const { parseI2pdConf, parseI2PTunnelConfig } = importNullpath(
  "router/NullpathRouterDetect.sys.mjs"
);

const ports = { sites: 14444, publicWeb: 14450, console: 17070, control: 17650, router: 27311 };

add_task(function test_conf_defaults() {
  let conf = buildI2pdConf({ dir: "C:\\r", ports, consolePassword: "a", controlPassword: "b" });
  Assert.ok(conf.includes("notransit = true"), "relaying is off by default");
  Assert.ok(/\[upnp\]\nenabled = false/.test(conf), "UPnP is off by default");
  Assert.ok(/\[socksproxy\]\nenabled = false/.test(conf));
  Assert.ok(/\[httpproxy\][\s\S]*?address = 127\.0\.0\.1\nport = 14444\noutproxy =\n/.test(conf));
  Assert.ok(!/0\.0\.0\.0/.test(conf), "nothing binds beyond loopback");
  // The detection parser reads what setup writes.
  Assert.equal(parseI2pdConf(conf).port, 14444);
});

add_task(function test_tunnels() {
  Assert.ok(!buildTunnelsConf({ ports, outproxy: null }).includes("[nullpath-publicweb]"));
  let t = buildTunnelsConf({ ports, outproxy: "exit.example.i2p" });
  Assert.ok(t.includes("outproxy = exit.example.i2p"));
  Assert.ok(t.includes("port = 14450"));
});

add_task(function test_targeted_edits_keep_user_lines() {
  let text =
    "# mine\nbandwidth = L\nnotransit = true   # relay\n\n[upnp]\nenabled = false\n\n[custom]\nfoo = bar\n";
  let edited = setConfKey(text, "", "notransit", "false");
  Assert.ok(edited.includes("notransit = false   # relay"));
  edited = setConfKey(edited, "upnp", "enabled", "true");
  Assert.ok(/\[upnp\]\nenabled = true/.test(edited));
  Assert.ok(edited.includes("[custom]\nfoo = bar"), "user sections survive");
  edited = setConfKey(edited, "", "floodfill", "false");
  Assert.ok(edited.indexOf("floodfill = false") < edited.indexOf("[upnp]"));
});

add_task(function test_java_tunnel_config() {
  let ep = parseI2PTunnelConfig(
    "tunnel.0.type=httpclient\ntunnel.0.listenPort=4445\ntunnel.0.interface=127.0.0.1\n"
  );
  Assert.deepEqual(ep, { host: "127.0.0.1", port: 4445 });
  Assert.equal(parseI2PTunnelConfig("tunnel.0.type=server\ntunnel.0.listenPort=1\n"), null);
});
