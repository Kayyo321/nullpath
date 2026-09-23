/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// The channel filter never returns a direct connection in an I2P profile,
// even when an earlier filter (like an extension's proxy.onRequest) asks for one.

const { NullpathChannelFilter } = importNullpath("network/NullpathChannelFilter.sys.mjs");
const { NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");

const pps = Cc["@mozilla.org/network/protocol-proxy-service;1"].getService(
  Ci.nsIProtocolProxyService
);

function resolve(url) {
  let channel = NetUtil.newChannel({ uri: url, loadUsingSystemPrincipal: true });
  return new Promise(res => {
    pps.asyncResolve(channel, 0, {
      onProxyAvailable(_req, _chan, pi) {
        res(pi);
      },
    });
  });
}

add_task(async function test_never_direct() {
  Services.prefs.setStringPref("nullpath.mode", "i2p-sites");
  let directFilter = {
    QueryInterface: ChromeUtils.generateQI(["nsIProtocolProxyChannelFilter"]),
    applyFilter(_channel, _proxy, cb) {
      cb.onProxyFilterResult(null);
    },
  };
  pps.registerChannelFilter(directFilter, 0);
  NullpathChannelFilter.init();

  for (let url of ["http://example.com/", "https://example.i2p/", "http://127.0.0.1:8080/"]) {
    let pi = await resolve(url);
    Assert.ok(pi, `${url} gets a proxy`);
    Assert.equal(pi.type, "http");
    Assert.equal(pi.host, "127.0.0.1");
    Assert.equal(pi.failoverProxy, null, "no failover");
  }
  NullpathChannelFilter.uninit();
  pps.unregisterChannelFilter(directFilter);
});
