/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Raw TCP/HTTP helpers for talking to a local router: port checks, proxy
 * identification, the i2pd web console and JSON-RPC (I2PControl).
 *
 * Everything here uses nsISocketTransport directly with IP literals, so none
 * of it goes through necko channels, the proxy settings, the channel filter
 * or DNS. That keeps router checks from ever becoming browser traffic, and
 * keeps them working while I2P profiles block every channel (§8).
 */

import { setTimeout, clearTimeout } from "resource://gre/modules/Timer.sys.mjs";

const lazy = {};
ChromeUtils.defineLazyGetter(lazy, "sts", () =>
  Cc["@mozilla.org/network/socket-transport-service;1"].getService(
    Ci.nsISocketTransportService
  )
);

const MAX_RESPONSE = 256 * 1024;

function waitReadable(stream) {
  return new Promise(resolve =>
    stream.asyncWait({ onInputStreamReady: resolve }, 0, 0, Services.tm.currentThread)
  );
}

function waitWritable(stream) {
  return new Promise(resolve =>
    stream.asyncWait({ onOutputStreamReady: resolve }, 0, 0, Services.tm.currentThread)
  );
}

/**
 * Opens a TCP connection, sends `request` (a binary string) and reads until
 * the peer closes, `maxBytes` is reached or `timeoutMs` passes.
 *
 * @returns {Promise<string|null>} the response as a binary string, or null
 *   when nothing could connect.
 */
export async function exchange(host, port, request, { timeoutMs = 3000, maxBytes = MAX_RESPONSE, stopWhen } = {}) {
  let transport = lazy.sts.createTransport([], host, port, null, null);
  transport.setTimeout(Ci.nsISocketTransport.TIMEOUT_CONNECT, Math.ceil(timeoutMs / 1000));
  transport.setTimeout(Ci.nsISocketTransport.TIMEOUT_READ_WRITE, Math.ceil(timeoutMs / 1000));
  let timedOut = false;
  let timer = setTimeout(() => {
    timedOut = true;
    transport.close(Cr.NS_ERROR_NET_TIMEOUT);
  }, timeoutMs);
  let output = transport
    .openOutputStream(0, 0, 0)
    .QueryInterface(Ci.nsIAsyncOutputStream);
  let input = transport
    .openInputStream(0, 0, 0)
    .QueryInterface(Ci.nsIAsyncInputStream);
  let binary = Cc["@mozilla.org/binaryinputstream;1"].createInstance(
    Ci.nsIBinaryInputStream
  );
  binary.setInputStream(input);
  let connected = false;
  let data = "";
  try {
    let pending = request;
    while (pending.length) {
      await waitWritable(output);
      let n = output.write(pending, pending.length);
      connected = true;
      pending = pending.slice(n);
    }
    while (data.length < maxBytes) {
      await waitReadable(input);
      let avail;
      try {
        avail = input.available();
      } catch (e) {
        break; // closed by peer, or timed out
      }
      if (!avail) {
        break;
      }
      data += binary.readBytes(Math.min(avail, maxBytes - data.length));
      if (stopWhen?.(data)) {
        break;
      }
    }
  } catch (e) {
    if (!connected) {
      return null;
    }
  } finally {
    clearTimeout(timer);
    try {
      transport.close(Cr.NS_OK);
    } catch (e) {}
  }
  if (timedOut && !connected) {
    return null;
  }
  return data;
}

/** True when a TCP connection to host:port succeeds within timeoutMs. */
export async function probePort(host, port, timeoutMs = 1000) {
  let transport = lazy.sts.createTransport([], host, port, null, null);
  transport.setTimeout(Ci.nsISocketTransport.TIMEOUT_CONNECT, Math.ceil(timeoutMs / 1000));
  let timer;
  let result = await new Promise(resolve => {
    timer = setTimeout(() => resolve(false), timeoutMs);
    // Only the connected status is proof. A buffered output stream is
    // writable before the socket connects, so waiting on it proves nothing.
    transport.setEventSink(
      {
        onTransportStatus(_transport, status) {
          if (status == Ci.nsISocketTransport.STATUS_CONNECTED_TO) {
            resolve(true);
          }
        },
      },
      Services.tm.currentThread
    );
    // Opening the stream starts the connection. Unbuffered, it only becomes
    // ready once connected, or when connecting fails.
    let output = transport
      .openOutputStream(Ci.nsITransport.OPEN_UNBUFFERED, 0, 0)
      .QueryInterface(Ci.nsIAsyncOutputStream);
    output.asyncWait(
      {
        onOutputStreamReady() {
          try {
            resolve(transport.isAlive());
          } catch (e) {
            resolve(false);
          }
        },
      },
      0,
      0,
      Services.tm.currentThread
    );
  });
  clearTimeout(timer);
  try {
    transport.close(Cr.NS_OK);
  } catch (e) {}
  return result;
}

/** Parses a raw HTTP/1.x response. */
export function parseResponse(raw) {
  if (raw == null) {
    return null;
  }
  let split = raw.indexOf("\r\n\r\n");
  let head = split == -1 ? raw : raw.slice(0, split);
  let body = split == -1 ? "" : raw.slice(split + 4);
  let [statusLine, ...lines] = head.split("\r\n");
  let m = /^HTTP\/1\.[01] (\d{3})/.exec(statusLine);
  if (!m) {
    return { status: 0, headers: {}, body: raw };
  }
  let headers = {};
  for (let line of lines) {
    let i = line.indexOf(":");
    if (i > 0) {
      headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
  }
  if (/chunked/i.test(headers["transfer-encoding"] ?? "")) {
    let out = "";
    let rest = body;
    for (;;) {
      let nl = rest.indexOf("\r\n");
      if (nl == -1) {
        break;
      }
      let size = parseInt(rest.slice(0, nl), 16);
      if (!size) {
        break;
      }
      out += rest.substr(nl + 2, size);
      rest = rest.slice(nl + 2 + size + 2);
    }
    body = out;
  }
  return { status: Number(m[1]), headers, body };
}

function hostHeader(host, port) {
  return (host.includes(":") ? `[${host}]` : host) + `:${port}`;
}

/**
 * Sends one HTTP/1.1 request to a local server (not through any proxy).
 *
 * @param {URL} url - http:// URL on loopback or LAN (validated by the caller)
 */
export async function httpRequest(url, { method = "GET", headers = {}, body = "", timeoutMs = 3000 } = {}) {
  let host = url.hostname.replace(/^\[|\]$/g, "");
  let port = Number(url.port || 80);
  let lines = [
    `${method} ${url.pathname}${url.search} HTTP/1.1`,
    `Host: ${hostHeader(host, port)}`,
    "Connection: close",
    "User-Agent: Nullpath",
  ];
  for (let [k, v] of Object.entries(headers)) {
    lines.push(`${k}: ${v}`);
  }
  let utf8Body = body ? String.fromCharCode(...new TextEncoder().encode(body)) : "";
  if (utf8Body) {
    lines.push(`Content-Length: ${utf8Body.length}`);
  }
  let raw = await exchange(host, port, lines.join("\r\n") + "\r\n\r\n" + utf8Body, { timeoutMs });
  let res = parseResponse(raw);
  if (res) {
    try {
      res.body = new TextDecoder().decode(
        Uint8Array.from(res.body, c => c.charCodeAt(0))
      );
    } catch (e) {}
  }
  return res;
}

export function basicAuth(user, pass) {
  let bytes = new TextEncoder().encode(`${user}:${pass}`);
  return "Basic " + btoa(String.fromCharCode(...bytes));
}

/**
 * The address sent through a proxy to identify it (§4.2 step 2). The
 * reserved .invalid label makes sure no router can resolve it, so the router
 * answers with its own error page without using the network.
 */
export const PROBE_HOST = "nullpath-probe.invalid.i2p";

/**
 * Signatures seen in router-generated error pages. Java I2P 2.x answers an
 * unknown host with its "Website Unknown" page (it includes jump-service
 * links and "I2P" in the title); i2pd's HTTP proxy answers with an HTML page
 * titled "I2Pd HTTP proxy". Verify against the pinned i2pd version and the
 * current Java I2P release whenever either changes.
 */
const I2P_SIGNATURES = [/\bi2pd\b/i, /\bI2P\b/, /i2p router/i, /addresshelper/i, /jump service/i];

/**
 * Identifies whatever listens on `endpoint`.
 *
 * @returns {Promise<"i2p"|"other"|"none">}
 */
export async function identifyProxy({ host, port }, timeoutMs = 3000) {
  let request =
    `GET http://${PROBE_HOST}/ HTTP/1.1\r\n` +
    `Host: ${PROBE_HOST}\r\n` +
    "Connection: close\r\n\r\n";
  let raw = await exchange(host, port, request, { timeoutMs, maxBytes: 64 * 1024 });
  if (raw == null) {
    return "none";
  }
  let res = parseResponse(raw);
  if (!res || res.status < 400) {
    return raw.length ? "other" : "none";
  }
  let text = Object.values(res.headers).join("\n") + "\n" + res.body;
  return I2P_SIGNATURES.some(re => re.test(text)) ? "i2p" : "other";
}

/**
 * Checks whether an HTTP proxy can reach a public host through its outproxy
 * by asking for a CONNECT tunnel. Only the proxy's response is read; no
 * request is sent inside the tunnel.
 *
 * @returns {Promise<{ok: boolean, status: number}>}
 */
export async function checkOutproxy({ host, port }, target, timeoutMs = 30000) {
  let request =
    `CONNECT ${target.host}:${target.port} HTTP/1.1\r\n` +
    `Host: ${target.host}:${target.port}\r\n\r\n`;
  let raw = await exchange(host, port, request, {
    timeoutMs,
    maxBytes: 16 * 1024,
    stopWhen: data => data.includes("\r\n\r\n"),
  });
  let res = parseResponse(raw);
  return { ok: res?.status == 200, status: res?.status ?? 0 };
}

/** JSON-RPC 2.0 over plain HTTP (Java I2P's /jsonrpc/). */
export async function jsonRpc(url, method, params, timeoutMs = 3000) {
  let res = await httpRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    timeoutMs,
  });
  if (!res || res.status != 200) {
    throw new Error("I2PControl request failed");
  }
  let reply = JSON.parse(res.body);
  if (reply.error) {
    throw new Error(reply.error.message || "I2PControl error");
  }
  return reply.result;
}
