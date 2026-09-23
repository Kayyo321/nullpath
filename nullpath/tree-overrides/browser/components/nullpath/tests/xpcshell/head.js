/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use strict";

const BASE = "moz-src:///browser/components/nullpath/";

function importNullpath(path) {
  return ChromeUtils.importESModule(BASE + path);
}

do_get_profile();

/**
 * A fake local proxy: answers every connection with `response` (a raw HTTP
 * string, or null to close without answering) and records what it received.
 */
function startFakeServer(response) {
  let server = Cc["@mozilla.org/network/server-socket;1"].createInstance(
    Ci.nsIServerSocket
  );
  server.init(-1, true, -1);
  let received = [];
  server.asyncListen({
    onSocketAccepted(_serv, transport) {
      let input = transport.openInputStream(0, 0, 0);
      let output = transport.openOutputStream(0, 0, 0);
      let bin = Cc["@mozilla.org/binaryinputstream;1"].createInstance(
        Ci.nsIBinaryInputStream
      );
      bin.setInputStream(input);
      input.QueryInterface(Ci.nsIAsyncInputStream).asyncWait(
        {
          onInputStreamReady() {
            try {
              received.push(bin.readBytes(input.available()));
            } catch (e) {}
            if (response != null) {
              output.write(response, response.length);
            }
            output.close();
            input.close();
          },
        },
        0,
        0,
        Services.tm.currentThread
      );
    },
    onStopListening() {},
  });
  return { port: server.port, received, stop: () => server.close() };
}

/** A port with nothing listening on it. */
function closedPort() {
  let s = startFakeServer(null);
  let port = s.port;
  s.stop();
  return port;
}
