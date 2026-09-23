# Nullpath build handoff

**Status (2026-09-22, evening):** The native Windows build and package succeed. `D:\nullpath\obj\dist\` contains `nullpath-156.0.1-1.en-US.win64.zip` and `nullpath-156.0.1-1.en-US.win64.installer.exe`; the latest log is `D:\nullpath\build-logs\nullpath-build3.log`. The older `librewolf-156.0.1-1.*` files in `dist\` are leftovers from before the rebrand.

## What changed

- The supplied `Logo.png` and `LogoIcon.png` are now in `nullpath/artwork/`.
- Generated browser icons, About screen images, Windows tiles, and installer graphics are in `nullpath/branding/`; sidebar and preferences icons are in `nullpath/tree-overrides/`.
- `scripts/nullpath-overlay.py` copies those assets into the prepared source tree and applies the current Nullpath identity and settings changes. `scripts/windows-build.sh prepare` runs that overlay after LibreWolf's patches.
- Integration issues found by the build, all fixed in the overlay:
  - `MOZ_APP_VENDOR` cannot be exported from `mozconfig`.
  - Renamed static preferences must remain alphabetically ordered with their C++ WebGL callers updated.
  - The `librewolf.` → `nullpath.` pref-key rename must not touch file names that keep their upstream names (`librewolf.inc.xhtml`, `librewolf.js`, `librewolf.css`, `category-librewolf.svg`, `aboutdebugging-firefox-librewolf.svg`). The overlay now skips those and repairs trees rewritten by earlier versions.
  - LibreWolf inlines its wolf logo into `browser/base/content/aboutDialog.css`; the overlay points it at `chrome://branding/content/about-logo.svg`.
- The overlay now writes a file only when its content changes, so rerunning it on a prepared tree doesn't trigger a broad rebuild. It also fails loudly if `rg` errors instead of silently skipping the rename pass.

## Verified

- The package contains `nullpath.exe`, `nullpath.cfg` and `distribution/policies.json`; `application.ini` reports `Name=Nullpath`, `RemotingName=nullpath`, `Profile=nullpath`.
- All seven images from `nullpath/branding/firefox.ico` are embedded in `nullpath.exe`; the About images and `icon16`–`icon128` in `omni.ja` match `nullpath/branding/`.
- Launched with a fresh profile: the window title is "Nullpath" and the new tab page shows the Nullpath logo and wordmark. Settings shows "About Nullpath" and "Nullpath support". The About dialog shows the Nullpath logo, version, attribution and repository link.

## Open items

1. The About dialog's "Nullpath" title still uses LibreWolf's blue (`#00acff`) from `aboutDialog.css`; decide on a Nullpath color.
2. Settings still says "Enable Firefox Sync" (an upstream LibreWolf string).
3. During one windowed smoke test the first tab went to google.com. No Nullpath setting sets that, and the window was visible on the desktop, so it was probably a manual click. Re-check on a clean run.
4. The installer has not been run, and nothing is code-signed (see REBRAND-HANDOFF.md).

## Rebuilding

After changing the overlay, apply it and rebuild in MozillaBuild:

```powershell
python scripts/nullpath-overlay.py librewolf-156.0.1-1
$env:USE_MINTTY = '0'
& 'C:\mozilla-build\start-shell.bat' -c 'cd /d/nullpath/librewolf-source && ./scripts/windows-build.sh build package'
```

Avoid `prepare` for a routine retry: it recreates the extracted source tree and will force a broader rebuild. All repository changes above are uncommitted.

When only front-end files changed (anything under `nullpath/tree-overrides` that is JS, CSS, Fluent, SVG or HTML, or `nullpath/settings`), use the `fast` step instead. It re-runs the overlay and then `mach build faster`, which takes seconds to a minute:

```powershell
& 'C:\mozilla-build\start-shell.bat' -c 'cd /d/nullpath/librewolf-source && ./scripts/windows-build.sh fast'
```

Use `build` after changing a `moz.build`, `components.conf`, C++ or Rust, patches or build flags.

The overlay turns on sccache (`--with-ccache=sccache`, installed by `mach bootstrap`), and `windows-build.sh` sets a 30 GB cache (`SCCACHE_CACHE_SIZE`). The first build after this change still compiles everything and fills the cache. Later full rebuilds, including those after `prepare`, reuse the cached objects for every file that didn't change. `build` prints the cache hit counts at the end.

Mach limits its terminal output when it detects a coding agent (`CLAUDECODE` in the environment), and the real error can go missing. Run it as `env -u CLAUDECODE ./scripts/windows-build.sh build` to get the full log.
