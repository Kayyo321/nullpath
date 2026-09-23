/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The i2pd release this Nullpath release installs (§5.3, §5.7). Change all
 * four values together, and only after checking the release yourself.
 *
 * Provenance of the current pin: the SHA-256 is the "digest" GitHub reports
 * for the release asset (api.github.com/repos/PurpleI2P/i2pd/releases,
 * tag 2.61.0, published 2026-07-20). Re-verify it against a local download
 * and the i2pd maintainers' signed checksums before a release.
 */
export const NULLPATH_I2PD_VERSION = "2.61.0";
export const NULLPATH_I2PD_ASSET = "i2pd_2.61.0_win64_mingw.zip";
export const NULLPATH_I2PD_URL =
  "https://github.com/PurpleI2P/i2pd/releases/download/2.61.0/i2pd_2.61.0_win64_mingw.zip";
export const NULLPATH_I2PD_SHA256 =
  "a0a8fb199a6bc5b487df71567791de6997050b921d65622ef9e936ffa88bc83f";
/** Shown on the explain screen ("about {size} MB"). */
export const NULLPATH_I2PD_SIZE_BYTES = 4301473;

/**
 * Hosts the setup download may be redirected to. GitHub release downloads
 * redirect to its asset CDN; nothing else is allowed.
 */
export const NULLPATH_I2PD_DOWNLOAD_HOSTS = Object.freeze([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);
