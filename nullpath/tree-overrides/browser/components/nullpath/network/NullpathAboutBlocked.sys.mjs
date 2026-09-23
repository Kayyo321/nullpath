/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * about:nullpath-blocked, the page shown in place of a request the request
 * blocker cancelled (§7.4, §8.4).
 *
 * Nullpath uses its own page instead of new about:neterror codes: neterror
 * derives its text from nsresult values in C++ (nsDocShell::DisplayLoadError)
 * and has no hook for new codes.
 *
 * The page is unprivileged (it runs in a content process with its own
 * about: principal) and web pages can't link to it (no MAKE_LINKABLE). It
 * talks to the parent only through the NullpathBlocked actor, whose actions
 * are limited to this page's buttons.
 */

const PAGE = "chrome://browser/content/nullpath/blocked.html";

export class NullpathAboutBlocked {
  QueryInterface = ChromeUtils.generateQI(["nsIAboutModule"]);

  newChannel(uri, loadInfo) {
    let channel = Services.io.newChannelFromURIWithLoadInfo(
      Services.io.newURI(PAGE),
      loadInfo
    );
    channel.originalURI = uri;
    loadInfo.resultPrincipalURI = uri;
    return channel;
  }

  getURIFlags() {
    return (
      Ci.nsIAboutModule.ALLOW_SCRIPT |
      Ci.nsIAboutModule.URI_MUST_LOAD_IN_CHILD |
      Ci.nsIAboutModule.URI_SAFE_FOR_UNTRUSTED_CONTENT |
      Ci.nsIAboutModule.HIDE_FROM_ABOUTABOUT
    );
  }

  getChromeURI() {
    return Services.io.newURI(PAGE);
  }
}
