# Nullpath production-readiness handoff

**Written:** 2026-09-23. **Written against:** branch `build/windows-native`, Nullpath
`156.0.1-1` (LibreWolf 156.0.1-1, Firefox 156.0.1), pinned i2pd 2.61.0.

This document is an executable work order. It tells the executing agent (human
or AI) exactly what to change, how to test it, and how to reach one of two
final verdicts: **PRODUCTION READY** or **NOT PRODUCTION READY**. The verdict
is mechanical: it follows from the gate table in §7. Nobody decides it by
judgement.

Read §0 completely before touching anything.

---

## 0. Rules for the executing agent

These rules override your own preferences, habits and "improvements".

1. **Do exactly what is written.** Every behaviour, file name, id, string,
   pref name, threshold and command below is a decision that has already been
   made. Don't rename, reword, reorder, "simplify", widen or narrow any of it.
   Where this document gives code, use that code. Where it gives exact
   strings, use those strings character for character.
2. **Freedom you do have.** Where this document specifies behaviour but not
   code (mostly tests and small glue), write code that matches the surrounding
   files' style: `XPCOMUtils.declareLazy`, `moz-src:///` imports, 2-space
   indent, double quotes, the `h(d, tag, attrs, ...children)` helper in the
   panel, `add_task` in tests. Variable names inside functions are yours to
   choose. Nothing else is.
3. **No new scope.** Don't fix, refactor or restyle anything that isn't a
   work item. If you notice another problem, write it in the evidence file
   `docs/nullpath/release-evidence/<VER>/NOTES.md` under "Found, not fixed"
   and carry on.
4. **When reality disagrees with this document** (a file, function, id or
   command doesn't exist as described, or a step fails twice with the same
   error): stop that work item. Write `BLOCKED: <what you expected>, <what you
   found>, <exact error text>` in `NOTES.md`, mark every gate that depends on
   it FAIL, and continue with the independent items. Don't invent an
   alternative design. The only exceptions are the decision trees written
   into this document ("if X, then do Y"). Follow those exactly.
5. **Evidence or it didn't happen.** A gate is PASS only when every one of
   its evidence files exists and shows the pass condition. "I checked it" is
   not evidence. Evidence is the files listed per gate: logs, JSON, command
   output or a filled-in checklist.
6. **Owner-only actions** (§6) need the repository owner. Prepare everything
   around them, ask the owner in one message listing all of them at once, and
   wait. If the owner doesn't provide them, those gates are FAIL. Never fake,
   stub or self-sign your way past them.
7. **Git.** Work on the branch `release/readiness-156.0.1-1` (created in W0).
   One commit per work item, with the message `W<n>: <work item title>`
   (for example `W4: about:nullpath-network`). Verification evidence is committed in
   commits named `V<n>: evidence`. Never force-push. Never push unless the
   owner says so. Never commit private keys, passwords, `.etl` or `.pcapng`
   captures, or anything under `D:\nullpath\verify\`.
8. **Never weaken fail-closed behaviour to make a test pass.** If a test shows
   a leak, the fix goes in Nullpath code, and the scenario is re-run from its
   start.
9. **Reporting.** When you finish, paste the complete `VERDICT.md` (§7) into
   your final message to the owner, unchanged.

`<VER>` below always means the contents of `version` + `-` + `release`
(today `156.0.1-1`).

---

## 1. Environment facts

- Repository root: `D:\nullpath\librewolf-source` (git, remote `origin` =
  `https://github.com/Kayyo321/nullpath.git`).
- Nullpath source of truth: `nullpath/` (tree overrides, patches, settings,
  branding). The prepared Firefox tree `librewolf-156.0.1-1/` is **generated**.
  Never edit it except when making a patch (§1.3).
- Object directory: `D:\nullpath\obj`. The test build (W9) uses
  `D:\nullpath\obj-test`.
- Paths below starting `nullpath/tree-overrides/browser/components/nullpath/`
  are shortened to `NP/`.

### 1.1 Running build steps

From PowerShell, with ripgrep on `PATH` (the overlay needs `rg`):

```powershell
$rg = (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Directory -Filter 'BurntSushi.ripgrep.MSVC_*' | Select-Object -First 1).FullName
$rgDir = (Get-ChildItem $rg -Directory -Filter 'ripgrep-*' | Select-Object -First 1).FullName
$env:PATH = "$rgDir;$env:PATH"
$env:MOZILLABUILD = 'C:\mozilla-build\'
$env:MSYSTEM = 'MINGW64'
& C:\mozilla-build\msys2\usr\bin\bash.exe --login -c "cd /d/nullpath/librewolf-source && env -u CLAUDECODE ./scripts/windows-build.sh <steps>"
```

`env -u CLAUDECODE` stops mach from trimming its output, so the real error
doesn't go missing.

- `fast` is only for JS, CSS, FTL, SVG, HTML and pref changes. After `fast`,
  start the browser with `-purgecaches`, or it keeps running the old
  `.sys.mjs` code.
- `build` is required after changing `moz.build`, `jar.mn`, `components.conf`,
  patches or build flags.
- `prepare` re-extracts the whole tree. Only run it where this document says
  so.

### 1.2 Launching Nullpath for verification

Processes started from inside the Claude desktop app see `%APPDATA%`
redirected into the app's package folder, so their profiles differ from a
normal launch. For every verification step (§5), launch Nullpath from an
ordinary (non-Claude) Windows PowerShell window with:

```powershell
Start-Process explorer.exe -ArgumentList '"C:\Program Files\Nullpath\nullpath.exe"'
```

Launching through `explorer.exe` also means Nullpath runs unelevated even when
the PowerShell window is elevated.

### 1.3 Making a patch against the prepared tree

New upstream edits go in `nullpath/patches/*.patch` and are listed in
`nullpath/patches.txt`. To make one:

```bash
cd /d/nullpath/librewolf-source/librewolf-156.0.1-1
cp path/to/file path/to/file.orig
# edit path/to/file
diff -u --label a/path/to/file --label b/path/to/file path/to/file.orig path/to/file >> ../nullpath/patches/<name>.patch
rm path/to/file.orig
```

Repeat for each file in the same patch, appending with `>>`. The edit stays
in the prepared tree, so the next `build` includes it. The clean-`prepare`
build in §4 proves that the series applies from scratch.

---

## 2. Summary of what is wrong today

| # | Problem | Fixed by |
|---|---|---|
| 1 | No network leak checks run (§12 of I2P-ROUTER-TOGGLE.md) | W12, V3 |
| 2 | Automated tests can't run (`--disable-tests`) and half of the §12 tests don't exist | W9, W10, G3 |
| 3 | Managed i2pd uses a **persistent, shared** HTTP proxy destination (`keys = nullpath-sites.dat`), so every `.i2p` site sees the same client identity across sites and across sessions | W1, V4 |
| 4 | Profile launch bug: `-P <name>` opened a different profile | W14 |
| 5 | No update channel and no security release policy | W13 |
| 6 | Nothing is code-signed; no signed checksums; no installer signing flow | W11, O1, O2 |
| 7 | i2pd pin provenance only checked against GitHub's digest | V1 |
| 8 | Installer never run; the uninstaller leaves the Nullpath-installed router (and a running `i2pd.exe`) behind | W16, V6 |
| 9 | uBlock Origin not bundled; I2P profiles have no content blocker | W8 |
| 10 | No `about:nullpath-network` disclosure page | W4 |
| 11 | i2pd license missing from `about:license` | W7 |
| 12 | Keyboard shortcut (§2.2) missing | W5 |
| 13 | "Close all windows of this mode" missing | W6 |
| 14 | "Enable Firefox Sync" string; Sync not locked off in I2P profiles | W2 |
| 15 | Detection signatures, Java I2P paths and i2pd console commands never checked against the real programs | V2 |
| 16 | Resist-fingerprinting (RFP) not locked in I2P profiles; fingerprint never measured | W2, V4 |
| 17 | i2pd `addresshelper = true` behaviour unverified (address-book phishing) | V5 |
| 18 | Setup download briefly re-enables DNS application-wide | W8 (uBO CNAME uncloaking off), V3 S2 |
| 19 | No threat model, no security contact, no independent review | W13, O3, O4 |
| 20 | Docs stale (README says routing isn't implemented; §15 says nothing compiled); 7 files uncommitted | W0, W13 |
| 21 | Accessibility never tested with a screen reader | V7 |

### Decisions already made (don't reopen them)

- **D1 Updates.** 1.x has **no auto-updater and no staleness warning**.
  Instead: (a) a published policy of a Nullpath release within 7 days of every
  Firefox security release (W13), and (b) signed release checksums (W11, O2).
  Building a MAR update service and an "old build" warning are both out of
  scope. Don't add either.
- **D2 I2P client identity.** The managed router uses **transient** keys for
  both HTTP proxy destinations. They are regenerated each time i2pd starts.
  Per-site destinations are out of scope for 1.x and are disclosed as a
  limitation.
- **D3 Installer and router removal.** Ship Firefox's NSIS full installer as
  produced by `mach package`. bsys6 isn't ported. **The uninstaller always
  removes the router that Nullpath's guided setup installed** ("Set up I2P for
  me"), with no checkbox and no prompt, including silent (`/S`) uninstalls
  (W16):
  - It acts only when `%LOCALAPPDATA%\nullpath\i2p-router\i2pd.conf` exists
    for the Windows account that runs the uninstaller.
  - It stops only `i2pd.exe` processes whose executable lies inside that
    folder, then deletes the folder.
  - A router the user installed themselves ("Use my own I2P router": Java
    I2P, their own i2pd, anything outside that folder) is never stopped,
    changed or deleted.
  - Nothing is removed for other Windows accounts. That's disclosed in the
    README.
  - If Nullpath is installed again later, it notices the missing folder and
    forgets the old managed setup (W16 step 2), so the router panel offers
    setup again instead of reporting a missing router.

  This replaces I2P-ROUTER-TOGGLE.md §5.6's "checkbox, off by default".
- **D4 Out of scope for this release:** languages other than en-US, Linux and
  macOS, per-site I2P destinations, an auto-updater and Azure Trusted Signing.
  Each is listed as a limitation (W4, W13) and isn't a gate.
- **D5 Fingerprinting.** Lock `privacy.resistFingerprinting = true` in I2P
  profiles. Add no other fingerprinting prefs.
- **D6 Sync.** Lock `identity.fxaccounts.enabled = false` in I2P profiles.
  Direct web keeps the checkbox.
- **D7 "Close all windows of this mode"** lives in the router panel footer,
  not in the Firefox profiles menu (that menu rebuilds itself on every show).
- **D8 Code signing** uses a certificate in the Windows certificate store
  (OV or EV, hardware token), through the existing `sign` step.

---

## 3. Work items (code)

Do them in this order. After each one, run the checks it lists, then commit.

### W0. Checkpoint and branch

1. `git status --short` must show exactly these 7 modified files:
   `nullpath/patches/i2p-secure-context.patch`,
   `nullpath/settings/nullpath-overrides.cfg`,
   `NP/router/NullpathManagedRouter.sys.mjs`,
   `NP/router/NullpathRouterConfig.sys.mjs`,
   `NP/router/NullpathRouterPanel.sys.mjs`,
   `NP/tests/xpcshell/test_config.js`,
   `NP/tests/xpcshell/test_managed_conf.js`.
   If the list differs, record it in `NOTES.md` and commit what's there.
2. `git add -A nullpath docs scripts` then `git commit -m "Checkpoint before production-readiness work"`.
3. `git switch -c release/readiness-156.0.1-1`.
4. Create `docs/nullpath/release-evidence/156.0.1-1/` containing `NOTES.md`
   with the headings `# Notes`, `## Found, not fixed` and `## Blocked`.
   Commit as `W0: Evidence folder`.

### W1. Transient I2P client destinations

**Why:** with `keys = nullpath-sites.dat`, every `.i2p` site (whose server
tunnel adds `X-I2P-DestB32`) sees the same client address, forever.

In `NP/router/NullpathManagedRouter.sys.mjs`:

1. In `buildI2pdConf`, replace the line `keys = nullpath-sites.dat` with
   `keys = transient-nullpath-sites`.
2. In `buildTunnelsConf`, replace `keys = nullpath-publicweb.dat` with
   `keys = transient-nullpath-publicweb`.
3. Add this export directly after `setConfKey`:

```js
/**
 * Moves configs written before transient keys to them (D2 in
 * PRODUCTION-READINESS-HANDOFF.md). Only the exact values Nullpath wrote are
 * replaced; a user's own keys line is kept.
 */
export function migrateTransientKeys(i2pdConf, tunnelsConf) {
  let changed = false;
  if (/^\s*keys\s*=\s*nullpath-sites\.dat\s*$/m.test(i2pdConf)) {
    i2pdConf = setConfKey(i2pdConf, "httpproxy", "keys", "transient-nullpath-sites");
    changed = true;
  }
  if (/^\s*keys\s*=\s*nullpath-publicweb\.dat\s*$/m.test(tunnelsConf)) {
    tunnelsConf = setConfKey(tunnelsConf, "nullpath-publicweb", "keys", "transient-nullpath-publicweb");
    changed = true;
  }
  return { i2pdConf, tunnelsConf, changed };
}
```

4. Add this private method to the `ManagedRouter` class, directly above
   `start()`:

```js
  /** Applies migrateTransientKeys and deletes the old persistent keys. */
  async #migrateKeys() {
    let confPath = PathUtils.join(this.dir, "i2pd.conf");
    let tunPath = PathUtils.join(this.dir, "tunnels.conf");
    let i2pdConf = await IOUtils.readUTF8(confPath);
    let tunnelsConf = await IOUtils.readUTF8(tunPath).catch(() => "");
    let m = migrateTransientKeys(i2pdConf, tunnelsConf);
    if (!m.changed) {
      return;
    }
    await IOUtils.writeUTF8(confPath, m.i2pdConf);
    if (tunnelsConf) {
      await IOUtils.writeUTF8(tunPath, m.tunnelsConf);
    }
    for (let file of ["nullpath-sites.dat", "nullpath-publicweb.dat"]) {
      await IOUtils.remove(PathUtils.join(this.dir, "data", file), { ignoreAbsent: true });
    }
  }
```

5. In `start()`, directly after the `if (!(await this.exeExists())) { … }`
   block and before `IOUtils.makeDirectory(…"data"…)`, add
   `await this.#migrateKeys();`.
6. In `NP/router/NullpathRouterPanel.sys.mjs`, `#renderWhatIs()`: add
   `h(d, "p", { l10n: { id: "nullpath-whatis-same-address" } }),` directly
   after the `nullpath-whatis-other-apps` paragraph.
7. In `nullpath/tree-overrides/browser/locales/en-US/browser/nullpath/router.ftl`,
   add after `nullpath-whatis-other-apps`:

```
nullpath-whatis-same-address = All I2P sites you visit see the same I2P address until the router restarts, so they can tell your visits come from the same browser session.
```

8. In `docs/nullpath/I2P-ROUTER-TOGGLE.md` §5.4, change the sample config's
   `keys = nullpath-sites.dat` to `keys = transient-nullpath-sites`.
9. Tests: see W10 items X1 and X2.

The fallback, if V4 shows that i2pd treats `transient-…` as a file name, is
written in V4. Don't apply it pre-emptively.

### W2. Lock resist-fingerprinting and Sync in I2P profiles; fix the Sync string

1. In `NP/network/NullpathProfileMode.sys.mjs`, `LOCKED_PREFS`, add these two
   entries directly after `"app.update.auto": false,`:

```js
  // D5, D6 in PRODUCTION-READINESS-HANDOFF.md.
  "privacy.resistFingerprinting": true,
  "identity.fxaccounts.enabled": false,
```

2. In `scripts/nullpath-overlay.py`, directly before the line
   `cfg = (ROOT / "settings/librewolf.cfg")…`, add:

```python
# Settings > Sync checkbox: name what it does. It's locked off in I2P profiles.
replace("browser/locales/en-US/browser/preferences/preferences.ftl", [
    ("    .label = Enable Firefox Sync\n    .description = Sync your data with other browsers. Requires restart.",
     "    .label = Enable sync with a Mozilla account\n    .description = Sync your data through Mozilla’s servers. Always off in the I2P profiles. Requires restart."),
])
```

3. Tests: W10 item X3.

### W3. (Removed)

The staleness warning was removed from this handoff on 2026-09-23 by the
owner's decision (D1). Don't implement any "old build" warning, build-age
check or `nullpath.staleness.*` pref. There's nothing to do and nothing to
commit for W3. The number is kept so the other item numbers stay stable.

### W4. `about:nullpath-network`

1. Generate a CID with PowerShell `"{$([guid]::NewGuid())}"` and write it
   down. It's used in step 3.
2. Create `NP/network/NullpathAboutNetwork.sys.mjs` as a copy of
   `NullpathAboutBlocked.sys.mjs`, with these differences:
   - class name `NullpathAboutNetwork`;
   - `PAGE = "chrome://browser/content/nullpath/network.html"`;
   - the doc comment reads: `about:nullpath-network, the network disclosure page (I2P-ROUTER-TOGGLE.md §10). Static: no script. Web pages can't link to it.`;
   - `getURIFlags()` returns
     `Ci.nsIAboutModule.URI_MUST_LOAD_IN_CHILD | Ci.nsIAboutModule.URI_SAFE_FOR_UNTRUSTED_CONTENT`
     (no `ALLOW_SCRIPT`, no `HIDE_FROM_ABOUTABOUT`, no `MAKE_LINKABLE`).
3. `NP/components.conf`: add a second entry to `Classes`:

```python
    {
        'cid': '<the CID from step 1>',
        'contract_ids': ['@mozilla.org/network/protocol/about;1?what=nullpath-network'],
        'esModule': 'moz-src:///browser/components/nullpath/network/NullpathAboutNetwork.sys.mjs',
        'constructor': 'NullpathAboutNetwork',
    },
```

4. `NP/moz.build`: add `"network/NullpathAboutNetwork.sys.mjs",` to
   `MOZ_SRC_FILES` directly after `"network/NullpathAboutBlocked.sys.mjs",`.
5. `NP/jar.mn`: add after the `blocked.css` line:

```
    content/browser/nullpath/network.html (content/network.html)
    content/browser/nullpath/network.css (content/network.css)
```

6. Create `NP/content/network.css`:

```css
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

main {
  max-width: 52em;
  margin: 2em auto;
  padding-inline: 16px;
}

#diagram {
  overflow-x: auto;
  padding: 1em;
  border: 1px solid var(--in-content-border-color);
  border-radius: 4px;
  font-size: 0.85em;
  line-height: 1.3;
}
```

7. Create `NP/content/network.html`. The `<pre>` holds the diagram block from
   `docs/nullpath/NETWORK.md`, copied **verbatim** (everything between the
   opening and closing triple backticks, with `&`, `<` and `>` escaped as
   `&amp;`, `&lt;` and `&gt;`):

```html
<!DOCTYPE html>
<!-- This Source Code Form is subject to the terms of the Mozilla Public
   - License, v. 2.0. If a copy of the MPL was not distributed with this
   - file, You can obtain one at http://mozilla.org/MPL/2.0/. -->
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src chrome:; object-src 'none'" />
    <meta name="color-scheme" content="light dark" />
    <link rel="localization" href="branding/brand.ftl" />
    <link rel="localization" href="browser/nullpath/router.ftl" />
    <link rel="stylesheet" href="chrome://global/skin/in-content/common.css" />
    <link rel="stylesheet" href="chrome://browser/content/nullpath/network.css" />
    <title data-l10n-id="nullpath-network-title"></title>
  </head>
  <body>
    <main>
      <h1 data-l10n-id="nullpath-network-title"></h1>
      <p data-l10n-id="nullpath-network-intro"></p>
      <h2 data-l10n-id="nullpath-network-diagram-heading"></h2>
      <pre id="diagram" aria-describedby="diagram-description"><!-- NETWORK.md diagram here --></pre>
      <p id="diagram-description" data-l10n-id="nullpath-network-diagram-description"></p>
      <h2 data-l10n-id="nullpath-network-direct-heading"></h2>
      <ul>
        <li data-l10n-id="nullpath-network-direct-setup"></li>
        <li data-l10n-id="nullpath-network-direct-console"></li>
        <li data-l10n-id="nullpath-network-direct-directweb"></li>
        <li data-l10n-id="nullpath-network-direct-router"></li>
      </ul>
      <h2 data-l10n-id="nullpath-network-limits-heading"></h2>
      <ul>
        <li data-l10n-id="nullpath-network-limit-browser-only"></li>
        <li data-l10n-id="nullpath-network-limit-isp"></li>
        <li data-l10n-id="nullpath-network-limit-same-address"></li>
        <li data-l10n-id="nullpath-network-limit-outproxy"></li>
        <li data-l10n-id="nullpath-network-limit-updates"></li>
        <li data-l10n-id="nullpath-network-limit-anonymity"></li>
      </ul>
    </main>
  </body>
</html>
```

8. `router.ftl`: add at the end:

```
## about:nullpath-network (PRODUCTION-READINESS-HANDOFF.md W4)

nullpath-network-title = How { -brand-short-name } connects
nullpath-network-intro = This page lists where { -brand-short-name } sends network traffic in each browsing mode. It describes the design. Test results for each release are published with that release.
nullpath-network-diagram-heading = Network paths
nullpath-network-diagram-description = In the I2P profiles, every request passes the request blocker and the proxy filter, then goes to the local I2P proxy and the I2P router. Public web via I2P also uses an outproxy run by a third party. The router’s own connections to other I2P routers are separate from browser traffic.
nullpath-network-direct-heading = Direct connections
nullpath-network-direct-setup = I2P profiles, guided setup only: one HTTPS download of i2pd from github.com and its download servers, plus the DNS lookups for those names.
nullpath-network-direct-console = I2P profiles: connections to your I2P router on this computer, or on your local network if you allowed that.
nullpath-network-direct-directweb = Direct web profile: ordinary internet connections, like any browser, including uBlock Origin filter-list updates.
nullpath-network-direct-router = The I2P router (a separate program): connections to other I2P routers and to reseed servers, over your ordinary internet connection.
nullpath-network-limits-heading = Limitations
nullpath-network-limit-browser-only = { -brand-short-name } sends only its own browser traffic through I2P. Other apps on this computer aren’t affected.
nullpath-network-limit-isp = Your internet provider can see that this computer uses I2P.
nullpath-network-limit-same-address = All I2P sites you visit see the same I2P address until the router restarts, so they can tell your visits come from the same browser session.
nullpath-network-limit-outproxy = Public web via I2P sends your traffic through an outproxy run by a third party. The outproxy can see which sites you visit, and the content of any connection that isn’t HTTPS.
nullpath-network-limit-updates = { -brand-short-name } doesn’t update itself. Download new versions from github.com/Kayyo321/nullpath/releases.
nullpath-network-limit-anonymity = { -brand-short-name } doesn’t make you anonymous by itself.
nullpath-whatis-network = How { -brand-short-name } connects
```

9. `NP/router/NullpathRouterPanel.sys.mjs`, `#renderWhatIs()`: directly after
   the `nullpath-whatis-faq` button, add:

```js
      h(d, "button", {
        id: "nullpath-whatis-network",
        class: "text-link nullpath-router-link",
        l10n: { id: "nullpath-whatis-network" },
        onclick: () => this.#openTab("about:nullpath-network"),
      }),
```

10. Needs `build`, not `fast`. Tests: W10 item B5, and V8.

### W5. Keyboard shortcut (I2P-ROUTER-TOGGLE.md §2.2)

1. `NP/NullpathGlue.sys.mjs`: add this method after `labelWindow`, and call
   `this.addShortcut(win);` in `onWindowReady` directly after
   `this.labelWindow(win);`:

```js
  /**
   * §2.2: a shortcut with no default binding. Users assign one in
   * about:keyboard (nullpath-customkeys.patch lists it there).
   */
  addShortcut(win) {
    let doc = win.document;
    if (doc.getElementById("key_nullpathRouterPanel")) {
      return;
    }
    let command = doc.createXULElement("command");
    command.id = "cmd_nullpathRouterPanel";
    command.addEventListener("command", () => lazy.NullpathRouterWidget.openPanel(win));
    doc.getElementById("mainCommandSet").append(command);
    let keyset = doc.createXULElement("keyset");
    keyset.id = "nullpathKeyset";
    let key = doc.createXULElement("key");
    key.id = "key_nullpathRouterPanel";
    key.setAttribute("command", "cmd_nullpathRouterPanel");
    keyset.append(key);
    doc.getElementById("mainKeyset").after(keyset);
  },
```

2. Make `nullpath/patches/nullpath-customkeys.patch` (see §1.3) with two
   edits:
   - `browser/components/customkeys/CustomKeysParent.sys.mjs`: directly after
     the line `add(cat, "key_duplicateTab", "customkeys-file-duplicate-tab");`
     insert `    add(cat, "key_nullpathRouterPanel", "customkeys-nullpath-router-panel");`
     (4-space indent, matching the line above).
   - `browser/locales/en-US/browser/customkeys.ftl`: append
     `\n# Nullpath (nullpath/patches/nullpath-customkeys.patch)\ncustomkeys-nullpath-router-panel = Open I2P router panel\n`.
3. Append `patches/nullpath-customkeys.patch` as a new last line of
   `nullpath/patches.txt`.
4. Needs `build`. Tests: W10 item B7.

### W6. "Close all windows of this mode" (D7)

1. `NP/router/NullpathRouterPanel.sys.mjs`, `#renderMain()`: in the
   `nullpath-router-buttons` div, add this as the **last** child (after the
   `consoleURL ? … : null` expression):

```js
        h(d, "button", {
          id: "nullpath-router-close-mode",
          class: "footer-button",
          l10n: { id: "nullpath-router-close-mode-windows" },
          // Each mode is its own profile and process, so quitting this
          // process closes exactly this mode's windows.
          onclick: () => Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit),
        })
```

2. `router.ftl`: add after `nullpath-router-console`:
   `nullpath-router-close-mode-windows = Close all windows of this mode`
3. `docs/nullpath/I2P-ROUTER-TOGGLE.md` §15, "Where the code departs from the
   spec": add the row
   `| "Close all windows of this mode" in the profile menu (§10) | A footer button in the router panel | Firefox rebuilds the profiles menu every time it's shown, so added items don't stay put. |`
4. Tests: V8 item 3 (manual; quitting can't run inside a browser test).

### W7. i2pd license in `about:license`

1. Download the license text:
   `curl -sSfL https://raw.githubusercontent.com/PurpleI2P/i2pd/2.61.0/LICENSE -o /tmp/i2pd-LICENSE`.
   If that 404s, use `…/2.61.0/LICENSE.txt`. If both fail, the item is BLOCKED.
2. Make `nullpath/patches/nullpath-license.patch` (§1.3) editing
   `toolkit/content/license.html`:
   - Directly before the line `      <li><a href="about:license#icu">ICU License</a></li>`
     insert `      <li><a href="about:license#i2pd">i2pd License</a></li>`.
   - Directly before the `        <tr>` line that opens the row containing
     `<h1><a id="icu"></a>ICU License</h1>`, insert this block followed by one
     empty line:

```html
        <tr>
          <td>
            <h1><a id="i2pd"></a>i2pd License</h1>
          </td>
          <td>
            <p>This license applies to i2pd, the I2P router that Nullpath downloads from its authors when you choose guided setup. i2pd isn't included in Nullpath itself.</p>
          </td>
          <td>
            <pre>
LICENSE TEXT HERE
            </pre>
          </td>
        </tr>
```

   Replace `LICENSE TEXT HERE` with the downloaded file's content, with `&`,
   `<` and `>` escaped.
3. Append `patches/nullpath-license.patch` to `nullpath/patches.txt`.
4. Needs `build`. Check: V8 item 6.

### W8. Bundle uBlock Origin; turn off CNAME uncloaking

1. Get the current signed release from AMO:

```bash
curl -sSf https://addons.mozilla.org/api/v5/addons/addon/ublock-origin/ -o /tmp/ubo.json
python -c "import json;v=json.load(open('/tmp/ubo.json'))['current_version'];print(v['version']);print(v['file']['url']);print(v['file']['hash'])"
```

2. Download the printed URL to
   `nullpath/extensions/uBlock0@raymondhill.net.xpi`. Compute its SHA-256
   (`sha256sum`). It must equal the printed `hash` (after the `sha256:`
   prefix). If it doesn't, the item is BLOCKED.
3. Write `nullpath/extensions/SHA256SUMS` containing one line:
   `<sha256>  uBlock0@raymondhill.net.xpi` (two spaces). Write
   `nullpath/extensions/VERSION` containing the printed version.
4. `scripts/nullpath-overlay.py`: directly before the line
   `write(TREE / "lw/policies.json", …)`, add:

```python
# uBO's CNAME uncloaking calls browser.dns.resolve, which would resolve names
# locally during the guided-setup download, while DNS is briefly on.
policies["policies"].setdefault("3rdparty", {}).setdefault("Extensions", {})[UBO_ID] = {
    "userSettings": [["cnameUncloakEnabled", "false"]],
}
```

5. Commit the `.xpi`, `SHA256SUMS`, `VERSION` and the overlay change. Needs
   `build`, because the overlay edits `lw/moz.build`.
6. Check: V8 items 7 and 8.

### W9. Test build step

In `scripts/windows-build.sh`:

1. Add to the header comment, after the `fast` entry:
   `#   test      - build with tests enabled into ${OBJDIR}-test and run the Nullpath and customkeys tests`
2. Add this function directly after `do_fast`:

```bash
# Nullpath's xpcshell and browser-chrome tests. The release mozconfig has
# --disable-tests, so this builds a second tree config into ${OBJDIR}-test.
do_test() {
  require_mozillabuild test
  [ -d "$lw_dir" ] || die "$lw_dir not found; run 'prepare' first"
  fix_mozconfig_paths
  local testcfg="$lw_dir/mozconfig-test"
  grep -v -e '^ac_add_options --disable-tests$' -e '^mk_add_options MOZ_OBJDIR=' "$lw_dir/mozconfig" >"$testcfg"
  echo "mk_add_options MOZ_OBJDIR=${OBJDIR}-test" >>"$testcfg"
  local logdir="$ROOT/../build-logs"
  mkdir -p "$logdir"
  log "Building the test configuration into ${OBJDIR}-test"
  (cd "$lw_dir" && MOZCONFIG="$(cygpath -m "$ROOT/$testcfg")" ./mach build)
  log "Running tests"
  local status=0
  (cd "$lw_dir" && MOZCONFIG="$(cygpath -m "$ROOT/$testcfg")" \
    ./mach xpcshell-test browser/components/nullpath/tests/xpcshell/ 2>&1 | tee "$logdir/test-xpcshell.log") || status=1
  (cd "$lw_dir" && MOZCONFIG="$(cygpath -m "$ROOT/$testcfg")" \
    ./mach mochitest --flavor browser browser/components/nullpath/tests/browser/ browser/components/customkeys/tests/browser/ 2>&1 | tee "$logdir/test-browser.log") || status=1
  [ "$status" = 0 ] || die "tests failed; see $logdir/test-*.log"
}
```

3. The `case` and `unknown step` changes for `test` are made in W11 step 3.
   If you do W9 before W11, make only the `test` part of that change now.
4. The `mach` commands pipe through `tee`, so `set -o pipefail` (already on)
   makes a test failure fail the step. Don't remove `pipefail`.

### W10. Automated tests

Write these tests. Each lists its required assertions. All of them must pass
in G3.

**xpcshell** (`NP/tests/xpcshell/`; add new files to `xpcshell.toml` in
alphabetical order):

- **X1** `test_managed_conf.js`, task `test_conf_defaults`: add assertions
  that the output contains `keys = transient-nullpath-sites`, and that
  `!/\.dat\b/.test(conf)`. Task `test_tunnels`: that the outproxy output
  contains `keys = transient-nullpath-publicweb`, and `!/\.dat\b/`.
- **X2** `test_managed_conf.js`, new task `test_migrate_transient_keys`:
  (a) for the text that `buildI2pdConf` produced before W1 (write it inline
  with `keys = nullpath-sites.dat`) and a tunnels text with
  `keys = nullpath-publicweb.dat`, `migrateTransientKeys` returns
  `changed === true` and both transient lines; (b) for an i2pd.conf with
  `keys = mine.dat` in `[httpproxy]`, it returns `changed === false` and the
  text unchanged; (c) for already-migrated texts, `changed === false`.
- **X3** new `test_locked_prefs.js`: import `NullpathProfileMode` and call
  `initEarly()`, with no `nullpath.mode` pref set (so the mode is I2P sites).
  For each of these, assert `Services.prefs.prefIsLocked(name)` and the value:
  `network.proxy.type`=1, `network.dns.disabled`=true,
  `network.proxy.failover_direct`=false, `network.proxy.allow_bypass`=false,
  `network.trr.mode`=5, `media.peerconnection.enabled`=false,
  `network.http.http3.enable`=false, `xpinstall.enabled`=false,
  `privacy.resistFingerprinting`=true, `identity.fxaccounts.enabled`=false,
  `browser.ipProtection.enabled`=false, `nullpath.mode`="i2p-sites". Also
  assert that `Services.prefs.setBoolPref("privacy.resistFingerprinting", false)`
  either throws or leaves `getBoolPref` returning true.
- **X3b** new `test_locked_prefs_direct.js`: set the user pref
  `nullpath.mode`="direct" **before** importing the module. Call
  `initEarly()`. Assert `nullpath.mode` is locked with the value "direct",
  `browser.ipProtection.enabled` is locked false, and `network.proxy.type`
  is **not** locked.
- **X4** new `test_forget_removed.js` (W16 step 2). Point the shared config
  at a temporary directory the same way `test_config.js` does. Then, for each
  case, write `router.json` with `NullpathRouterConfig.update` and call
  `NullpathManagedRouter.forgetIfRemoved()`:
  (a) `setup: "managed"`, `managed.dir` = a path that doesn't exist, no
  `external`: returns `true`, then `config.setup === null` and
  `config.managed === null`;
  (b) the same, but with a valid `external` block: returns `true`, then
  `config.setup === "external"`, `config.managed === null` and `external`
  unchanged;
  (c) `setup: "managed"`, with `managed.dir` an existing directory: returns
  `false` and the config is unchanged;
  (d) `setup: "external"`, `managed: null`: returns `false` and the config is
  unchanged;
  (e) `setup: "managed"`, with `managed.dir` existing but no `bin\i2pd.exe`
  inside (the antivirus-quarantine case): returns `false` and the config is
  unchanged.
- **X5** `test_blocker_decisions.js`, new task `test_local_addresses`: in both
  modes, for each host in
  `["localhost", "foo.localhost", "127.0.0.1", "127.1.2.3", "::1", "10.1.2.3", "172.16.0.1", "192.168.0.1", "169.254.1.1", "0.0.0.0", "fc00::1", "fe80::1"]`,
  `decide(req({ mode, host }))` gives `allow === false` and
  `kind === Kinds.LOCAL`. If any host fails, fix `isPrivateHost`/`isLoopbackHost`
  in `NullpathRouterConfig.sys.mjs` so that `0.0.0.0/8`, `127.0.0.0/8`,
  `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`,
  `fc00::/7` and `fe80::/10` all count as local. Don't change anything else
  in those functions.
- **X6** `test_blocker_decisions.js`, new task `test_websocket_and_schemes`:
  `decide(req({ scheme: "wss", host: "example.com", topLevel: false }))` in
  i2p-sites gives `allow === false` and no `kind`. In i2p-publicweb with
  `publicWeb: "ready"` it gives `allow === true`. `decide(req({ scheme: "ftp" }))`
  gives `allow === false` and `kind === Kinds.LOCAL`.

**browser-chrome** (`NP/tests/browser/`; add new files to `browser.toml` in
alphabetical order). For how to reach Connected with a fake router, reuse the
approach in `browser_router_chooser.js` `test_own_router_save_and_connect`.
For state assertions, reuse the checks in `browser_router_widget.js`
`test_state_classes`.

- **B1** `browser_router_switch_windows.js`: reach Connected. Open a second
  browser window, and a popup with
  `window.open("about:blank", "_blank", "popup,width=400,height=300")`.
  Assert the Connected state on the toolbar button in both normal windows and
  on the URL-bar fallback icon in the popup (§2.1). Turn the switch off in
  the panel. Assert Not connected in all three. Close the extra windows.
- **B2** `browser_relay_switch.js`: write a managed setup into a temporary
  directory: a `router.json` `managed` block pointing at a temp dir, plus that
  dir's `i2pd.conf` from `buildI2pdConf`. Flip the relay switch on. Assert
  `i2pd.conf` now contains `notransit = false`. Re-open the panel and assert
  the switch shows on. Switch to an `external` setup. Assert the relay switch
  is disabled.
- **B3** `browser_publicweb_handoff.js`, in the I2P sites mode with the fake
  router Connected and no outproxy: (a) load `http://example.com/` in a new tab
  and assert the tab ends on
  `about:nullpath-blocked?kind=cant-open&reason=no-outproxy&u=…`; (b) submit a
  top-level POST form to `http://example.com/` (from a page the test loads)
  and assert `kind=form-blocked`; (c) set a state where
  `publicWebReadiness()` returns `"ready"` (stub the method on
  `NullpathRouter` for the test and restore it afterwards), load
  `http://example.com/`, and assert `kind=cant-open&reason=no-profile`,
  because no Public web profile exists in the test profile.
- **B4** `browser_keyboard_walk.js`: focus the router button, press Enter,
  and assert the panel opens. Press Tab 30 times, recording
  `document.activeElement` each time. Assert each recorded element has a
  non-empty accessible name (`aria-label`, `label`, or text content after
  trimming). Press Escape. Assert the panel is closed and focus is back on the
  router button.
- **B5** `browser_network_page.js`: open `about:nullpath-network` in a tab.
  Assert the `h1` text is non-empty, `#diagram` contains the text
  `Local HTTP proxy`, and there are exactly 4 items under the second `h2` and
  6 under the third.
- **B6** `browser_router_removed.js` (W16 step 2): write a `router.json`
  whose `setup` is `"managed"` with a `managed.dir` that doesn't exist. Call
  `NullpathManagedRouter.forgetIfRemoved()`, then open the router panel.
  Assert that the first-click chooser (§4.3) is shown, not a **Needs
  attention** state, and that the toolbar button's state is Not connected.
- **B7** `browser_shortcut.js`: assert `#key_nullpathRouterPanel` exists and
  has neither a `key` nor a `keycode` attribute. With
  `CustomKeys.changeKey("key_nullpathRouterPanel", { modifiers: "accel,alt,shift", key: "U" })`
  (import `CustomKeys` from `moz-src:///browser/components/customkeys/CustomKeys.sys.mjs`),
  synthesize Ctrl+Alt+Shift+U and assert the router panel opens. Close it,
  then `CustomKeys.resetKey("key_nullpathRouterPanel")`.

Tests are **not** allowed to change production behaviour to make themselves
pass. The one exception is X5, whose fix is specified above.

### W11. Installer signing and release checksums

In `scripts/windows-build.sh`:

1. Move the two `signtool` lines from `do_sign` (the `sign` call and the
   `verify` call, both with their `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'`
   prefix) into a helper placed directly above `do_sign`, and call it from
   `do_sign` with `sign_files "$signtool" "${files[@]}"`:

```bash
# signtool sign + verify with the Nullpath certificate (by thumbprint).
sign_files() {
  local signtool="$1"
  shift
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' "$signtool" sign \
    /fd sha256 /td sha256 /tr "$NULLPATH_SIGN_TIMESTAMP_URL" \
    /sha1 "$NULLPATH_SIGN_CERT_SHA1" "$@"
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' "$signtool" verify /pa /q "$@" ||
    die "signature verification failed"
}
```

   `do_sign` keeps its own variable checks, zip extraction and re-zipping
   unchanged. Only the two `signtool` invocations move into `sign_files`.

2. Add after `do_sign`:

```bash
# Rebuilds the full installer around the signed package and signs it,
# the way Mozilla's release pipeline does (mach repackage installer).
do_sign_installer() {
  require_mozillabuild sign-installer
  : "${NULLPATH_SIGN_CERT_SHA1:?set NULLPATH_SIGN_CERT_SHA1 to the signing certificate thumbprint}"
  : "${NULLPATH_SIGN_TIMESTAMP_URL:?set NULLPATH_SIGN_TIMESTAMP_URL to the RFC 3161 timestamp URL of your CA}"
  local signtool sevenz installer signedzip work out
  signtool="$(find_signtool)"
  [ -n "$signtool" ] && [ -f "$signtool" ] || die "signtool.exe not found; set NULLPATH_SIGNTOOL"
  sevenz="$(command -v 7z 2>/dev/null || true)"
  [ -n "$sevenz" ] || sevenz="/c/Program Files/7-Zip/7z.exe"
  [ -f "$sevenz" ] || die "7-Zip not found (7z on PATH or C:\\Program Files\\7-Zip\\7z.exe)"
  installer="$(ls -1 "$OBJDIR"/dist/nullpath-*.win64.installer.exe 2>/dev/null | grep -v '\.signed\.exe$' | head -n 1 || true)"
  signedzip="$(ls -1 "$OBJDIR"/dist/nullpath-*.win64.signed.zip 2>/dev/null | head -n 1 || true)"
  [ -n "$installer" ] || die "no installer found; run 'package' first"
  [ -n "$signedzip" ] || die "no signed package found; run 'sign' first"
  work="$(mktemp -d)"
  "$sevenz" e -y -o"$(cygpath -w "$work")" "$(cygpath -w "$installer")" setup.exe >/dev/null
  [ -f "$work/setup.exe" ] || die "setup.exe not found inside $installer"
  sign_files "$signtool" "$(cygpath -w "$work/setup.exe")"
  out="${installer%.exe}.signed.exe"
  (cd "$lw_dir" && ./mach repackage installer \
    --tag browser/installer/windows/app.tag \
    --setupexe "$(cygpath -m "$work/setup.exe")" \
    --package "$(cygpath -m "$signedzip")" \
    --package-name nullpath \
    --sfx-stub other-licenses/7zstub/firefox/7zSD.Win32.sfx \
    -o "$(cygpath -m "$out")")
  sign_files "$signtool" "$(cygpath -w "$out")"
  rm -rf "$work"
  echo "Signed installer -> $out"
}

# SHA256SUMS for the signed release files, with a detached signature made
# with the Nullpath release key (NULLPATH_RELEASE_KEY = its fingerprint).
do_checksums() {
  : "${NULLPATH_RELEASE_KEY:?set NULLPATH_RELEASE_KEY to the release signing key fingerprint}"
  (cd "$OBJDIR/dist" &&
    sha256sum nullpath-*.win64.signed.zip nullpath-*.win64.installer.signed.exe >SHA256SUMS &&
    rm -f SHA256SUMS.asc &&
    gpg --batch --armor --detach-sign --local-user "$NULLPATH_RELEASE_KEY" --output SHA256SUMS.asc SHA256SUMS &&
    gpg --batch --verify SHA256SUMS.asc SHA256SUMS)
  cat "$OBJDIR/dist/SHA256SUMS"
}
```

3. Add both steps to the header comment:
   `#   sign-installer - rebuild the installer around the signed package and sign it`
   and `#   checksums - SHA256SUMS + detached GPG signature for the signed files`.
   In the `case` statement, change
   `fetch|prepare|bootstrap|build|fast|package|sign|run) "do_$step" ;;` to
   `fetch|prepare|bootstrap|build|fast|test|package|sign|checksums|run) "do_$step" ;;`
   (this also covers W9's `test`), and add a separate arm directly below it:
   `sign-installer) do_sign_installer ;;`. Its function name can't contain
   `-`. Update the `unknown step` message to list
   `fetch prepare bootstrap build fast test package sign sign-installer checksums run all`.
4. This can't be tested end to end without O1 and O2. Test the refusals:
   running `sign-installer` without `NULLPATH_SIGN_CERT_SHA1` must fail with
   the message above, and `checksums` without `NULLPATH_RELEASE_KEY` likewise.
   Save both outputs to `release-evidence/<VER>/signing/refusals.txt`.

### W12. Verification tooling

Create these files exactly.

**`scripts/verify/leakcheck.ps1`**

```powershell
<#
Nullpath leak check (docs/nullpath/PRODUCTION-READINESS-HANDOFF.md, V3).
Windows PowerShell 5.1, elevated, Windows display language English.

  .\leakcheck.ps1 -Action start -Scenario S1
  ...run the scenario...
  .\leakcheck.ps1 -Action stop -Scenario S1 -Canary npc0123456789ab -Expect none

Expect:
  none    - no off-box connection from nullpath.exe, no canary in DNS
  setup   - as none, except TCP 443 to addresses that DNS returned for the
            pinned i2pd download hosts during the capture
  control - the capture must SEE off-box traffic and the canary (Direct web);
            proves the tooling works
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('start', 'stop')][string]$Action,
  [Parameter(Mandatory = $true)][ValidatePattern('^S[0-9]+[a-z]?$')][string]$Scenario,
  [string[]]$Canary = @(),
  [ValidateSet('none', 'setup', 'control')][string]$Expect = 'none',
  [string]$OutDir = 'D:\nullpath\verify\captures'
)
$ErrorActionPreference = 'Continue'
$me = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this from an elevated Windows PowerShell.' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$etl = Join-Path $OutDir "$Scenario.etl"
$pcap = Join-Path $OutDir "$Scenario.pcapng"
$stateFile = Join-Path $OutDir "$Scenario.state.json"
$resultFile = Join-Path $OutDir "$Scenario.result.json"
$setupHosts = @('github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com')

if ($Action -eq 'start') {
  auditpol /set /subcategory:"Filtering Platform Connection" /success:enable /failure:enable | Out-Null
  wevtutil sl Security /ms:1073741824
  wevtutil sl Microsoft-Windows-DNS-Client/Operational /e:true
  wevtutil cl Microsoft-Windows-DNS-Client/Operational
  Clear-DnsClientCache
  pktmon stop | Out-Null
  pktmon filter remove | Out-Null
  pktmon filter add NullpathDNS -p 53 | Out-Null
  if (Test-Path $etl) { Remove-Item $etl -Force }
  pktmon start --capture --pkt-size 0 --file-name $etl | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'pktmon failed to start' }
  @{ scenario = $Scenario; start = (Get-Date).ToString('o') } | ConvertTo-Json | Out-File -Encoding utf8 $stateFile
  Write-Output "Capture running for $Scenario. Run the scenario, then call -Action stop."
  return
}

if ($Canary.Count -eq 0) { throw 'Pass the scenario canary with -Canary.' }
$state = Get-Content $stateFile -Raw | ConvertFrom-Json
$start = [datetime]::Parse($state.start, $null, [Globalization.DateTimeStyles]::RoundtripKind)
pktmon stop | Out-Null
pktmon etl2pcap $etl --out $pcap | Out-Null
$stop = Get-Date

function Strip([string]$a) { return ($a -replace '^::ffff:', '') }

# Outbound connections by nullpath.exe (WFP audit: 5156 allowed, 5157 blocked).
$conns = @()
$events = Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 5156, 5157; StartTime = $start } -ErrorAction SilentlyContinue
foreach ($e in $events) {
  $x = [xml]$e.ToXml()
  $d = @{}
  foreach ($n in $x.Event.EventData.Data) { $d[$n.Name] = [string]$n.'#text' }
  if ($d['Application'] -notmatch '\\nullpath\.exe$') { continue }
  if ($d['Direction'] -ne '%%14593') { continue }
  $dest = Strip $d['DestAddress']
  if ($dest -match '^127\.' -or $dest -eq '::1') { continue }
  $conns += [pscustomobject]@{ time = $e.TimeCreated.ToString('o'); event = $e.Id; pid = $d['ProcessID']; dest = $dest; port = $d['DestPort']; protocol = $d['Protocol'] }
}

# Canary names in DNS: the DNS client log (any process) and the port-53 capture.
$dnsEvents = @(Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-DNS-Client/Operational'; StartTime = $start } -ErrorAction SilentlyContinue)
$pcapText = ''
if (Test-Path $pcap) { $pcapText = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($pcap)) }
$hits = @()
foreach ($c in $Canary) {
  foreach ($e in $dnsEvents) {
    if ($e.Message -match [regex]::Escape($c)) { $hits += [pscustomobject]@{ source = 'dns-client-log'; canary = $c; time = $e.TimeCreated.ToString('o'); id = $e.Id } }
  }
  if ($pcapText.Contains($c)) { $hits += [pscustomobject]@{ source = 'pcap'; canary = $c } }
}

# Addresses DNS returned for the setup download hosts (Expect setup only).
$allowed = @{}
foreach ($e in $dnsEvents) {
  if ($e.Id -ne 3008) { continue }
  foreach ($h in $setupHosts) {
    if ($e.Message -notmatch ('name ' + [regex]::Escape($h) + ',')) { continue }
    $res = ($e.Message -split 'Results', 2)[1]
    if (-not $res) { continue }
    foreach ($tok in ($res -split '[;\s]+')) {
      $ip = $null
      if ([Net.IPAddress]::TryParse((Strip $tok), [ref]$ip)) { $allowed[$ip.ToString()] = $h }
    }
  }
}

switch ($Expect) {
  'none' { $violations = @($conns); $pass = ($conns.Count -eq 0 -and $hits.Count -eq 0) }
  'setup' {
    $violations = @($conns | Where-Object { -not $allowed.ContainsKey($_.dest) -or $_.port -ne '443' })
    $pass = ($violations.Count -eq 0 -and $hits.Count -eq 0 -and $allowed.Count -gt 0 -and $conns.Count -gt 0)
  }
  'control' { $violations = @(); $pass = ($conns.Count -gt 0 -and $hits.Count -gt 0) }
}

[pscustomobject]@{
  scenario = $Scenario; expect = $Expect; start = $start.ToString('o'); stop = $stop.ToString('o')
  canaries = $Canary; nullpathOffboxConnections = $conns; canaryHits = $hits
  allowedSetupAddresses = @($allowed.Keys); violations = $violations; pass = $pass
} | ConvertTo-Json -Depth 5 | Out-File -Encoding utf8 $resultFile
Write-Output ("{0}: {1}" -f $Scenario, $(if ($pass) { 'PASS' } else { 'FAIL' }))
Write-Output "Result: $resultFile"
```

**`scripts/verify/reset-state.ps1`**

```powershell
<#
Returns this machine to a fresh Nullpath install (PRODUCTION-READINESS-HANDOFF.md §5).
Elevated Windows PowerShell 5.1.
  -Installer   the installer .exe to install afterwards
  -KeepRouter  keep the managed router (its folder and router.json), drop everything else
#>
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [switch]$KeepRouter,
  [string]$InstallDir = 'C:\Program Files\Nullpath'
)
$ErrorActionPreference = 'Stop'
Get-Process nullpath, i2pd -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
$helper = Join-Path $InstallDir 'uninstall\helper.exe'
if (Test-Path $helper) {
  Start-Process $helper -ArgumentList '/S' -Wait
  $deadline = (Get-Date).AddSeconds(120)
  while ((Test-Path (Join-Path $InstallDir 'nullpath.exe')) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
  if (Test-Path (Join-Path $InstallDir 'nullpath.exe')) { throw 'Uninstall did not finish within 120 s.' }
}
$roaming = Join-Path $env:APPDATA 'nullpath'
$local = Join-Path $env:LOCALAPPDATA 'nullpath'
if ($KeepRouter) {
  if (Test-Path $roaming) {
    Get-ChildItem $roaming -Force | Where-Object { $_.Name -ne 'i2p' } | Remove-Item -Recurse -Force
    foreach ($f in 'profiles.json', 'state.json') { Remove-Item (Join-Path $roaming "i2p\$f") -Force -ErrorAction SilentlyContinue }
  }
  if (Test-Path $local) { Get-ChildItem $local -Force | Where-Object { $_.Name -ne 'i2p-router' } | Remove-Item -Recurse -Force }
} else {
  foreach ($p in $roaming, $local) { if (Test-Path $p) { Remove-Item $p -Recurse -Force } }
}
Start-Process $Installer -ArgumentList '/S', "/InstallDirectoryPath=$InstallDir" -Wait
if (-not (Test-Path (Join-Path $InstallDir 'nullpath.exe'))) { throw 'Install failed.' }
Write-Output "Fresh install ready in $InstallDir (KeepRouter=$KeepRouter)."
```

**`scripts/verify/testsite.py`**

```python
"""Nullpath release verification site (PRODUCTION-READINESS-HANDOFF.md V3, V4).

Serves test pages on 127.0.0.1 for an i2pd server tunnel. Every public-web
request these pages make goes to a host containing the canary, so a leak
shows up as a DNS query for the canary.

    python testsite.py --port 18080 --canary npc0123456789ab
"""
import argparse
import http.server

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=18080)
ap.add_argument("--canary", required=True)
args = ap.parse_args()
C = args.canary

PAGES = {
    "/": f"""<!doctype html><title>Nullpath verify</title><ul>
<li><a href="/leaks">leaks</a><li><a href="/sw">service worker</a>
<li><a href="/redirect">redirect to public web</a><li><a href="/meta-refresh">meta refresh</a>
<li><a href="/post">top-level POST</a><li><a href="/popup">popup</a>
<li><a href="/download">download (I2P)</a><li><a href="http://{C}-dl.example/file.bin">download (public)</a>
<li><a href="/headers">headers</a><li><a href="/fp">fingerprint</a></ul>""",
    "/leaks": f"""<!doctype html><title>leaks</title>
<link rel="dns-prefetch" href="//{C}-dnsp.example"><link rel="preconnect" href="https://{C}-prec.example">
<link rel="prefetch" href="https://{C}-pref.example/x"><link rel="stylesheet" href="https://{C}-css.example/x.css">
<style>@font-face{{font-family:f;src:url(https://{C}-font.example/f.woff2)}}body{{font-family:f}}</style>
<img src="http://{C}-img.example/x.png"><iframe src="https://{C}-frame.example/"></iframe>
<script src="https://{C}-js.example/x.js"></script>
<p>loaded</p><script>
fetch("https://{C}-fetch.example/").catch(()=>{{}});
navigator.sendBeacon("https://{C}-beacon.example/", "x");
try{{new WebSocket("wss://{C}-ws.example/")}}catch(e){{}}
try{{new WebSocket("ws://{C}-ws2.example/")}}catch(e){{}}
try{{new EventSource("https://{C}-es.example/")}}catch(e){{}}
try{{let pc=new RTCPeerConnection({{iceServers:[{{urls:"stun:{C}-stun.example:3478"}},{{urls:"turn:{C}-turn.example:3478",username:"u",credential:"p"}}]}});pc.createDataChannel("d");pc.createOffer().then(o=>pc.setLocalDescription(o));}}catch(e){{document.body.append(" webrtc:"+e.name)}}
</script>""",
    "/sw": """<!doctype html><title>sw</title><p id=s>registering</p><script>
navigator.serviceWorker.register("/sw.js").then(()=>s.textContent="registered",e=>s.textContent="failed: "+e);
</script>""",
    "/sw.js": f"""self.addEventListener("install",e=>e.waitUntil(fetch("https://{C}-sw.example/").catch(()=>{{}})));
self.addEventListener("activate",e=>e.waitUntil(fetch("https://{C}-sw2.example/").catch(()=>{{}})));""",
    "/meta-refresh": f"""<!doctype html><meta http-equiv="refresh" content="0;url=http://{C}-meta.example/">""",
    "/post": f"""<!doctype html><form id=f method=post action="http://{C}-post.example/"><input name=a value=b></form>
<script>f.submit()</script>""",
    "/popup": f"""<!doctype html><button id=b onclick="window.open('http://{C}-popup.example/')">open</button>""",
    "/fp": """<!doctype html><title>fp</title><pre id=o></pre><script>
o.textContent=JSON.stringify({ua:navigator.userAgent,languages:navigator.languages,platform:navigator.platform,
tz:Intl.DateTimeFormat().resolvedOptions().timeZone,tzOffset:new Date().getTimezoneOffset(),
webdriver:navigator.webdriver},null,1);</script>""",
}


class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="text/html; charset=utf-8", extra=()):
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        for k, v in extra:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/headers":
            lines = [self.requestline] + [f"{k}: {v}" for k, v in self.headers.items()]
            return self._send(200, "\n".join(lines) + "\n", "text/plain; charset=utf-8")
        if path == "/redirect":
            return self._send(302, "", extra=[("Location", f"http://{C}-redir.example/")])
        if path == "/download":
            return self._send(200, "nullpath verify file\n", "application/octet-stream",
                              [("Content-Disposition", 'attachment; filename="verify.bin"')])
        if path == "/sw.js":
            return self._send(200, PAGES[path], "text/javascript")
        if path in PAGES:
            return self._send(200, PAGES[path])
        return self._send(404, "not found")

    def log_message(self, fmt, *a):
        print(self.address_string(), fmt % a, flush=True)


http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
```

**`scripts/verify/proxy-direct/manifest.json`**

```json
{
  "manifest_version": 2,
  "name": "Nullpath verify: proxy direct",
  "version": "1.0",
  "browser_specific_settings": { "gecko": { "id": "proxy-direct@nullpath.invalid" } },
  "permissions": ["proxy", "<all_urls>"],
  "background": { "scripts": ["background.js"] }
}
```

**`scripts/verify/proxy-direct/background.js`**

```js
// Tries to send every request direct, around the I2P proxy (V3 S6).
browser.proxy.onRequest.addListener(() => ({ type: "direct" }), { urls: ["<all_urls>"] });
```

Canary format, used everywhere: `npc` + 12 lowercase hex characters, new for
each scenario:
`"npc" + [guid]::NewGuid().ToString('N').Substring(0,12)`.

### W13. Documentation

1. **`SECURITY.md`** at the repository root, with exactly this content:

```markdown
# Security policy

## Reporting a vulnerability

Report security problems privately through GitHub:
https://github.com/Kayyo321/nullpath/security/advisories/new

Don't open a public issue for a security problem. We acknowledge reports
within 7 days.

## Supported versions

Only the latest release is supported.

## Security releases

Nullpath is based on Firefox through LibreWolf. When Mozilla publishes a
Firefox security release, Nullpath publishes a matching release within 7 days.
Nullpath doesn't update itself. Watch the releases page
(https://github.com/Kayyo321/nullpath/releases) and install each new release.

## Verifying downloads

Each release has a `SHA256SUMS` file and a detached signature
`SHA256SUMS.asc`, made with the Nullpath release key:

    <RELEASE KEY FINGERPRINT>

    gpg --verify SHA256SUMS.asc SHA256SUMS
    sha256sum -c SHA256SUMS

The installer and the programs inside it are Authenticode-signed.

## Scope

See docs/nullpath/THREAT-MODEL.md for what Nullpath does and doesn't protect
against.
```

   `<RELEASE KEY FINGERPRINT>` is filled in by the owner in O2. It stays a
   literal placeholder until then, and G16 fails while it does.

2. **`docs/nullpath/THREAT-MODEL.md`** with these sections and statements
   (wording exactly as here):

```markdown
# Nullpath threat model

## Protects against (when an I2P mode is used as designed)

- A website in an I2P profile learning the user's IP address from browser traffic.
- Browser traffic in an I2P profile leaving the computer outside the I2P
  proxy, including when the router or outproxy fails (fail-closed).
- Websites in one Nullpath profile reading cookies, storage, history, cache,
  logins or permissions from another Nullpath profile.
- Web pages, extensions and remote sites changing router configuration.

## Doesn't protect against

- Traffic from other applications on the computer.
- The user's internet provider or network seeing that the computer runs I2P.
- The outproxy operator (Public web via I2P) seeing the sites visited and
  unencrypted content.
- I2P sites linking visits within one router session (they see the same I2P
  client address until the router restarts).
- Malware on the computer, or anyone with access to the user's Windows account.
- Attacks on the I2P network itself.
- Identification by what the user types or logs in to.

## Trust

Nullpath trusts: Mozilla's Firefox source, LibreWolf's patches, the i2pd
release it pins (SHA-256 checked), the user's chosen outproxy for Public web
traffic, and GitHub for the i2pd download.

## Verification

Network-level test results for each release are in
docs/nullpath/release-evidence/<version>/.
```

3. **`README.nullpath.md`**: replace the whole second paragraph (the one
   starting "This fork is currently a development build") with:

```markdown
Nullpath for Windows routes its I2P profiles through an I2P router you choose (your own, or one it sets up for you) and blocks their traffic when the router isn't connected. Read [the threat model](docs/nullpath/THREAT-MODEL.md) and the [network paths](docs/nullpath/NETWORK.md) before relying on it. Nullpath doesn't make you anonymous by itself. It doesn't update itself: see [SECURITY.md](SECURITY.md). Releases and issues: https://github.com/Kayyo321/nullpath.

**Uninstalling:** uninstall Nullpath from Windows Settings. If you used **Set up I2P for me**, the uninstaller also stops and deletes the I2P router Nullpath installed, including its identity and address book. It only does this for the Windows account that runs the uninstaller: other accounts should choose **Remove Nullpath's router** (router panel › Settings › Manage) first. A router you installed yourself is never touched.
```

   Add a line under the heading, after the first paragraph:
   `Release signing key: <RELEASE KEY FINGERPRINT>` (filled in by O2).
4. **`docs/nullpath/NETWORK.md`**: append a `## Limitations` section whose
   bullets are the six `nullpath-network-limit-*` strings from W4 with
   `{ -brand-short-name }` replaced by `Nullpath`.
5. **`docs/nullpath/I2P-ROUTER-TOGGLE.md`**: in §5.6, replace the last two
   sentences ("The Nullpath uninstaller … packaging work.") with
   `The Nullpath uninstaller also removes the managed router for the Windows account that runs it: it stops the i2pd.exe inside %LOCALAPPDATA%\nullpath\i2p-router\ and deletes that folder, with no prompt. A user's own router is never touched. If Nullpath is installed again, it forgets the removed managed setup at startup (PRODUCTION-READINESS-HANDOFF.md D3, W16).`
   §15 is rewritten at the end, in §7 step 3.
6. **`docs/nullpath/SECURITY-REVIEW-SCOPE.md`** (the brief for O3), listing
   these in-scope items: `NP/network/*` (request blocker, channel filter,
   profile mode and locked prefs), `NP/actors/*` and `NP/content/blocked.*`
   (the only content→parent channel), `NP/router/NullpathManagedRouter.sys.mjs`
   (download, hash check, extraction, process launch, config writing),
   `NP/router/NullpathLoopback.sys.mjs`, `NP/router/NullpathProcess.sys.mjs`,
   `nullpath/patches/*.patch`, `nullpath/settings/nullpath-overrides.cfg`,
   `scripts/nullpath-overlay.py`, and the V3 evidence. The requested
   deliverable is a written report, with each finding rated Critical, High,
   Medium or Low.

### W14. Profile launch correctness

**Background:** on 2026-09-23, `nullpath.exe -P nullpath-router-test` opened
the profile `nz22zt5s.default` instead. Launching into the right profile
matters most for the no-argument launch: launching into Direct web by
default would mean ordinary internet traffic at every start.

1. **Reproduce** (installed build, §1.2 launch, `reset-state.ps1` without
   `-KeepRouter` first):
   1. Launch Nullpath with no arguments. Wait for the window. Quit.
   2. Launch again. In each window of each mode you open, record
      `about:support` → "Profile Directory" and the mode chip text.
   3. Run `& "C:\Program Files\Nullpath\nullpath.exe" -CreateProfile np-ptest`,
      then launch `-P np-ptest -no-remote` (through `explorer.exe` as in
      §1.2, passing the arguments). Record the profile directory.
   4. Launch `-P "Nullpath: Direct web" -no-remote` and record the same.
   Save all of this in `release-evidence/<VER>/profiles/reproduction.md`.
2. **Acceptance criteria** (all must hold; record 10 attempts each in
   `release-evidence/<VER>/profiles/acceptance.md`):
   - A. A no-argument launch, with no Nullpath running, opens the **I2P
     sites** profile 10/10 times. Before 5 of those launches, the last window
     closed must have been a Public web or Direct web window.
   - B. In every window, the mode chip matches the `nullpath.mode` value in
     that profile's `prefs.js`/`user.js` (or is I2P sites when there is none),
     and the profile's path matches `%APPDATA%\nullpath\i2p\profiles.json`
     for that mode.
   - C. `-P np-ptest -no-remote` opens `np-ptest` 10/10 times.
3. **Diagnosis, if A or C fails:** read
   `librewolf-156.0.1-1/toolkit/profile/nsToolkitProfileService.cpp`
   (`SelectStartupProfile` and everything it calls about `StoreID` and
   profile groups) and `NullpathProfileMode.#pinLaunchProfile`. Write the root
   cause in `release-evidence/<VER>/profiles/root-cause.md`, citing file and
   line.
4. **Fix rules:**
   - If the cause is in Nullpath code, fix it there. It must be the smallest
     change that satisfies A–C.
   - If the cause is upstream Firefox behaviour for `-P` and profile groups,
     **don't patch Firefox**. Criterion C is then replaced by C′: README gains
     the sentence `Open other modes from the router panel or the profiles menu, not with -P.`
     A and B still must hold.
   - If A fails for any reason, G6 fails until it's fixed. There is no waiver
     for A.

### W15. Firefox base is current

1. Run
   `curl -sSf https://product-details.mozilla.org/1.0/firefox_versions.json`
   and read `LATEST_FIREFOX_VERSION`. Save the JSON to
   `release-evidence/<VER>/base/firefox_versions.json`.
2. If it equals the contents of `version` (`156.0.1`): G2 PASS.
3. If it's newer, the release must be rebased on the matching LibreWolf
   release following `docs/nullpath/REBRAND-HANDOFF.md` §16. That's a
   separate project: G2 is FAIL for this run. Record the version found.

---

### W16. Uninstaller removes the Nullpath-installed router (D3)

**1. The uninstaller.** Make `nullpath/patches/nullpath-uninstall-router.patch`
(§1.3) editing `browser/installer/windows/nsis/uninstaller.nsi`. In
`Section "Uninstall"`, find the block that deletes the main executable. It
starts with `ClearErrors` / `${DeleteFile} "$INSTDIR\${FileMainEXE}"` and
ends with `${EndIf}`, directly before the line
`ReadRegDWORD $R4 HKCU "Software\Mozilla\${BrandFullNameInternal}" DesktopLauncherAppInstalled`.
Insert this block directly after that `${EndIf}` and before the
`ReadRegDWORD` line, followed by one empty line:

```nsis
  ; Nullpath: remove the I2P router that guided setup installed for this
  ; Windows account (docs/nullpath/PRODUCTION-READINESS-HANDOFF.md D3). Only
  ; i2pd.exe processes running from that folder are stopped; a router the
  ; user installed themselves is never touched.
  SetShellVarContext current
  ${If} ${FileExists} "$LOCALAPPDATA\nullpath\i2p-router\i2pd.conf"
    nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name='i2pd.exe'\" | Where-Object { $$_.ExecutablePath -like '$LOCALAPPDATA\nullpath\i2p-router\*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }"`
    Pop $0
    Sleep 2000
    RmDir /r /REBOOTOK "$LOCALAPPDATA\nullpath\i2p-router"
  ${EndIf}
  ClearErrors
```

Notes that are part of the specification:
- `$$` is NSIS's escape for a literal `$`, so PowerShell receives `$_`.
  `$LOCALAPPDATA` and `$SYSDIR` are NSIS variables and are expanded by NSIS.
- The block runs after the main executable is deleted, so Nullpath can't be
  started again and restart the router mid-uninstall.
- The next existing line after this block sets its own shell context
  (`SetShellVarContext current` at `${un.RegCleanMain}`). Don't add or change
  any other `SetShellVarContext` call.
- Don't touch `%APPDATA%\nullpath\i2p\router.json`. Step 2 handles the stale
  `managed` block in it.

Append `patches/nullpath-uninstall-router.patch` to `nullpath/patches.txt`.
It needs `build`, and then `package` to rebuild the installer.

**2. Forget a removed managed router at startup.** In
`NP/router/NullpathManagedRouter.sys.mjs`, add this method to the
`ManagedRouter` class directly after `remove()`:

```js
  /**
   * The uninstaller deletes the managed router's folder (D3 in
   * PRODUCTION-READINESS-HANDOFF.md). If Nullpath is installed again, forget
   * that setup, as remove() does, instead of reporting a missing router.
   * A folder that exists without i2pd.exe (antivirus quarantine) is kept
   * and still reported.
   *
   * @returns {Promise<boolean>} true when the config was changed.
   */
  async forgetIfRemoved() {
    let c = lazy.NullpathRouterConfig.config;
    if (!c.managed || (await IOUtils.exists(this.dir))) {
      return false;
    }
    await lazy.NullpathRouterConfig.update(cfg => {
      cfg.managed = null;
      if (cfg.setup == "managed") {
        cfg.setup = cfg.external ? "external" : null;
      }
    });
    return true;
  }
```

In `NP/router/NullpathRouter.sys.mjs`, `init()`, directly after the line
`let config = await lazy.NullpathRouterConfig.load();`, insert:

```js
    if (await lazy.NullpathManagedRouter.forgetIfRemoved()) {
      config = lazy.NullpathRouterConfig.config;
    }
```

If `NullpathRouter.sys.mjs` doesn't already declare `NullpathManagedRouter`
in its `declareLazy` block, the item is BLOCKED (rule 4). It does as of
2026-09-23: `#routerExited` uses `lazy.NullpathManagedRouter`.

**3. Tests:** W10 items X4 and B6. Manual: V6 steps 9–12. W10 lists X4 and
B6, but they test W16's code, so write them as part of W16's commit if W10 is
already committed.

## 4. Build, test and package

1. Run `test` (W9). Copy `build-logs/test-xpcshell.log` and
   `build-logs/test-browser.log` to `release-evidence/<VER>/tests/`. **G3**
   passes when both logs show zero failures, the xpcshell log shows every file
   in `xpcshell.toml` ran, and the browser log shows every file in
   `browser.toml` plus the customkeys tests ran.
2. Clean release build: `prepare`, then `build package`. This proves the
   patch series (now including W5, W7 and W16) applies from scratch. Save the last
   200 lines of the build output to `release-evidence/<VER>/build/build.log`.
   It must end with a successful package listing.
3. If O1 is available: `sign`, `sign-installer`. If O2 is available:
   `checksums`. Otherwise skip. G15 and G16 then fail.
4. The installer used for §5 is `nullpath-*.installer.signed.exe` if step 3
   ran, otherwise the unsigned `nullpath-*.installer.exe`.

---

## 5. Verification (V items)

Run §5 on the owner's Windows 11 machine, from an ordinary elevated Windows
PowerShell (not the Claude desktop app, §1.2). Store raw captures in
`D:\nullpath\verify\` (never committed). Copy `*.result.json` files and the
checklists into `release-evidence/<VER>/`.

If you can't open an elevated PowerShell yourself, give the owner the exact
commands for each step and wait for the outputs. Don't substitute
unelevated alternatives.

### V1. i2pd pin provenance

1. `curl -sSf https://api.github.com/repos/PurpleI2P/i2pd/releases/tags/2.61.0 -o i2pd-release.json`.
2. Download the asset `i2pd_2.61.0_win64_mingw.zip` from
   `NULLPATH_I2PD_URL` and compute its SHA-256 and size.
3. **Pass condition (all):** the SHA-256 equals `NULLPATH_I2PD_SHA256`; the
   size equals `NULLPATH_I2PD_SIZE_BYTES`; and one of the following holds:
   - **(a)** the release has a checksum file (an asset whose name contains
     `SUMS` or ends in `.sha256`/`.sha512`) **and** a signature for it
     (`.asc`/`.sig`). The signature verifies with a key obtained from the
     i2pd project (repository `contrib/` or https://i2pd.website), the
     checksum file lists this zip, and its hash matches. Record the key
     fingerprint.
   - **(b)** no signed checksum exists. Then `author.login` in
     `i2pd-release.json` is one of the accounts listed as members of the
     `PurpleI2P` GitHub organisation
     (`curl -sSf https://api.github.com/orgs/PurpleI2P/public_members`), and
     the file's SHA-256 equals the API's `digest` for that asset. Record the
     sentence "No maintainer signature is published for this release."
4. Evidence: `release-evidence/<VER>/i2pd/provenance.md` with every value and
   command output. Update the comment in `NullpathRouterManifest.sys.mjs`
   ("Provenance of the current pin") to state which of (a) or (b) applied and
   the date.

### V2. Real-program checks

Install on this machine:
- the current Java I2P release for Windows from https://geti2p.net/en/download.
  Verify the download against the SHA-256 or signature published on that page,
  and record the version.
- i2pd comes from Nullpath's guided setup (V3 S2 installs it).

1. **Detection signatures (§4.2):** with Java I2P running on its defaults, run
   `curl -s -i -x http://127.0.0.1:4444 http://nullpath-probe.invalid.i2p/`
   and save the full response to
   `NP/tests/xpcshell/data/java-i2p-probe.txt`. With the managed i2pd running,
   do the same through its sites proxy port (`router.json` →
   `managed.ports.sites`) into `…/data/i2pd-probe.txt`. Compare with what
   `NullpathRouterDetect.sys.mjs` matches on. If it wouldn't match either
   response, change only the matching constants so it does. Add a task to
   `test_detect.js` that feeds both saved responses through the identifying
   function and expects Java I2P and i2pd respectively. Add `support-files = ["data/*"]`
   to `xpcshell.toml` `[DEFAULT]`.
2. **Java I2P config paths:** list which of `%LOCALAPPDATA%\I2P` and
   `%APPDATA%\I2P` contains `i2ptunnel.config.d`. If the code doesn't check
   the path that exists, add it. Record the listing.
3. **i2pd console commands:** fetch
   `https://raw.githubusercontent.com/PurpleI2P/i2pd/2.61.0/daemon/HTTPServer.cpp`
   and list every `HTTP_COMMAND_*` constant and its string. Each command string
   `NullpathManagedRouter.sys.mjs` sends (`terminate`, `enable_transit`,
   `disable_transit`, `reload_tunnels_config`) must appear there. Also record
   how the console expects the command's token parameter, and check that the
   code sends it that way. Fix mismatches in the command strings or token
   handling only.
4. Evidence: `release-evidence/<VER>/router-programs.md`. Any code change is a
   `V2:` commit and needs G3 re-run.

### V3. Network leak checks

The scenarios map to I2P-ROUTER-TOGGLE.md §12 checks 1–7. Before each
scenario: pick a new canary (W12) and run `reset-state.ps1` as stated. Then
`leakcheck.ps1 -Action start`, the steps, and `leakcheck.ps1 -Action stop`
with the canary and `-Expect` value given. Start `testsite.py` (S3–S6) from
a separate normal PowerShell with the scenario's canary.

**Test site setup (once, after S2 has installed the managed router):** add
to the end of `%LOCALAPPDATA%\nullpath\i2p-router\tunnels.conf`:

```
[nullpath-verify-site]
type = http
host = 127.0.0.1
port = 18080
keys = nullpath-verify-site.dat

[nullpath-verify-site2]
type = http
host = 127.0.0.1
port = 18081
keys = nullpath-verify-site2.dat
```

Restart the router (panel switch off, then on). Read the two server tunnels'
`.b32.i2p` addresses on the router console's "I2P tunnels" page (panel →
Router console). Record them as `SITE` and `SITE2`. `-KeepRouter` keeps
these sections for later scenarios. Remove both sections when §5 is
finished.

| Id | §12 | Reset | Expect | Steps |
|---|---|---|---|---|
| S0 | 7 | full | control | Launch. In the router panel, open a **Direct web** window. There, load `https://<canary>-control.example/` and `https://example.com/`. Wait 10 s. |
| S1 | 1 | full | none | Start the capture **before** launching. Launch. Wait 300 s without touching anything. Open Settings, the About dialog and the router panel. In the I2P sites window, type `http://<canary>-typed.example/` and `http://<canary>.i2p/` into the address bar and press Enter each time. Wait 10 s. |
| S2 | 2 | full | setup | Launch. Router panel → **Set up I2P for me** → continue until the download starts. While it downloads, load `http://<canary>-setup.example/` in the I2P sites window 5 times. Wait until the panel shows Connecting or Connected. Wait 10 s. |
| S3 | 3 | KeepRouter | none | Launch, connect and wait for Connected. Visit `http://SITE/leaks`, `/sw`, `/redirect`, `/meta-refresh`, `/post`, `/popup` (click the button), `/download` (accept the download), and the "download (public)" link. Type `http://<canary>-typed.example/` and `http://<canary>.i2p/`. Wait 30 s. |
| S4a | 4 | KeepRouter | none | Connect. Open `http://SITE/leaks` in 3 tabs. Run `Stop-Process -Name i2pd -Force`. Reload all 3 tabs, and type `http://<canary>-typed.example/`. Wait 30 s. |
| S4b | 4 | KeepRouter | none | Panel → Settings → Use my own I2P router, HTTP proxy `127.0.0.1:1`, Save and connect. Load `http://<canary>.i2p/` and `http://<canary>-typed.example/`. Wait 30 s. |
| S4c | 4 | KeepRouter | none | Start Java I2P. Panel → Use my own I2P router with its detected endpoint, and connect. Load `http://<canary>.i2p/`. Shut Java I2P down (its console → Shutdown immediately). Reload, and type `http://<canary>-typed.example/`. Wait 30 s. |
| S5a | 5 | KeepRouter | none | Managed router connected. Panel → Outproxy: enter `exit.stormycloud.i2p`, acknowledge, and test until it reports reachable. Open a **Public web via I2P** window and load `https://<canary>-pw.example/` and `https://example.com/`. From the I2P sites window, type `https://example.org/` (must hand off to a Public web window). Wait 30 s. |
| S5b | 5 | KeepRouter | none | Set the outproxy to `<canary>-dead.i2p` and test it (must report unreachable). In the Public web window, load `https://<canary>-pw2.example/` (must show **Outproxy unavailable**). From the I2P sites window, type `https://example.org/` (must show **Can't open this site through I2P**). Wait 30 s. |
| S6 | 6 | KeepRouter | none | Connect. `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `scripts\verify\proxy-direct\manifest.json`. Load `http://SITE/leaks` and `http://<canary>-typed.example/`. Wait 30 s. |

Extra rules:
- **S0 runs first.** If S0 isn't PASS, the tooling is broken: stop V3, fix
  the tooling, and re-run S0. Changing `leakcheck.ps1` is allowed only to fix
  a parsing error, and each change is recorded in `NOTES.md`.
- **S6 decision tree:** if about:debugging refuses to load the temporary
  add-on, record the exact message and a screenshot. S6 is then PASS with the
  note "extension can't be loaded in I2P profiles", provided the xpcshell test
  `test_channel_filter.js` passed in G3.
- For each scenario, also record in `release-evidence/<VER>/network/<Id>.md`
  what each page showed (for example "Not connected page", "Outproxy
  unavailable page", "handed off"). The visible outcomes named in the table
  are part of the pass condition.
- **Any FAIL:** fix the cause in Nullpath code (`V3:` commit), re-run G3, then
  re-run **all** scenarios, S0 to S6.

Evidence: `release-evidence/<VER>/network/<Id>.result.json` and
`<Id>.md` for every Id, plus `network/README.md` with a table of
Id → PASS/FAIL. **G7** passes when every row is PASS.

### V4. I2P identity and fingerprint

Use the test site from V3 (router connected, KeepRouter state).

1. In an I2P sites window, open `http://SITE/headers`. Record
   `X-I2P-DestB32` as `A1`. Open `http://SITE2/headers` and record `A2`.
2. Turn the router off, then on. Wait for Connected. Open `http://SITE/headers`
   and record `A3`.
3. In a Public web via I2P window (outproxy from S5a configured), open
   `http://SITE/headers` and record `P1`.
4. List `%LOCALAPPDATA%\nullpath\i2p-router\data\`.
5. **Identity pass condition (all):** `A1 == A2` (expected; this is the
   disclosed limitation); `A3 != A1`; `P1 != A1` and `P1 != A3`; no file named
   `nullpath-sites.dat`, `nullpath-publicweb.dat`, or starting with
   `transient` exists in `data\`.
6. **Fallback (only if step 5 fails because a `transient*` file exists or
   `A3 == A1`):**
   1. `buildI2pdConf` writes **no** `keys` line in `[httpproxy]` (i2pd's
      default for the HTTP proxy is transient). `buildTunnelsConf` writes
      `keys = transient`.
   2. Add this export next to `setConfKey`:

      ```js
      /** Removes `key = …` from [section] ("" for the top level). */
      export function removeConfKey(text, section, key) {
        let current = "";
        let re = new RegExp(`^\\s*${key}\\s*=`);
        return text
          .split("\n")
          .filter(line => {
            let m = /^\s*\[([^\]]+)\]\s*$/.exec(line);
            if (m) {
              current = m[1];
              return true;
            }
            return !(current == section && re.test(line));
          })
          .join("\n");
      }
      ```

   3. Replace `migrateTransientKeys`'s body so that it removes the
      `[httpproxy]` `keys` line (with `removeConfKey`) when the value is
      `nullpath-sites.dat` or `transient-nullpath-sites`, and sets the
      `[nullpath-publicweb]` `keys` to `transient` (with `setConfKey`) when
      the value is `nullpath-publicweb.dat` or `transient-nullpath-publicweb`.
      Any other value is left alone. `#migrateKeys()` also deletes any file in
      `data\` whose name starts with `transient`.
   4. Update X1/X2 to these values. Commit as `V4: transient keys fallback`,
      re-run G3, and repeat V4 from step 1. If it still fails, G4 is FAIL.
7. **Headers pass condition (all):** the `/headers` output from step 1 has no
   header name or value containing `Nullpath` or `LibreWolf`
   (case-insensitive); `User-Agent` contains `Windows NT 10.0; Win64; x64`
   and `Firefox/`; `Accept-Language` starts with `en-US,en`.
8. **Fingerprint pass condition (all):** `http://SITE/fp` shows `ua` equal to
   the `User-Agent` header from step 1; `languages` equal to `["en-US","en"]`;
   `tzOffset` equal to 0; `tz` either `UTC` or `Atlantic/Reykjavik`; and
   `about:config` shows `privacy.resistFingerprinting` as locked `true`.
9. Evidence: `release-evidence/<VER>/identity.md` with A1–A3, P1, the
   directory listing, both `/headers` outputs and the `/fp` output. **G4** is
   steps 5–6. **G8** is steps 7–8.

### V5. addresshelper

1. On the router console, read `SITE`'s full Base64 destination as `B64_1`
   and `SITE2`'s as `B64_2`.
2. In an I2P sites window, open
   `http://npc-helper-test.i2p/?i2paddresshelper=<B64_1>`. Record exactly what
   happens.
3. Then open `http://npc-helper-test.i2p/?i2paddresshelper=<B64_2>`. Record
   exactly what happens.
4. **Pass condition:** step 2 shows an i2pd page that requires a click
   before the name is added (or is used); **and** step 3 shows a page warning
   that the name already points to a different destination, without
   switching silently.
5. **If it doesn't pass:** in `buildI2pdConf`, change `addresshelper = true`
   to `addresshelper = false`. Add an exported `migrateAddressHelper(i2pdConf)`
   that uses `setConfKey(text, "httpproxy", "addresshelper", "false")` only
   when that section's line is exactly `addresshelper = true`, and call it
   from `#migrateKeys()` (writing the file when it changes). Add an X2-style
   test in `test_managed_conf.js` with the same three cases (old value
   migrated, user value kept, already migrated unchanged). Re-run G3 and
   repeat V5. It then passes when step 2 no longer adds or uses the name.
6. Evidence: `release-evidence/<VER>/addresshelper.md`. **G5**.

### V6. Installer and uninstaller

From an elevated PowerShell, with no Nullpath installed:

1. `reg export HKCU\Software D:\nullpath\verify\reg\before-hkcu.reg /y` and
   `reg export HKLM\SOFTWARE D:\nullpath\verify\reg\before-hklm.reg /y`.
   Save `Get-ItemProperty HKLM:\SOFTWARE\RegisteredApplications` as
   `before-regapps.txt`.
2. Silent install:
   `Start-Process <installer> -ArgumentList '/S','/InstallDirectoryPath=C:\Program Files\Nullpath' -Wait`.
   Export the registry again as `after-install-*.reg`.
3. Launch (§1.2). Open the About dialog and record the version shown.
4. Uninstall: `Start-Process 'C:\Program Files\Nullpath\uninstall\helper.exe' -ArgumentList '/S' -Wait`,
   wait until `nullpath.exe` is gone (maximum 120 s), then export
   `after-uninstall-*.reg` and `after-regapps.txt`.
5. Create `D:\npinst-test\keep.txt`. Install with
   `/InstallDirectoryPath=D:\npinst-test`, then uninstall with that folder's
   `uninstall\helper.exe /S`.
6. Diff with `Compare-Object (Get-Content before) (Get-Content after)`.
7. **Pass condition (all):** step 2 creates `C:\Program Files\Nullpath\nullpath.exe`;
   no line added by the install (step 2 diff) contains `Firefox` or
   `LibreWolf` (case-insensitive); step 3 shows `156.0.1-1`; after step 4,
   every added line under `HKEY_LOCAL_MACHINE` is gone again, and every HKCU
   leftover has `Nullpath` in its key path; `after-regapps.txt` contains every
   value in `before-regapps.txt`; `D:\npinst-test\keep.txt` still exists after
   step 5.
8. If the installer is signed (O1): `Get-AuthenticodeSignature` on the
   installer, `C:\Program Files\Nullpath\nullpath.exe` and
   `…\uninstall\helper.exe` (run between steps 2 and 4) all report `Valid`.
   Record it for G15.
9. **Router removal setup:**
   1. Run `reset-state.ps1 -Installer <installer>` (full reset) and launch
      (§1.2).
   2. In the router panel, choose **Set up I2P for me**, finish setup and
      wait for Connected. In Settings › Manage, turn on **Keep the router
      running when Nullpath is disconnected**. Quit Nullpath.
   3. Set up a user-owned router that the uninstaller must not touch:
      create `D:\npown`, copy
      `%LOCALAPPDATA%\nullpath\i2p-router\bin\i2pd.exe` to `D:\npown\i2pd.exe`,
      and start it with
      `Start-Process D:\npown\i2pd.exe -ArgumentList '--datadir=D:\npown\data','--httpproxy.port=24444','--http.port=27070','--port=29999','--socksproxy.enabled=false','--sam.enabled=false','--bob.enabled=false','--i2cp.enabled=false','--i2pcontrol.enabled=false'`.
      If Java I2P from V2 is installed, start it too.
   4. Record the output of
      `Get-CimInstance Win32_Process -Filter "Name='i2pd.exe'" | Select-Object ProcessId, ExecutablePath`.
      It must list one process under `%LOCALAPPDATA%\nullpath\i2p-router\`
      and one at `D:\npown\i2pd.exe`. If not, redo 9.1–9.3.
10. Uninstall silently, as in step 4.
11. **Router removal pass condition (all):**
    - no `i2pd.exe` process has an `ExecutablePath` under
      `%LOCALAPPDATA%\nullpath\i2p-router\`;
    - the folder `%LOCALAPPDATA%\nullpath\i2p-router` doesn't exist;
    - the `D:\npown\i2pd.exe` process is still running, with the same
      ProcessId as in 9.4, and `D:\npown\data` still exists;
    - Java I2P (if started in 9.3) is still running;
    - `%APPDATA%\nullpath\i2p\router.json` still exists.
12. **Reinstall pass condition (all):** install again silently and launch
    (§1.2). The router button is Not connected. Opening the router panel shows
    the first-click chooser (§4.3), not **Needs attention** or "router
    missing". `%APPDATA%\nullpath\i2p\router.json` now has `"managed": null`.
    Afterwards stop `D:\npown\i2pd.exe` and delete `D:\npown`.
13. Evidence: `release-evidence/<VER>/installer.md` with the diffs (as text),
    the process listings from 9.4 and 11, and the outcome of each check.
    **G17** is steps 7, 11 and 12.

### V7. Accessibility

Tools: the latest NVDA from https://www.nvaccess.org/download/, and Windows
Narrator. Run every step with NVDA; repeat steps 1–8 with Narrator.

1. From the address bar, Tab/F6 to the router button. It's announced as
   "I2P router: Not connected" (or "… Set up I2P"), as a button.
2. Enter opens the panel, and the status line is read.
3. Walk the chooser with Tab and Shift+Tab only. Every control is announced
   with a name and a role. Nothing is skipped or unreachable.
4. Using the keyboard only: **Use my own I2P router** → fill the fields →
   **Save and connect**.
5. When the state changes to Connected (or Needs attention), it's announced
   without moving focus.
6. Esc closes the panel and focus returns to the router button.
7. Tree tabs: with a parent tab focused, → expands and ← collapses. The
   screen reader says "expanded"/"collapsed" and "level n".
8. On `about:nullpath-blocked` (load any public URL while not connected), the
   heading and every button are announced.
9. Windows Settings → Accessibility → Contrast themes → "Night sky": the
   router button icon is visible in all four states.

Evidence: `release-evidence/<VER>/accessibility.md`, a table of step ×
(NVDA, Narrator) → PASS/FAIL, with a one-line note for each FAIL. **G18**
passes when every cell is PASS. If you can't operate a screen reader, the
owner performs V7 (§6 O5).

### V8. Feature checks

Record each in `release-evidence/<VER>/features.md` as PASS/FAIL, with what
you saw:

1. `about:keyboard` lists "Open I2P router panel" with no shortcut. Assign
   Ctrl+Alt+Shift+U, then press it in a new window: the panel opens. Clear
   the shortcut again.
2. `about:nullpath-network` shows the diagram and all lists. From a web page
   (use `http://SITE/`, with the browser devtools console running
   `location = "about:nullpath-network"`), the navigation is refused.
3. **Close all windows of this mode:** with an I2P sites window and a Direct
   web window open, clicking it in the I2P sites panel closes only the I2P
   sites windows. The Direct web window stays open.
4. No "old build" warning exists (D1): searching `about:config` for
   `nullpath.staleness` finds nothing, and at startup the only Nullpath
   notification bar in an I2P sites window is the Not connected banner.
5. In an I2P sites profile, Settings shows the Sync checkbox labelled
   "Enable sync with a Mozilla account", disabled (locked off). In Direct
   web, it's enabled.
6. `about:license` lists "i2pd License", and the section shows i2pd's license
   text.
7. uBlock Origin is installed in all three profiles of a fresh install, and
   `about:addons` shows the version in `nullpath/extensions/VERSION`.
8. uBO dashboard → Settings: "Uncloak canonical names" is unchecked.
9. The router panel's help view has "How Nullpath connects", and it opens
   `about:nullpath-network`.

**G20** passes when all 9 are PASS.

---

## 6. Owner-only actions

Ask for all of these in **one** message once §3 and §4 steps 1–2 are done.

- **O1 Code-signing certificate** (D8). An OV or EV code-signing certificate
  on a hardware token, visible in the Windows certificate store. Provide
  `NULLPATH_SIGN_CERT_SHA1` and `NULLPATH_SIGN_TIMESTAMP_URL`, and be present
  to unlock the token during `sign` and `sign-installer`. See
  REBRAND-HANDOFF.md §2b.3.
- **O2 Release signing key.** On the owner's machine:
  `gpg --quick-generate-key "Nullpath Release Signing" ed25519 sign 3y`.
  Back up the private key offline. Give the agent only the fingerprint
  (`gpg --list-keys --with-colons` → `fpr`). The agent replaces
  `<RELEASE KEY FINGERPRINT>` in `SECURITY.md` and `README.nullpath.md` with
  it, then runs `checksums` with `NULLPATH_RELEASE_KEY` set (the owner may
  need to enter the key's passphrase).
- **O3 Independent security review.** Commission a reviewer (a person or firm
  not involved in writing Nullpath) with `docs/nullpath/SECURITY-REVIEW-SCOPE.md`.
  Deliverable: their written report in
  `release-evidence/<VER>/security-review/`. Every Critical and High finding
  must be fixed (as `V9:` commits, with G3 and V3 re-run) and marked fixed in
  a `response.md` next to the report. Medium findings must be fixed or
  listed as limitations in `THREAT-MODEL.md`.
- **O4 Private vulnerability reporting.** Repository Settings → Security →
  enable "Private vulnerability reporting". Evidence: a screenshot or the
  output of `gh api repos/Kayyo321/nullpath/private-vulnerability-reporting`
  showing `enabled: true`.
- **O5 (only if the agent can't run a screen reader):** perform V7.

---

## 7. Gates and the verdict

### 7.1 Gates

| Gate | Title | PASS when | Evidence |
|---|---|---|---|
| G1 | Source hygiene | W0–W16 committed (W3 has no commit); `git status` clean except `D:\nullpath\verify` (outside the repo); every `NOTES.md` BLOCKED entry resolved or already failing another gate; docs updated per W13 and step 3 below | `git log --oneline` output in `release-evidence/<VER>/git.txt` |
| G2 | Firefox base is current | W15 step 2 | `base/firefox_versions.json` |
| G3 | Automated tests | §4 step 1 | `tests/*.log` |
| G4 | Transient I2P identity | V4 steps 5–6 | `identity.md` |
| G5 | addresshelper | V5 | `addresshelper.md` |
| G6 | Profile launch | W14 criteria A, B, and C (or C′) | `profiles/*.md` |
| G7 | Network leak checks | V3, all of S0–S6 PASS | `network/*` |
| G8 | Headers and fingerprint | V4 steps 7–8 | `identity.md` |
| G9 | uBlock Origin bundled | W8 done; V8 items 7 and 8 PASS | `features.md` |
| G10 | Network disclosure | W4 and W13 items 2–4 done; V8 items 2 and 9 PASS; B5 passed | `features.md`, `tests/` |
| G11 | Licenses | V8 item 6 PASS; the About dialog shows the attribution statement from REBRAND-HANDOFF §13 word for word | `features.md` |
| G12 | Real-program checks | V2 done with no open mismatch | `router-programs.md` |
| G13 | i2pd pin provenance | V1 pass condition | `i2pd/provenance.md` |
| G14 | Update policy | `SECURITY.md` exists with the W13 text, including the 7-day security release policy; V8 item 4 PASS | `features.md` |
| G15 | Code signing | O1 done; `signtool verify /pa` succeeded for every file; V6 step 8 all `Valid` | `signing/*`, `installer.md` |
| G16 | Signed checksums | O2 done; `checksums` produced `SHA256SUMS` + `SHA256SUMS.asc` and `gpg --verify` succeeded; no `<RELEASE KEY FINGERPRINT>` placeholder left in the repo | `signing/checksums.txt` |
| G17 | Installer and router removal | W16 done; X4 and B6 passed; V6 steps 7, 11 and 12 | `installer.md`, `tests/` |
| G18 | Accessibility | V7, every cell PASS | `accessibility.md` |
| G19 | Security review and contact | O3 done (no open Critical/High); O4 done | `security-review/*` |
| G20 | Remaining features | V8, all 9 items PASS | `features.md` |

### 7.2 Rules

- Each gate is **PASS** or **FAIL**. Nothing else is allowed: no "partial",
  "PASS with notes", "N/A" or "waived". BLOCKED means FAIL.
- A gate whose evidence is missing is FAIL.
- A code change made after a gate passed invalidates that gate if the change
  touches files that gate depends on. Re-run it. For simplicity: **any** code
  commit after the start of §5 means G3 and G7 must be re-run afterwards.
- The verdict is **PRODUCTION READY** if and only if all 20 gates are PASS.
  Otherwise it is **NOT PRODUCTION READY**.

### 7.3 Producing the verdict

1. Fill in the gate table in `docs/nullpath/release-evidence/<VER>/VERDICT.md`
   using exactly this template:

```markdown
# Release verdict: Nullpath <VER>

Date: <YYYY-MM-DD>
Commit: <full SHA of HEAD>
Evaluated by: <agent/model name or person>

| Gate | Title | Result | Evidence | Reason (FAIL only) | Next action (FAIL only) |
|---|---|---|---|---|---|
| G1 | Source hygiene | PASS/FAIL | <path> | | |
| … one row per gate, G1 to G20, in order … |

Passing gates: <n>/20

VERDICT: <PRODUCTION READY | NOT PRODUCTION READY>
Failing gates: <comma-separated gate ids, or "none">
```

2. The `VERDICT:` line contains exactly one of those two phrases. When it's
   NOT PRODUCTION READY, each failing row must have a reason (one sentence,
   the observed fact) and a next action (one sentence, naming the work item,
   V item or O item to redo).
3. Rewrite `docs/nullpath/I2P-ROUTER-TOGGLE.md` §15's heading as
   `## 15. Implementation status (<date>)`, replace its first paragraph with
   `See release-evidence/<VER>/VERDICT.md for the verified status of this release.`,
   and replace the "Not done yet" list with the failing gates' titles (or
   "Nothing." if there are none).
4. Commit as `Verdict: <VER>` and paste `VERDICT.md` into your final message
   to the owner (rule 9).

### 7.4 Expected outcome if nothing is done

As of 2026-09-23, before any of this work: G1, G3–G20 are FAIL, and G2 is
PASS only if Firefox 156.0.1 is still the latest release. The verdict is
**NOT PRODUCTION READY**.
