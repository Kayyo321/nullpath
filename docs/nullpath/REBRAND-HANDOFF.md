# Nullpath rebrand handoff

This document is for the AI agent (or developer) who will turn this LibreWolf
fork into **Nullpath**. It says where the project stands, what "rebrand" covers,
where every LibreWolf identity lives, what must *not* be changed, and how to
verify the result.

I2P routing is **out of scope** here. The owner will start it after the rebrand.
Section 9 lists the LibreWolf network endpoints that must be removed anyway,
because they are identity problems now and traffic leaks later.

---

## 0. Ground rules

- **Workspace:** `D:\nullpath\librewolf-source` (Windows 11, 8 threads, 32 GB RAM).
- **Native Windows only.** The owner doesn't want WSL or Docker in the workflow.
  The build runs in MozillaBuild (see §2).
- **Remotes:** `origin` = `https://github.com/Kayyo321/nullpath.git`,
  `librewolf` = `https://librewolf.dev/librewolf/source.git`.
  Don't use the GitLab or GitHub LibreWolf mirrors.
- **`main` tracks LibreWolf upstream only.** Do Nullpath work on feature
  branches, e.g. `feature/nullpath-branding`. Use focused commits, and don't mix
  branding, packaging and networking changes.
- **Ask the owner before anything destructive or outward-facing:** force-push,
  history rewrite, deleting branches, publishing releases.
- **Never do a blind global `librewolf → nullpath` replace.** Some references
  are license notices, upstream attribution or compatibility shims (see §8).
  Handle each category deliberately.
- **Don't claim anonymity.** Don't write "anonymous" or "untraceable" in any
  user-facing text until the I2P work has been independently tested.

---

## 1. Naming scheme

| What | LibreWolf value | Nullpath value |
|---|---|---|
| Display / product name | `LibreWolf` | `Nullpath` |
| `MOZ_APP_NAME` (exe name, lowercase) | `librewolf` → `librewolf.exe` | `nullpath` → `nullpath.exe` |
| `MOZ_APP_BASENAME` | `LibreWolf` | `Nullpath` |
| `MOZ_APP_DISPLAYNAME` | `LibreWolf` | `Nullpath` |
| `MOZ_APP_REMOTINGNAME` | `librewolf` (configure.sh) / `LibreWolf` (mozconfig) | `nullpath` (use one value in both places) |
| `MOZ_APP_VENDOR` | `LibreWolf` | `Nullpath` |
| `MOZ_APP_PROFILE` | `librewolf` | `nullpath` |
| Reverse-DNS application ID | `io.gitlab.librewolf…` (DBus), `net.librewolf.LibreWolf` (AppImage/Flatpak) | `org.nullpath.browser` |
| DBus prefix | `io.gitlab.%s` | `org.nullpath.%s` |
| Branding directory | `browser/branding/librewolf` | `browser/branding/nullpath` |
| Autoconfig file | `librewolf.cfg` | `nullpath.cfg` |
| User overrides file | `~/.librewolf/librewolf.overrides.cfg` | `~/.nullpath/nullpath.overrides.cfg` |
| Pref namespace | `librewolf.*` | `nullpath.*` |
| Windows installer | `librewolf-<ver>-windows-x86_64-setup.exe` | `nullpath-<ver>-windows-x86_64-setup.exe` |
| NSIS ProgID | `LibreWolfHTM` | `NullpathHTM` |
| Release tags | `156.0.1-1` | `nullpath-156.0.1-1` (LibreWolf base version + Nullpath revision) |

**Keep `MOZ_APP_ID` = `{ec8030f7-c20a-464f-9b0e-13a3a9e97384}`** (Firefox's
GUID, set in `browser/moz.configure`). It is not branding. It is what
addons.mozilla.org extensions check for compatibility. LibreWolf keeps it too.

The owner has no website domain yet. Until they choose one, point user-facing
URLs at `https://github.com/Kayyo321/nullpath` (README, issues, releases). Don't
invent a domain.

---

## 2. Current state

### Repo
- `main` = `librewolf/main` = `57e3770` (LibreWolf **156.0.1-1**, Firefox 156.0.1).
- Branch **`build/windows-native`** holds uncommitted work that makes the build
  run natively on Windows:
  - `scripts/librewolf-patches.py`: on Windows it runs shell commands through
    MSYS bash instead of `cmd.exe`. File I/O is now explicit UTF-8 with LF line
    endings (the Windows defaults, cp1252 and CRLF, corrupted the mozconfig and
    the `.ftl` files). Temp paths are passed as forward slashes.
  - `scripts/windows-build.sh`: new wrapper with the steps
    `fetch | prepare | bootstrap | build | package | sign | run | all`.
    - `fetch` verifies the Firefox tarball against Mozilla's pinned release key
      `14F26682D0916CDD81E37B6D61B7B526D98F0353`, using a throwaway keyring.
    - `prepare` applies LibreWolf's patches, then the **Nullpath layer**
      (`nullpath/patches.txt`). `NULLPATH_BASELINE=1` skips the layer.
    - `build` refuses to compile an updater that trusts LibreWolf's
      update-signing keys (§2b).
    - `sign` Authenticode-signs the package (§2b).
  - `nullpath/`: the Nullpath overlay (§3). It currently contains one patch,
    `patches/windows-uninstall-reset-key.patch` (§2b), and `keys/` with a
    `.gitignore` that only admits public `.der` files.
  - `docs/nullpath/REBRAND-HANDOFF.md`: this file.
  - Commit these first, before any branding work: the build fixes, then the
    Nullpath layer and security fixes, as separate commits.

### Build status: ✅ first native Windows build succeeded (2026-09-22)
- ✅ `fetch`: Firefox 156.0.1 source downloaded and signature verified.
- ✅ `prepare`: all 59 LibreWolf patches plus the Nullpath layer applied
  (60 patch runs, 179 files). About 20 hunks applied with small offsets or
  fuzz, which is normal. 163 locales.
- ✅ `bootstrap`: MozillaBuild 4.2.1, clang-cl, Windows SDK 10.0.28000,
  MSVC 14.51, Rust, NASM and mozmake in `C:\Users\sully\.mozbuild`.
- ✅ `build` + `package`: **36 min** for the clean build into `D:/nullpath/obj`
  (8 threads, 32 GB RAM, antivirus exclusions in place). It took three failed
  attempts to get there: an antivirus quarantine, a missing shell, and
  MAX_PATH; see Known quirks.
- **Artifact:** `D:/nullpath/obj/dist/librewolf-156.0.1-1.en-US.win64.zip`,
  132,567,154 bytes, SHA-256
  `0fc979f58dcf1b4699243c23a7df40ad3516e8b3759b955a1de4461b329f9392`,
  Build ID `20260922164623`. It's unsigned and not Nullpath-branded yet: the
  baseline identifies as LibreWolf.
- ✅ **Verified:**
  - Unzipped to `D:\nullpath\test-run\` and launched with
    `-no-remote -profile D:\nullpath\test-run\profile about:support`. It
    started, created a fresh profile (132 files) and rendered about:support:
    Name `LibreWolf`, Version `156.0.1-1`, UA `… Firefox/156.0`, Launcher
    Process enabled, Fission on, Enterprise Policies **Active**.
  - The package contains no updater, crash reporter, pingsender, maintenance
    service or default-browser agent.
  - `librewolf.cfg` is at the install root, with 348 prefs, and
    `defaults/pref/local-settings.js` (inside `omni.ja`) points to it.
  - The Nullpath registry fix is compiled in:
    `browser/omni.ja → modules/BrowserGlue.sys.mjs` uses
    `"Software\\Mozilla\\" + Services.appinfo.name`, and the hard-coded
    Firefox key is gone.
- Findings for the rebrand:
  - `application.ini` says **`Vendor=Mozilla`**, and the exe's
    CompanyName is "Mozilla Corporation", even though LibreWolf's
    `moz-configure.patch` gives `MOZ_APP_VENDOR` a default of "LibreWolf".
    That default is overridden somewhere, probably
    `browser/moz.configure`/confvars. Nullpath must set the vendor
    **explicitly** (§4) and then re-check `application.ini`, the exe version
    info, and the §6/§7 paths.
  - `desktop-launcher\desktop-launcher.exe` is shipped. It contains
    `find_firefox.cpp`'s hard-coded `SOFTWARE\Mozilla\Mozilla Firefox` lookup
    (§7a). Decide whether to drop it from the package or patch it.
  - Test launches must run from a folder the antivirus excludes. From
    `%TEMP%` the exe sat at launch with no window (see Known quirks).
- ⏳ Not done yet: a PowerShell entry point (`scripts/windows-build.ps1`).
  Meanwhile, launch from a MozillaBuild window:
  `C:\mozilla-build\start-shell.bat -c "bash <script>"` runs a script
  non-interactively in a visible window. Unset `CLAUDECODE` in that script
  (see Known quirks).
- To clean up at your discretion:
  - the abandoned first objdir
    `librewolf-156.0.1-1\obj-x86_64-pc-windows-msvc`
  - `C:\Users\sully\.mozbuild\{clang,nasm,mozmake}.quarantine-restored`
  - `D:\nullpath\test-run`
  - earlier logs in `D:\nullpath\build-logs\`

### Running the build
From a MozillaBuild shell (`C:\mozilla-build\start-shell.bat`):
```bash
cd /d/nullpath/librewolf-source
./scripts/windows-build.sh fetch prepare   # also works from Git Bash
./scripts/windows-build.sh bootstrap build package
./scripts/windows-build.sh run             # starts with a throwaway profile
```
Output: `D:/nullpath/obj/dist/<app>-156.0.1-1.en-US.win64.zip` (see the
MAX_PATH note under Known quirks for why the objdir is outside the tree).
The first build takes about 1–3 hours. Windows Defender real-time scanning
slows it down a lot; the owner decides whether to add exclusions.

### Known quirks
- On Windows, git checks out `assets/mozconfig` (a symlink to `mozconfig.new`)
  as a text file. The build uses `mozconfig.new` directly, so this is harmless.
- `librewolf-patches.py` writes the version into `assets/mozconfig.new` in
  place. `windows-build.sh` restores the file afterwards with `git checkout`.
- Firefox locales: `librewolf-patches.py` normally clones
  `https://librewolf.dev/mirror/firefox-l10n` with no timeout. That mirror
  served about 30 KB/s and looked hung for over an hour. `windows-build.sh`
  now fetches from Mozilla's `https://github.com/mozilla-l10n/firefox-l10n`
  (the mirror tracks it commit-for-commit) into a cached shallow clone
  `firefox-l10n-cache/`. It aborts transfers that stall for 5 minutes, falls
  back to LibreWolf's mirror, and passes `SKIP_FETCHING_LOCALES=1` to the patch
  script. Override the source with `NULLPATH_L10N_URL`.
- LibreWolf's mozconfig has `--with-l10n-base=$PWD/lw/l10n`. Inside
  MozillaBuild, `$PWD` is `/d/...`, which configure (native Windows Python)
  rejects with "doesn't exist". `fix_mozconfig_paths` in `windows-build.sh`
  rewrites it to `D:/...` during `prepare` and again before `build`
  (idempotent). LibreWolf never hits this because it cross-compiles from Linux.
- `mach build` hides its progress output when it detects an AI coding agent
  (`CLAUDECODE`, `CODEX_SANDBOX`, `GEMINI_CLI` or `OPENCODE` set;
  `mozbuild.util.is_running_under_coding_agent`). An agent reading output is
  fine with that, but unset those variables when launching a build window
  meant for a human to watch.
- **Antivirus kills the build.** On the owner's machine, Surfshark's
  antivirus (the active AV; Defender is passive) quarantined, mid-build, the
  MSYS2 shell (`C:\mozilla-build\msys2\usr\bin\sh.exe`), `mozmake.exe`, the
  whole `~/.mozbuild/clang` toolchain, `nasm`, `git`, `python` and several
  build outputs. The build died with no error message (exit 184). Restoring
  from quarantine brought some files back with permissions that deny access
  entirely ("Access is denied" even to read). Fix used: folder exclusions for
  `C:\mozilla-build`, `D:\nullpath` and `C:\Users\sully\.mozbuild`; locked
  toolchain dirs renamed to `*.quarantine-restored` (safe to delete later) and
  re-downloaded by `./scripts/windows-build.sh bootstrap`. On any new build
  machine, **add the exclusions before the first build.** The same applies
  when running a freshly built, unsigned `librewolf.exe`: launched from
  `%TEMP%`, it stayed as a single process with no window. From
  `D:\nullpath\test-run` it started normally.
- **MAX_PATH.** GNU make (`mozmake`) isn't long-path aware, and
  `LongPathsEnabled` is 0 on this machine. The `xul.dll` link step names
  objects relative to `toolkit/library/build` (`../../../third_party/…`), which
  reached 267 characters with the default objdir
  `<srcdir>/obj-x86_64-pc-windows-msvc` and failed with "No rule to make
  target". `windows-build.sh` now sets `MOZ_OBJDIR` to **`D:/nullpath/obj`**
  (override with `NULLPATH_OBJDIR`). The measured worst case across all 4,421
  objects is 207 characters. Keep the source tree and objdir paths short;
  don't nest the repo deeper.
- **`mach` hangs forever instead of failing** when a helper process can't be
  launched (e.g. the quarantined `sh.exe`). Cause: in
  `python/mach/mach/main.py`, `_finish_telemetry_init` calls
  `report_invocation_metrics()`; if that raises, `_telemetry_init_done.set()`
  is never reached, and the `finally:` block's `.wait()` blocks forever with
  0% CPU. Separately, even though LibreWolf makes `is_telemetry_enabled()`
  return `False`, `mach` still initializes Mozilla's Glean telemetry "to
  ensure a deletion ping is sent", which is a network request to Mozilla on
  every run. Candidate Nullpath patch: wrap the callback body in
  `try/finally: set()`, and skip Glean initialization when telemetry is
  disabled. Build-tooling only; it doesn't affect the browser.
- `prepare` deletes and recreates `librewolf-<ver>-<rel>/`, which wipes any
  manual edits in the patched tree. Put every change in patches or overlay
  files in the repo, never only in the extracted tree.

**Acceptance gate:** don't start branding until an **unmodified** LibreWolf
build (`NULLPATH_BASELINE=1 ./scripts/windows-build.sh prepare` + build) has
been produced on Windows and launched with a fresh profile. Branding bugs are
much easier to separate from build bugs that way. Then run `prepare` without
the variable, rebuild, and confirm the Nullpath layer changes nothing else.

---

## 2b. Security issues inherited from LibreWolf, and their fixes

These were found while mapping LibreWolf's identity. Each one is either fixed
in this repo already or has a concrete fix below. Keep them fixed across
upstream updates, and re-check each one after merging a new LibreWolf release.

### 1. Firefox's uninstall-reset value in the registry: FIXED in the Nullpath layer
**Problem.** Firefox's uninstaller writes
`HKCU\Software\Mozilla\Firefox` → `Uninstalled-<channel> = "True"`
(`browser/installer/windows/nsis/uninstaller.nsi:738`). On startup,
`BrowserGlue.sys.mjs` (~line 865) **reads and deletes** that same hard-coded
Firefox value, and offers a profile reset if it was `"True"`. In a fork, that
means:
- Nullpath deletes a value belonging to the user's real Firefox, so Firefox
  never shows its own reset offer after a reinstall;
- Nullpath can show a "reset your profile" prompt because *Firefox* was
  uninstalled;
- Nullpath's own reinstall detection never works.

LibreWolf has the same bug today.

**Fix (done).** `nullpath/patches/windows-uninstall-reset-key.patch` keys both
sides off the app's own name, following Firefox's existing convention for
per-product uninstaller values (`Software\Mozilla\${BrandFullNameInternal}`,
used elsewhere in `uninstaller.nsi`):
- `BrowserGlue.sys.mjs`: `"Software\\Mozilla\\Firefox"` →
  `"Software\\Mozilla\\" + Services.appinfo.name` (both the read and the delete)
- `uninstaller.nsi`: `"Software\Mozilla\Firefox"` →
  `"Software\Mozilla\${BrandFullNameInternal}"`

The patch is brand-neutral: it resolves to `Software\Mozilla\LibreWolf` today
and `Software\Mozilla\Nullpath` after the rebrand. If §7a moves Nullpath's keys
from `Software\Mozilla\…` to `Software\Nullpath\…`, change **both** halves of
this patch in the same commit. It was verified to apply cleanly to the
156.0.1-1 tree and to reverse cleanly.

**Verify after a build:** create
`HKCU\Software\Mozilla\Firefox` → `Uninstalled-release = True`, then launch
Nullpath. The value must still be there, and no reset prompt may appear.

### 2. LibreWolf's update-signing (MAR) keys in the tree: GUARDED; replace before enabling updates
**Problem.** `librewolf-patches.py` copies LibreWolf's MAR public keys
(`assets/marsigner.der`, `marsigner2.der`) over Firefox's
`toolkit/mozapps/update/updater/release_{primary,secondary}.der`. An updater
built with them accepts any update LibreWolf signs.

**Current exposure: none.** `toolkit/moz.build` only builds
`mozapps/update` when `MOZ_UPDATER` is set, and LibreWolf's mozconfig passes
`--disable-updater`. The keys are copied in but never compiled (they are only
inputs to the updater's `primaryCert.h`/`secondaryCert.h`, and only for
`release`/`beta`/`esr` channels). `policies.json` also sets `DisableAppUpdate`.

**Guard (done).** `windows-build.sh` (`check_update_keys`, run at the end of
`prepare` and before `build`) works out whether the updater is enabled.
Firefox's default is enabled; the last `--enable-updater`/`--disable-updater`
in the mozconfig wins. If the updater is enabled and either key file still
equals LibreWolf's, the build stops. This was tested for: updater disabled
(allowed), explicitly enabled (refused), enabled by default because the
`--disable-updater` line was removed (refused), and enabled with other keys
(allowed).

**Fix when Nullpath ships an updater.** Generate Nullpath's own MAR key pair
offline, commit only the public certificates, and keep the private keys off
the build machine:
```bash
# On an offline/secured machine, with NSS tools (certutil, signmar; see
# obj-*/dist/bin after a build, or an NSS tools package).
mkdir nullpath-mar-nssdb
certutil -N -d sql:nullpath-mar-nssdb                  # set a strong password
certutil -S -d sql:nullpath-mar-nssdb -x -t ",," -k rsa -g 4096 -Z SHA384 -v 120 \
  -n nullpath-mar-primary   -s "CN=Nullpath MAR Primary"
certutil -S -d sql:nullpath-mar-nssdb -x -t ",," -k rsa -g 4096 -Z SHA384 -v 120 \
  -n nullpath-mar-secondary -s "CN=Nullpath MAR Secondary"
certutil -L -d sql:nullpath-mar-nssdb -n nullpath-mar-primary   -r > release_primary.der
certutil -L -d sql:nullpath-mar-nssdb -n nullpath-mar-secondary -r > release_secondary.der
# Copy ONLY the two .der files into nullpath/keys/ and commit them.
# Back up nullpath-mar-nssdb somewhere safe and offline. Never commit it.
```
`prepare` copies `nullpath/keys/release_*.der` over LibreWolf's automatically,
and the guard then lets the build through. Sign each update MAR with
`signmar -d sql:nullpath-mar-nssdb -n nullpath-mar-primary -s in.mar out.mar`.
The secondary key is the rotation/backup key; keep it separate from the
primary. Before enabling updates, also replace `update.librewolf.net` (§9) with
Nullpath's own update host, and remove `DisableAppUpdate`/`AppUpdateURL` from
Nullpath's `policies.json`.

### 3. Third-party binary used to sign executables: NOT USED; own signing step added
**Problem.** bsys6's `src/setup.sh` downloads
`https://codeberg.org/any1here/Signed/releases/download/v1.0.0/Signed`, a
prebuilt binary from an individual's account, pinned only by sha256. It runs
that binary on every `.exe` and `.dll` before packaging. For Nullpath that
would mean:
- an unaudited program handles every shipped binary;
- the resulting signatures, if any, are not Nullpath's identity.

**Status.** Nullpath doesn't use bsys6 (native Windows build), so this code
never runs. Don't port `setup.sh`'s signing loop.

**Fix (done): `./scripts/windows-build.sh sign`.** This uses Microsoft's
`signtool.exe`: first `NULLPATH_SIGNTOOL` if set, then `PATH`, then the newest
Windows SDK copy. It found
`C:\Program Files (x86)\Windows Kits\10\bin\10.0.28000.0\x64\signtool.exe` on
this machine. The step:
1. extracts `obj-*/dist/*.win64.zip`;
2. signs every `.exe`/`.dll` with SHA-256 and an RFC 3161 timestamp
   (`/fd sha256 /td sha256 /tr <url> /sha1 <thumbprint>`);
3. runs `signtool verify /pa` on each file and fails if any don't verify;
4. writes `*.win64.signed.zip` next to the original.

```bash
export NULLPATH_SIGN_CERT_SHA1=<certificate thumbprint>      # cert in the Windows cert store
export NULLPATH_SIGN_TIMESTAMP_URL=<your CA's timestamp URL> # e.g. http://timestamp.digicert.com
./scripts/windows-build.sh package sign
```
It refuses to run without both variables, or without a package (tested).

**Getting a certificate (the owner's decision and cost):**
- Since June 2023, publicly trusted code-signing keys must live on hardware (a
  USB token or HSM). CAs no longer issue exportable `.pfx` files. Once the
  token's driver is installed, the certificate appears in the Windows
  certificate store, which is why the script signs by thumbprint (`/sha1`).
- *OV* certificates are the cheaper option. SmartScreen reputation builds up
  over time. *EV* certificates cost more and used to get instant reputation;
  that no longer applies as strongly.
- Alternative: **Azure Trusted Signing** (Microsoft's managed signing
  service, low monthly cost, identity validation required). It signs through
  `signtool ... /dlib Azure.CodeSigning.Dlib.dll /dmdf metadata.json` instead
  of `/sha1`. Supporting it needs a small change to `do_sign`.
- Until a certificate exists, releases are **unsigned dev builds**. Say so
  on the release page, and publish SHA-256 checksums plus a detached GPG
  signature of the zip made with a Nullpath release key.

Also sign the **installer** `.exe` and its **uninstaller** once they exist
(§11). NSIS 3.08+ can sign the uninstaller during the build via
`!uninstfinalize`.

### 4. bsys6 installer: deletes every app's browser registration, and can delete arbitrary folders
bsys6's `assets/setup.nsi` is the only Windows installer LibreWolf ships. It
isn't in this repo yet. When porting it (§11), fix these two uninstaller bugs.
Don't copy them.

**4a. `DeleteRegKey HKLM "Software\RegisteredApplications"`** deletes the
whole key: every browser, mail client and media player registered on the
machine disappears from Windows' Default Apps. Remove only Nullpath's value.

**4b. `RmDir /r $INSTDIR`** deletes the install directory recursively,
whatever it is. If a user installs into an existing folder (e.g. picks
`C:\Program Files` or `D:\Apps` on the directory page), uninstalling deletes
everything in it. Delete only when the directory is clearly Nullpath's.

Corrected uninstall section (the full ported installer goes in
`nullpath/installer/setup.nsi`):
```nsis
!define APPNAME     "Nullpath"
!define PROGNAME    "nullpath"
!define EXECUTABLE  "${PROGNAME}.exe"
!define COMPANYNAME "Nullpath"
!define UNINST_KEY  "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"
!define CLIENT_KEY  "Software\Clients\StartMenuInternet\${APPNAME}"
!define PROGID      "${APPNAME}HTM"

Section "Uninstall"
  ; (process check/kill as in bsys6, using ${EXECUTABLE})
  SetShellVarContext all
  RMDir /r "$SMPROGRAMS\${APPNAME}"

  ; 4b: only remove $INSTDIR recursively if it really is our install.
  ${If} ${FileExists} "$INSTDIR\${EXECUTABLE}"
  ${AndIf} ${FileExists} "$INSTDIR\uninstall.exe"
    RMDir /r "$INSTDIR"
  ${Else}
    ; Unexpected layout: remove only what we know we installed.
    Delete "$INSTDIR\uninstall.exe"
    RMDir "$INSTDIR"          ; non-recursive: only succeeds if empty
  ${EndIf}

  DeleteRegKey HKLM "${UNINST_KEY}"
  DeleteRegKey HKLM "${CLIENT_KEY}"
  ; 4a: remove OUR value, not the whole RegisteredApplications key.
  DeleteRegValue HKLM "Software\RegisteredApplications" "${APPNAME}"
  DeleteRegKey HKLM "Software\Classes\${PROGID}"
SectionEnd
```
Stronger still: make the installer always append `\${APPNAME}` to whatever
directory the user picks (NSIS: validate in `.onVerifyInstDir`, or set
`InstallDir "$PROGRAMFILES64\${APPNAME}"` and refuse paths that don't end in
`\${APPNAME}`). Then `$INSTDIR` can never be a shared folder.

Matching install-side registration, all written from the defines so nothing
says LibreWolf:
```nsis
WriteRegStr HKLM "Software\RegisteredApplications" "${APPNAME}" "${CLIENT_KEY}\Capabilities"
WriteRegStr HKLM "Software\Classes\${PROGID}" "" "${APPNAME} Handler"
WriteRegStr HKLM "Software\Classes\${PROGID}\Application" "ApplicationCompany" "${COMPANYNAME}"
; ... and so on for every value in §7b
```

**Verify:** on a test VM, install into `C:\Program Files\Nullpath`, register
as default browser, uninstall. `reg query HKLM\Software\RegisteredApplications`
must still list the other applications. Then install into a folder containing
an unrelated file, uninstall, and confirm the unrelated file survives.

---

## 3. Strategy: overlay, don't edit upstream patches

LibreWolf ships a new release roughly every 2–4 weeks, one per Firefox release.
If Nullpath edits LibreWolf's patches and files in place, every upstream merge
will conflict across dozens of files. Instead:

1. **Leave LibreWolf's files as they are** wherever possible: `patches/*.patch`,
   `settings/librewolf.cfg`, `l10n/`, `themes/browser/branding/librewolf/`.
2. **Add a Nullpath layer that runs after `librewolf-patches.py`.** The layer
   **already exists**: `apply_nullpath_layer` in `scripts/windows-build.sh`,
   called by `prepare`.
   - ✅ `nullpath/patches.txt` + `nullpath/patches/*.patch`: applied in order
     with `patch -p1` from the tree root; a failure stops `prepare`. Comments
     (`#`) and blank lines are ignored.
   - ✅ `nullpath/keys/release_{primary,secondary}.der`: copied over
     LibreWolf's MAR keys when present (§2b).
   - To add: `nullpath/branding/` → copied to `browser/branding/nullpath/` in
     the tree.
   - To add: `nullpath/settings/nullpath-overrides.cfg` → concatenated into
     `nullpath.cfg` (§10b).
   - Extend `apply_nullpath_layer` for these copy steps (or move it into a
     `scripts/nullpath-patches.py` once it grows). Keep them after the patch
     series, and keep `NULLPATH_BASELINE=1` skipping everything.
3. **Edit LibreWolf files directly only when an overlay can't do the job**, and
   keep the diff minimal and commented `# nullpath:`. Candidates:
   - `assets/mozconfig.new`: or have `nullpath-patches.py` rewrite
     `--with-app-name`, `--with-branding` and `MOZ_APP_REMOTINGNAME` in the
     generated `mozconfig`, which leaves the file untouched.
   - `scripts/librewolf-patches.py`: the only reason would be to make it call
     the Nullpath step.

Where LibreWolf patched a file and Nullpath needs a different string, write the
Nullpath patch against the **post-LibreWolf** tree. For example,
`dbus_name.patch` produces `io.gitlab.%s`; a Nullpath patch turns that into
`org.nullpath.%s`. Workflow for creating one:

```bash
./scripts/windows-build.sh prepare
cd librewolf-156.0.1-1
git init -q && git add -A && git commit -qm base      # slow but reliable
# ... edit files ...
git diff > ../nullpath/patches/<name>.patch
```

Delete the scratch `.git` afterwards, or let the next `prepare` wipe it.

---

## 4. Build identity (app name, vendor, profile)

| File (repo) | What to change |
|---|---|
| `assets/mozconfig.new` | `--with-app-name=librewolf` → `nullpath`; `--with-branding=browser/branding/librewolf` → `browser/branding/nullpath`; `export MOZ_APP_REMOTINGNAME=LibreWolf` → `nullpath` |
| `patches/moz-configure.patch` (lands in `toolkit/moz.configure`) | defaults `MOZ_APP_VENDOR="LibreWolf"` and `MOZ_APP_PROFILE="librewolf"`. Override with `imply_option`/mozconfig `export MOZ_APP_VENDOR=Nullpath` and `export MOZ_APP_PROFILE=nullpath`, or a Nullpath patch changing the defaults |
| `themes/browser/branding/librewolf/configure.sh` | becomes `nullpath/branding/configure.sh`: `MOZ_APP_NAME=nullpath`, `MOZ_APP_BASENAME=Nullpath`, `MOZ_APP_DISPLAYNAME=Nullpath`, `MOZ_APP_REMOTINGNAME=nullpath` |
| `patches/firefox-in-ua.patch` | **keep**: `MOZ_APP_UA_NAME=Firefox` (see §8) |
| Patched tree `browser/app/librewolf.exe.manifest` | named from the app name; check it becomes `nullpath.exe.manifest` automatically. If not, find what generates it |

`MOZ_APP_VENDOR`, `MOZ_APP_BASENAME` and `MOZ_APP_PROFILE` drive most of the
profile paths and registry keys below. Get these right first, then build and
inspect before touching anything else.

---

## 5. Branding assets (icons, names, about dialog)

Source: `themes/browser/branding/librewolf/` (copied into the tree by
`librewolf-patches.py` with `cp -r ../themes/browser .`). Create
`nullpath/branding/` as a full copy and replace:

- **Names:** `locales/en-US/brand.ftl`, `brand.properties`, `brand.dtd`. Every
  `LibreWolf` becomes `Nullpath`, including `-vendor-short-name`,
  `vendorShortName` and `syncBrandShortName`. Keep Mozilla's MPL header and the
  "Firefox Brand" comment block.
- **Windows icons:** `firefox.ico`, `firefox64.ico` (the exe icon despite the
  name), `document.ico`, `document_pdf.ico`, `newtab.ico`, `newwindow.ico`,
  `pbmode.ico`.
- **PNG icons:** `default{16,22,24,32,48,64,128,256}.png`, `PrivateBrowsing_*.png`,
  `content/about-logo*.png`, `content/about.png`, `background.png`,
  `bgstub*.jpg`.
- **SVG:** `content/about-logo.svg`, `content/about-wordmark.svg`,
  `content/firefox-wordmark.svg`, `file.svg`, `file_librewolf.svg` (rename it
  `file_nullpath.svg` and update whatever references it).
- **Windows Start menu tile:** `firefox.VisualElementsManifest.xml` plus the
  images it references.
- **MSIX:** `msix/Assets/*.png`.
- **macOS** (low priority, Windows first): `firefox.icns`, `document.icns`,
  `disk.icns`, `dsstore`.
- **NSIS:** `branding.nsi`. Set `BrandFullNameInternal`, `BrandFullName` and
  `CompanyName` to `Nullpath`, and point every `URL*`/`HelpLink` at the GitHub
  repo. They currently point at dead `libreWolf.gitlab.io` / `LibreWolf-Browser`
  GitHub URLs. `CertNameDownload`/`CertIssuerDownload` are for Mozilla's stub
  installer and don't apply here.
- **Default prefs:** `pref/firefox-branding.js`.
- **Build glue:** `moz.build`, `content/jar.mn`, `content/moz.build`,
  `locales/jar.mn`, `locales/moz.build`. These usually need no changes beyond
  the directory name.

Also in `themes/browser/base/content/`: `aboutDialog.xhtml`, `.js` and `.css`
override Firefox's About dialog. They contain the `https://librewolf.net/` link
and a **version check that calls the librewolf.dev API** (see §9).

Also patched into the tree, and needing Nullpath equivalents:
- `browser/themes/shared/sidebar/librewolf.svg`
- `browser/themes/shared/preferences/category-librewolf.svg`, `librewolf.css`
  (from `patches/pref-pane/`)
- `patches/ui-patches/lw-logo-devtools.patch` (DevTools logo)

**Artwork:** there is no Nullpath logo yet. Ask the owner for one, or make a
clearly temporary placeholder and flag it. Don't ship LibreWolf's wolf.

---

## 6. Filesystem locations (AppData, profiles, config files)

**Verify all of these empirically after the first build**, both before and
after rebranding: launch with a fresh Windows user profile, or clear the
directories, then look at what was created. The expected values below come
from reading the code.

| Location | Before (expected) | After | Controlled by |
|---|---|---|---|
| Roaming profile root | `%APPDATA%\librewolf\` (+ `Profiles\`, `profiles.ini`) | `%APPDATA%\nullpath\` | `MOZ_APP_PROFILE` / vendor / basename; `patches/xdg-dir.patch` changes how the vendor segment is appended (`toolkit/xre/nsXREDirProvider.cpp` `AppendFromAppData`) |
| Local cache | `%LOCALAPPDATA%\librewolf\` | `%LOCALAPPDATA%\nullpath\` | same |
| User overrides cfg | `%USERPROFILE%\.librewolf\librewolf.overrides.cfg` | `%USERPROFILE%\.nullpath\nullpath.overrides.cfg` | `patches/profile-directory.patch` (writes into `extensions/pref/autoconfig/src/prefcalls.js`; also checks `path.includes(".librewolf")` for legacy detection) |
| Native messaging (user) | `.librewolf` / `LibreWolf` dir + fallback to `Mozilla` | `.nullpath` / `Nullpath` + keep the Mozilla fallback | `patches/mozilla_dirs.patch` (`GetSystemParentDirectory(..., "LibreWolf"_ns)`, `AppendNative(".librewolf")`) |
| System extension dir (Linux) | `/usr/share/librewolf/extensions` | `/usr/share/nullpath/extensions` | `mozilla_dirs.patch` |
| Install-dir autoconfig | `<install>\librewolf.cfg`, `defaults\pref\local-settings.js` | `nullpath.cfg` | `settings/defaults/pref/local-settings.js` (`general.config.filename`), `browser/installer/package-manifest.in` (`@RESPATH@/librewolf.cfg`), `lw/moz.build` (`"librewolf.cfg"`), copy step in `librewolf-patches.py` |
| Backup folder name | `Restore LibreWolf` | `Restore Nullpath` | `browser/components/backup/BackupService.sys.mjs` `#backupFolderName` (already patched by LibreWolf) |
| Portable build dir | `LibreWolf\`, `Profiles\Default` | `Nullpath\` | bsys6 `src/portable.sh` (§11) |

On Linux, check the XDG paths too: `~/.config/librewolf/librewolf/` and
`~/.librewolf/`.

---

## 7. Windows registry

### 7a. Keys the browser writes itself
Firefox builds most per-product keys as `Software\Mozilla\<Services.appinfo.name>\…`.
The product part follows `MOZ_APP_BASENAME` automatically. The **`Mozilla`
parent is hard-coded.** LibreWolf leaves it alone, so today LibreWolf writes
under `HKCU\Software\Mozilla\LibreWolf\…`.

Hard-coded `Mozilla` registry paths found in the patched 156.0.1 tree:

| Code | Key | Recommendation |
|---|---|---|
| `widget/windows/WinTaskbar.cpp:260` | `Software\Mozilla\<app>\TaskBarIDs` (AppUserModelID) | Patch to `Software\Nullpath\…`. Must match `commonupdatedir.cpp` |
| `toolkit/mozapps/update/common/commonupdatedir.cpp:579` | `SOFTWARE\Mozilla\%S\TaskBarIDs` | Same change, keep the two consistent |
| `toolkit/mozapps/update/common/pathhash.cpp:122` | `SOFTWARE\Mozilla\…` | Patch alongside the two above |
| `toolkit/mozapps/update/UpdateService.sys.mjs:5403` | `SOFTWARE\Mozilla\<app>\32to64DidMigrate` | Updater is disabled; patch for consistency or leave |
| `toolkit/mozapps/update/common/updatehelper.h:32`, `UpdateService.sys.mjs:1265`, `UpdateTelemetry.sys.mjs:468` | `SOFTWARE\Mozilla\MaintenanceService` | Maintenance service isn't built (`--disable-updater`, no service). Leave, but confirm nothing writes it |
| `toolkit/components/utils/WindowsInstallsInfo.sys.mjs:56` | reads `Software\Mozilla\<app>\TaskBarIDs` | Patch with the TaskBarIDs group |
| `browser/components/shell/StartupOSIntegration.sys.mjs:54` | checks `Mozilla\<app>` | Patch with the TaskBarIDs group |
| `browser/components/BrowserGlue.sys.mjs:867-872` + `browser/installer/windows/nsis/uninstaller.nsi:738` | read/**delete** and write `HKCU\Software\Mozilla\Firefox` value `Uninstalled-<channel>` (hard-coded *Firefox*) | ✅ **Fixed** by `nullpath/patches/windows-uninstall-reset-key.patch` → `Software\Mozilla\<app>` (§2b.1). Move it with this group if the parent key changes |
| `browser/components/installerprefs/InstallerPrefs.sys.mjs:~48` | `Software\<vendor>\<app>\Installer\<hash>`: uses `Services.appinfo.vendor`, so it becomes `Software\Nullpath\nullpath\…` automatically | No patch needed; verify |
| `toolkit/components/enterprisepolicies/WindowsGPOParser.sys.mjs:25`, `EnterprisePoliciesParent.sys.mjs:792` | `HK*\Software\Policies\Mozilla\<app>` (Group Policy) | Decide: `Software\Policies\Nullpath` is cleaner; `Policies\Mozilla\Nullpath` is what admins' existing templates expect. Recommend `Software\Policies\Nullpath` and document it |
| `toolkit/components/extensions/NativeManifests.sys.mjs:25` | `Software\Mozilla\NativeMessagingHosts` | **Keep** (or add Nullpath first and fall back to Mozilla). Password managers and similar register their native hosts here; removing it breaks them |
| `browser/app/desktop-launcher/find_firefox.cpp` | `SOFTWARE\Mozilla\Mozilla Firefox` | Only matters if the desktop launcher is built; check `obj-*/dist/bin` for it. Disable or patch |

Other places Firefox touches the registry through the product name, which
change automatically once §4 is done:
- `HKCU\Software\Mozilla\<app>\Launcher`
- `PreXULSkeletonUISettings`
- default-browser and protocol registration under `Software\Classes`, built
  from `MOZ_APP_BASENAME`/`BrandFullNameInternal` (e.g. `LibreWolfHTML-<hash>`
  / `LibreWolfURL-<hash>` ProgIDs when the user clicks "Make default")

Before patching, grep the tree again for the current list, since line numbers
move every Firefox release:
```bash
# [\]+ matches one or more literal backslashes, which is portable across grep builds
grep -rniE --include=*.cpp --include=*.h --include=*.mjs --include=*.js \
  'software[\]+mozilla|"mozilla[\]+' toolkit widget browser mozglue | grep -vi test
```

### 7b. Keys the installer writes (bsys6 `assets/setup.nsi`)
This isn't in this repo; it's in bsys6 (§11). Every value needs renaming:

- `HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\LibreWolf LibreWolf`
  (`${COMPANYNAME} ${APPNAME}`) → `Nullpath Nullpath`, or better, a
  single-word key `Nullpath`. Values: DisplayName, UninstallString,
  QuietUninstallString, InstallLocation, DisplayIcon, **Publisher**,
  DisplayVersion.
- `HKLM\Software\Clients\StartMenuInternet\LibreWolf\…` (Capabilities,
  FileAssociations `.htm/.html/.pdf`, URLAssociations `http/https`,
  DefaultIcon, `shell\open\command` → `nullpath.exe`)
- `HKLM\Software\RegisteredApplications` value `LibreWolf`
- `HKLM\Software\Classes\LibreWolfHTM` → `NullpathHTM`, including
  `AppUserModelId "LibreWolf"`, `ApplicationCompany "LibreWolf Community"`,
  `ApplicationDescription "Start the LibreWolf Browser"`
- Start menu folder `$SMPROGRAMS\LibreWolf`, shortcuts, `librewolf.ico`
- **Bugs to fix, not copy:** the uninstaller deletes the whole
  `HKLM\Software\RegisteredApplications` key (every app's registration), and
  runs `RmDir /r $INSTDIR` on whatever directory was chosen. See §2b.4 for the
  corrected NSIS.
- **AppUserModelId must match** what the browser computes at runtime (7a,
  TaskBarIDs). Otherwise pinned taskbar icons and jump lists break. Test by
  pinning to the taskbar and relaunching.

---

## 8. Things that must NOT be renamed

| Item | Why |
|---|---|
| MPL 2.0 headers (`This Source Code Form is subject to…`), `LICENSE` | License requirement |
| Attribution to LibreWolf and Mozilla | Required notice, and honest. Use the statement in §13 |
| `firefox-in-ua.patch` (UA says `Firefox`) and `vendor-name.patch` (`runtime.getBrowserInfo` reports `Firefox`/`Mozilla` by default) | Anti-fingerprinting: Nullpath users should look like Firefox users. Renaming the UA to "Nullpath" makes every user unique. You may rename the *pref* that controls it (`librewolf.getBrowserInfo.setToFirefoxDefaults` → `nullpath.…`), but keep the default `true` |
| `MOZ_APP_ID` GUID | Extension compatibility (§1) |
| `NativeMessagingHosts` under `Software\Mozilla` | Third-party native hosts (§7a) |
| "Firefox" in Mozilla's own strings, e.g. "based on Firefox", `DisableFirefoxStudies` policy names, `FirefoxHome` policy keys | These are API names, not branding |
| Links in `librewolf.cfg` comments to codeberg/librewolf.dev issues | Provenance for why a pref is set. Leave them, since the file stays upstream (§3) |
| LibreWolf's upstream patch file names | Leave them, so upstream merges stay clean |

---

## 9. LibreWolf network endpoints (remove or replace)

These are identity problems **and** traffic that would bypass the future I2P
design. Anything left pointing at LibreWolf infrastructure contacts their
servers from Nullpath users' machines.

| Endpoint | Where | Action |
|---|---|---|
| `https://librewolf.dev/api/v1/repos/librewolf/source/releases` | `themes/browser/base/content/aboutDialog.js:72` (pref `librewolf.aboutMenu.versionCheckGitlabUrl`, gated by `librewolf.aboutMenu.checkVersion`, default false) | Rename the pref to `nullpath.*`. Default the URL to empty, or GitHub releases API later; keep it off by default |
| `update.librewolf.net` | `patches/updater.patch` → `build/moz.build` `MOZ_APPUPDATE_HOST` | Nullpath patch: set it to an empty or unroutable value until Nullpath has its own update service. The updater is disabled in the mozconfig and `policies.json` sets `DisableAppUpdate` + `AppUpdateURL: https://localhost`, but don't leave the hostname compiled in |
| `https://librewolf.dev/librewolf/source/raw/branch/main/assets/uBOAssets.json` | `librewolf.cfg:921`, `patches/custom-ubo-assets-bootstrap-location.patch`, `assets/uBOAssets.json` | Host Nullpath's copy (GitHub raw) or bundle it locally; override in `nullpath.cfg` |
| `app.update.url.manual`, `app.update.url.details`, `app.releaseNotesURL*` | `librewolf.cfg:561-565` | Override in `nullpath.cfg` → GitHub releases |
| `https://support.librewolf.net/` | `librewolf.cfg:624` | Override → GitHub issues or wiki |
| `librewolf.eme.warning.infoURL` → `librewolf.net/docs/faq…` | `librewolf.cfg:412` | Rename the pref and override the URL |
| SupportMenu `https://librewolf.dev/librewolf/issues` | `settings/distribution/policies.json` | Nullpath `policies.json` → GitHub issues, title "Nullpath Issue Tracker" |
| `https://librewolf.net/` link | `aboutDialog.xhtml:45` | → GitHub repo |
| `librewolf.net` HSTS preload entry | `security/manager/ssl/nsSTSPreloadList.inc` | Harmless (a preload list entry, not a request). Leave it |
| `https://librewolf.dev/mirror/firefox-l10n` | `librewolf-patches.py`, **build time only** | OK for now. Nullpath may mirror it later for supply-chain independence |
| **Not LibreWolf, but relevant to I2P later:** DoH resolvers (quad9, mullvad, etc.; `librewolf.cfg:155-210`), `api.beacondb.net` geolocation (`:351`), uBlock Origin install from addons.mozilla.org (`policies.json`), remote settings | — | Leave for the I2P phase, but list them in the I2P design doc |

After the rebrand, verify with `about:networking` and a packet capture (Wireshark
or `pktmon`) that a fresh profile makes **no** request to `*.librewolf.net`,
`*.librewolf.dev` or `codeberg.org` during startup, idle, opening
about:preferences and opening the About dialog.

---

## 10. Pref namespace, settings and UI strings

### 10a. `librewolf.*` prefs → `nullpath.*`
Prefs that exist in code (patched tree):
- `modules/libpref/init/StaticPrefList.yaml` (3 entries) and
  `modules/libpref/moz.build` (the `"librewolf"` pref-group list entry)
- `services/settings/Utils.sys.mjs`: `librewolf.services.settings.allowedCollections`,
  `…allowedCollectionsFromDump`
- `browser/base/content/aboutDialog.js`: `librewolf.aboutMenu.*`
- `toolkit/components/extensions/parent/ext-runtime.js` (vendor-name.patch):
  `librewolf.getBrowserInfo.setToFirefoxDefaults`
- `librewolf.eme.*` (EME patches, `browser/modules/EMEPermissionPrompt.sys.mjs`)
- The preferences pane: `browser/components/preferences/librewolf.js` (38 refs),
  `main.js` (30), `config/privacy.mjs` (29), `config/tabs-browsing.mjs` (28),
  `config/appearance.mjs` (10), `config/account-sync.mjs`, `permissions-data.mjs`,
  `preferences.xhtml`, `preferences.js`, `jar.mn`; `browser/modules/SitePermissions.sys.mjs`;
  `toolkit/components/extensions/parent/ext-storage.js`; `devtools/shared/flags.js`;
  `devtools/server/actors/webconsole/listeners/console-api.js`;
  `browser/extensions/newtab/lib/AboutPreferences.sys.mjs`, `Wallpapers/WallpaperFeed.sys.mjs`;
  `browser/base/content/browser-development-helpers.js`

Doing this as an overlay means one Nullpath patch that renames pref strings
across those files, plus `nullpath.cfg` setting the `nullpath.*` values. Keep
a list of renamed prefs in the patch header. **Rebuild and open every
about:preferences pane afterwards.** A missed rename there silently breaks a
settings toggle.

Also: `librewolf.cfg.version` (cfg line 10) is read by the settings pane to show
the settings version. Decide whether Nullpath shows its own `nullpath.cfg.version`.

### 10b. Autoconfig
- Rename the shipped cfg to `nullpath.cfg`. Recommended structure: ship
  LibreWolf's `librewolf.cfg` content unchanged as the base, and have
  `nullpath.cfg` load it and then apply Nullpath overrides. Autoconfig allows
  only one `general.config.filename`, so either concatenate at prepare time
  (`librewolf.cfg` + `nullpath/settings/nullpath-overrides.cfg` → `nullpath.cfg`)
  or have `nullpath.cfg` read the second file. Concatenating at prepare time is
  simpler and survives upstream merges.
- Update `local-settings.js`, `package-manifest.in`, `lw/moz.build` and the
  copy step to match.
- The header comment in `librewolf.cfg` says "LIBREWOLF SETTINGS" and links the
  LibreWolf FAQ. With concatenation, add a Nullpath header on top instead of
  editing theirs.

### 10c. User-visible strings
- **Locales** `l10n/<locale>/browser/browser/preferences/preferences.inc.ftl`
  (about 40 locales, up to 80 `LibreWolf` mentions each). LibreWolf localizes
  these through Weblate; Nullpath won't. Most strings should use the
  `{ -brand-short-name }` Fluent term, which the branding change fixes
  automatically. Hard-coded "LibreWolf" text needs a rewrite pass: script it
  per locale at prepare time, and review en-US by hand.
- `librewolf-patches.py` runs `sed s/Firefox/LibreWolf/` on every
  `appstrings.properties`. Nullpath's step should run
  `s/LibreWolf/Nullpath/` on those files after it.
- `patches/ui-patches/settings-redesign.patch` (80 refs), `pref-pane/*`,
  `privacy-preferences.patch`, `neterror.patch`, `pref-naming.patch`,
  `home-preferences.patch`: check the patched tree output rather than the
  patch files.
- `policies.json`: `"blocked_install_message": "LibreWolf does not allow…"`.
- Installer welcome text (bsys6, §11).

---

## 11. Packaging: fork bsys6

`https://librewolf.dev/librewolf/bsys6` makes the Windows setup.exe, portable
zip, MSIX and Chocolatey package. It is Linux/Docker-based. Given the owner's
**Windows-only** requirement, the recommended path is **not** to fork bsys6
wholesale, but to port only the NSIS installer:

- Take `assets/setup.nsi`, `assets/banner.bmp`, `assets/librewolf.ico` and
  `assets/nsProcess.dll` into `nullpath/installer/`. Rename everything per §7b.
  Build with the `makensis` that `mach bootstrap` installs into `~/.mozbuild/nsis`.
- Add a `setup` step to `scripts/windows-build.sh` that repackages
  `obj-*/dist/*.zip` into `nullpath-<ver>-windows-x86_64-setup.exe`.
- Firefox's own NSIS installer (`mach build installer`, using `branding.nsi`)
  is an alternative. It does more (proper default-browser registration,
  per-user install) but is heavier. Evaluate it.

**Don't carry over from bsys6:**
- `src/setup.sh`'s signing loop, which downloads and runs a third-party
  `Signed` binary. Use `./scripts/windows-build.sh sign` and Nullpath's own
  certificate instead (§2b.3). After `makensis`, sign the setup `.exe` with the
  same `signtool` invocation.
- The uninstaller section as written (§2b.4).
- LibreWolf's MAR update-signing keys. They're guarded today, and replaced by
  `nullpath/keys/` when Nullpath enables updates (§2b.2).
- `src/winupdater.sh` and `portable.sh` download LibreWolf's
  WinUpdater and Portable launcher from their forge. Skip both for now.
- `FORGE_URL`/`FORGE_REPO_OWNER`, S3 artifact upload, MS Store and Chocolatey
  publishing.
- `assets/*.profdata` (PGO profiles): optional. Using LibreWolf's is harmless
  for performance, but Nullpath builds work without them.

---

## 12. Repo and tooling hygiene

- `Makefile`, `scripts/librewolf-patches.py` and the directory names
  `librewolf-<ver>-<rel>` / `librewolf-<ver>-<rel>.source.tar.gz`: leave as they
  are (upstream files), but make Nullpath's own tooling (`windows-build.sh`,
  new scripts) use `nullpath-*` names for **outputs**. The name of the working
  directory doesn't matter to users.
- `README.md` is LibreWolf's. Add `README.nullpath.md`, or replace it on the
  Nullpath branch and expect trivial conflicts. It needs: what Nullpath is, the
  §13 statement, Windows build steps, and a "not anonymous yet" warning.
- `.forgejo/workflows/*.yaml` run on LibreWolf's `epsilon` runners and push to
  their package registry. Disable them on the fork (GitHub ignores `.forgejo/`,
  but don't copy them into `.github/`). A Windows GitHub Actions build is
  possible later; a full build takes hours, so plan around the time limits.
- `assets/testing.mk` clones LibreWolf's bsys6. Not used on Windows.

---

## 13. Attribution statement

Use this wording (from the project brief) in the About dialog, README,
installer welcome page and release notes:

> Nullpath is an independent browser based on LibreWolf and Mozilla's
> open-source Firefox technology. It is not affiliated with Mozilla or the
> LibreWolf project.

Mozilla trademark: the product must not be called "Firefox", and Mozilla
logos must not ship. LibreWolf already removes them; don't bring any back from
the Firefox branding directories.

---

## 14. Suggested commit sequence (`feature/nullpath-branding`)

1. `build: native Windows build support` (`librewolf-patches.py` Windows
   fixes, `windows-build.sh` fetch→run, plus `windows-build.ps1`). Could also go
   on `build/windows-native` and be merged.
2. `build: Nullpath overlay layer, MAR key guard, signing step`
   (`apply_nullpath_layer`, `check_update_keys`, `do_sign`, `nullpath/`).
   *Written and tested; uncommitted.*
3. `fix: key Windows uninstall-reset value off the app name`
   (`windows-uninstall-reset-key.patch`, §2b.1). *Written and tested; uncommitted.*
4. `branding: app name, vendor, profile, remoting name`. Build, run, check
   §6/§7 paths.
5. `branding: nullpath branding directory (names + placeholder icons)`.
6. `branding: DBus/app ID → org.nullpath` (Linux; low priority).
7. `branding: registry parent key Mozilla → Nullpath` (§7a; carry §2b.1 along).
8. `settings: nullpath.cfg overlay + endpoint overrides` (§9, §10b).
9. `branding: rename librewolf.* prefs → nullpath.*` (§10a).
10. `l10n: replace hard-coded LibreWolf strings` (§10c).
11. `installer: Nullpath NSIS setup with the §2b.4 fixes` (§11, §7b), signed
    with `signtool`.
12. `docs: README and attribution`.

Build and smoke-test after steps 3, 4, 5, 7, 8, 9 and 11. A full build takes
hours, but an incremental `./mach build` after small changes is much faster.
For JS/FTL/pref-only changes, `./mach build faster` is often enough.

---

## 15. Verification checklist

Automated audit, run on the **patched tree** after `prepare`:
```bash
cd librewolf-156.0.1-1
# Anything left is either on the §8 allow-list or a bug.
grep -rniE 'librewolf|io\.gitlab\.' . \
  --exclude-dir=mobile --exclude-dir=obj-x86_64-pc-windows-msvc \
  | grep -v 'io.gitlab.arturbosch'          # detekt: Android tooling, false positive
```
On the build output:
```bash
grep -rlai librewolf /d/nullpath/obj/dist/bin | head   # ideally only allow-listed hits
```

Manual, on Windows, with a fresh profile (`./scripts/windows-build.sh run`, or
unzip `dist/*.zip` and run `nullpath.exe`):
- [ ] Exe is `nullpath.exe`. File Properties → Details shows Nullpath
      (product name, company).
- [ ] Window title, taskbar tooltip, Alt-Tab and the Start/pinned icon show
      Nullpath and its icon.
- [ ] About dialog: Nullpath name and logo, version `156.0.1-1`, attribution
      text, no LibreWolf link.
- [ ] `about:support`: Application Basics shows Name `Nullpath`; profile folder
      is under `%APPDATA%\nullpath\`.
- [ ] Every about:preferences pane loads with no console errors (Browser
      Console, Ctrl+Shift+J), and the Nullpath settings pane toggles work.
- [ ] `%APPDATA%\librewolf`, `%LOCALAPPDATA%\librewolf` and
      `%USERPROFILE%\.librewolf` are **not** created (delete them first if an
      earlier LibreWolf build left them).
- [ ] Registry: before and after first launch, and after "Make default browser":
      ```
      reg query HKCU\Software /s /f librewolf
      reg query HKLM\Software /s /f librewolf
      reg query HKCU\Software\Mozilla /s
      ```
      No LibreWolf keys. Only the §8-allowed `Mozilla` keys remain.
      Process Monitor, filtered on the process name, gives a complete list of
      registry and file writes.
- [ ] Taskbar: pin, close, relaunch. There should be one icon, not two
      (AppUserModelID consistency).
- [ ] Network: see the end of §9.
- [ ] UA (`about:support` or a local test page) still reports Firefox 156.
- [ ] Installer: installs, shows in Apps & Features as Nullpath with the right
      publisher, registers as a browser in Default Apps, uninstalls cleanly,
      and leaves `HKLM\Software\RegisteredApplications` otherwise intact.
- [ ] §2b.1: a planted `HKCU\Software\Mozilla\Firefox` `Uninstalled-release`
      value survives a Nullpath launch, and no reset prompt appears.
- [ ] §2b.2: `prepare` and `build` pass the MAR key guard. If the updater is
      enabled, `toolkit/mozapps/update/updater/release_*.der` match
      `nullpath/keys/`, not `assets/marsigner*.der`.
- [ ] §2b.3: on signed releases, `signtool verify /pa /all` passes for every
      `.exe`/`.dll` and for the installer, and the signer is Nullpath.
- [ ] §2b.4: the uninstaller keeps unrelated files in a shared install folder
      and other apps' `RegisteredApplications` values.

---

## 16. Updating from LibreWolf later

```bash
git fetch librewolf --tags --prune
git switch main && git merge --ff-only librewolf/main && git push origin main
git switch feature/nullpath-branding && git rebase main
./scripts/windows-build.sh prepare     # all LibreWolf + Nullpath patches must apply
```
If a Nullpath patch stops applying, regenerate it against the new
post-LibreWolf tree (§3). Re-run the §15 audit every time: new LibreWolf
releases add new `librewolf.*` prefs and strings.

Release builds start from a LibreWolf **tag** (e.g. `156.0.1-1`), not
`main`. Tag them `nullpath-156.0.1-1`, sign the artifacts, publish checksums,
and never publish an untested upstream merge. Keep a `CHANGELOG.md` with the
LibreWolf base version, the Mozilla security fixes it includes, Nullpath
changes and known limitations.

---

## 17. Open questions for the owner

1. **Logo and icon artwork:** none exists yet.
2. **Website/domain:** GitHub URLs are used until there is one.
3. **Code signing:** an OV/EV certificate on a hardware token, or Azure
   Trusted Signing (§2b.3). The `sign` step is ready for a certificate-store
   certificate. Also: generate MAR keys now, or keep the updater off (§2b.2).
4. **Group Policy path:** `Software\Policies\Nullpath` (recommended) or
   `Software\Policies\Mozilla\Nullpath`.
5. **Installer:** port bsys6's small NSIS script (recommended to start) or use
   Firefox's full installer.
