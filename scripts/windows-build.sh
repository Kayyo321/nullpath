#!/usr/bin/env bash
#
# Native Windows build (no WSL, no Docker).
#
#   fetch     - download the Firefox source tarball and verify Mozilla's signature
#   prepare   - extract it and apply the LibreWolf patches (librewolf-<version>-<release>/)
#   bootstrap - let mach install the Windows toolchains (clang-cl, Windows SDK, Rust, ...)
#   build     - ./mach build
#   fast      - re-copy nullpath/tree-overrides and the settings into the tree,
#               then ./mach build faster (JS/CSS/FTL/SVG/prefs only; seconds).
#               Use 'build' after changing moz.build, components.conf, C++/Rust,
#               patches or build flags.
#   package   - ./mach package  (produces a .zip under $OBJDIR/dist/, default D:/nullpath/obj)
#   sign      - Authenticode-sign every .exe/.dll in the package with signtool
#               (see docs/nullpath/REBRAND-HANDOFF.md, "Code signing")
#   run       - start the built browser with a throwaway profile
#   all       - fetch prepare bootstrap build package
#
# fetch and prepare work from Git Bash or MozillaBuild. The mach steps must run
# inside MozillaBuild (C:\mozilla-build\start-shell.bat); scripts/windows-build.ps1
# takes care of that when called from PowerShell.
#
# prepare applies the LibreWolf patches and then the Nullpath layer listed in
# nullpath/patches.txt. Set NULLPATH_BASELINE=1 to skip the Nullpath layer and
# get an unmodified LibreWolf tree.
#
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")/.."
ROOT="$(pwd)"

version="$(cat version)"
release="$(cat release)"
ff_tarball="firefox-$version.source.tar.xz"
ff_url="${FF_BASE_URL:-https://archive.mozilla.org/pub/firefox/releases}/$version/source/$ff_tarball"
lw_dir="librewolf-$version-$release"

# Build output directory. Keep it short: GNU make on Windows isn't long-path
# aware, and the xul.dll link step names objects as ../../../<deep path>, which
# exceeded MAX_PATH (260) with the default <srcdir>/obj-x86_64-pc-windows-msvc.
OBJDIR="${NULLPATH_OBJDIR:-$(cygpath -m "$(dirname "$ROOT")")/obj}"

# Mozilla Software Releases signing key (same fingerprint as the Makefile)
MOZ_KEY_FPR="14F26682D0916CDD81E37B6D61B7B526D98F0353"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

require_mozillabuild() {
  [ -n "${MOZILLABUILD:-}" ] || die "'$1' must run inside MozillaBuild (use scripts/windows-build.ps1 or C:\\mozilla-build\\start-shell.bat)"
}

do_fetch() {
  if [ -f "$ff_tarball" ] && [ -f "$ff_tarball.asc" ]; then
    log "Using existing $ff_tarball"
  else
    log "Downloading $ff_url"
    curl -sSfL --retry 3 -o "$ff_tarball.asc" "$ff_url.asc"
    curl -sSfL --retry 3 -o "$ff_tarball.part" "$ff_url"
    mv "$ff_tarball.part" "$ff_tarball"
  fi

  log "Verifying signature"
  # Throwaway keyring so we don't touch the user's GnuPG setup.
  local gnupghome status
  gnupghome="$(mktemp -d)"
  curl -fsSL "https://keys.openpgp.org/vks/v1/by-fingerprint/$MOZ_KEY_FPR" |
    GNUPGHOME="$gnupghome" gpg --batch --quiet --import
  status="$(GNUPGHOME="$gnupghome" gpg --batch --status-fd 1 --verify "$ff_tarball.asc" "$ff_tarball" 2>/dev/null || true)"
  rm -rf "$gnupghome"
  # VALIDSIG's last field is the primary key fingerprint; require it to be Mozilla's.
  grep -q "^\[GNUPG:\] VALIDSIG .* $MOZ_KEY_FPR\$" <<<"$status" ||
    die "$ff_tarball is not signed by Mozilla's release key ($MOZ_KEY_FPR)"
  echo "Good signature from Mozilla release key $MOZ_KEY_FPR"
}

do_prepare() {
  [ -f "$ff_tarball" ] || do_fetch

  # Fetch locales first: it's the step most likely to fail, so fail before the slow extract.
  fetch_l10n

  if [ -d "$lw_dir" ]; then
    log "Removing previous $lw_dir"
    rm -rf "$lw_dir"
  fi
  rm -rf "firefox-$version"
  log "Extracting $ff_tarball (this takes a while on NTFS)"
  tar xf "$ff_tarball" --checkpoint=20000 --checkpoint-action='echo=  %{r}T read'
  mv "firefox-$version" "$lw_dir"

  log "Copying Firefox locales into $lw_dir/lw/l10n"
  mkdir -p "$lw_dir/lw"
  cp -r "$L10N_CACHE" "$lw_dir/lw/l10n"
  rm -rf "$lw_dir/lw/l10n/.git" "$lw_dir/lw/l10n/.github" "$lw_dir/lw/l10n/LICENSE" "$lw_dir/lw/l10n/README"

  log "Applying LibreWolf patches"
  SKIP_FETCHING_LOCALES=1 NULLPATH_BASH="$(cygpath -w "$BASH")" \
    python scripts/librewolf-patches.py "$version" "$release"

  # librewolf-patches.py stamps the version into assets/mozconfig.new in place;
  # put the tracked file back so the repo stays clean and re-runs don't stack it.
  git checkout -- assets/mozconfig.new

  fix_mozconfig_paths
  apply_nullpath_layer
  check_update_keys
}

# LibreWolf's mozconfig has `--with-l10n-base=$PWD/lw/l10n`. Under MSYS, $PWD is
# /d/..., which configure (native Windows Python) can't resolve. Pin the
# absolute Windows-style path instead. Idempotent.
fix_mozconfig_paths() {
  local win_srcdir
  win_srcdir="$(cygpath -m "$ROOT/$lw_dir")"
  sed -i "s|^ac_add_options --with-l10n-base=\$PWD/|ac_add_options --with-l10n-base=$win_srcdir/|" "$lw_dir/mozconfig"

  sed -i '/^mk_add_options MOZ_OBJDIR=/d' "$lw_dir/mozconfig"
  echo "mk_add_options MOZ_OBJDIR=$OBJDIR" >>"$lw_dir/mozconfig"

  grep -E '^ac_add_options --with-l10n-base=|^mk_add_options MOZ_OBJDIR=' "$lw_dir/mozconfig"
}

# librewolf-patches.py would `git clone` the Firefox locales from LibreWolf's
# mirror into a temp dir on every prepare, with no timeout. That mirror serves
# ~30 KB/s, so the clone looks hung. Use Mozilla's own repository instead (the
# mirror tracks it commit-for-commit), keep a cached shallow clone (ignored via
# /firefox-* in .gitignore), abort stalled transfers, and retry / fall back.
L10N_URLS=(
  "${NULLPATH_L10N_URL:-https://github.com/mozilla-l10n/firefox-l10n}"
  "https://librewolf.dev/mirror/firefox-l10n"
)
L10N_CACHE="firefox-l10n-cache"

fetch_l10n() {
  local -a git_net=(-c http.lowSpeedLimit=1024 -c http.lowSpeedTime=300)
  local url attempt
  for url in "${L10N_URLS[@]}"; do
    for attempt in 1 2; do
      log "Fetching Firefox locales from $url (attempt $attempt/2)"
      if [ -d "$L10N_CACHE/.git" ]; then
        if git "${git_net[@]}" -C "$L10N_CACHE" fetch --progress --depth=1 "$url" HEAD &&
           git -C "$L10N_CACHE" reset -q --hard FETCH_HEAD; then
          echo "locales at $(git -C "$L10N_CACHE" rev-parse --short HEAD)"
          return 0
        fi
      else
        rm -rf "$L10N_CACHE"
        if git "${git_net[@]}" clone --progress --depth=1 "$url" "$L10N_CACHE"; then
          echo "locales at $(git -C "$L10N_CACHE" rev-parse --short HEAD)"
          return 0
        fi
      fi
      echo "locale fetch failed or stalled; retrying in 15s"
      sleep 15
    done
  done
  die "could not fetch locales from any of: ${L10N_URLS[*]}"
}

apply_nullpath_layer() {
  if [ -n "${NULLPATH_BASELINE:-}" ]; then
    log "NULLPATH_BASELINE is set: skipping the Nullpath layer (unmodified LibreWolf)"
    return
  fi

  log "Applying Nullpath patches"
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    line="$(sed -e 's/#.*//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' <<<"$line")"
    [ -n "$line" ] || continue
    echo "*** -> $line"
    (cd "$lw_dir" && patch -p1 --no-backup-if-mismatch -i "../nullpath/$line") ||
      die "Nullpath patch failed to apply: $line"
  done <nullpath/patches.txt

  python scripts/nullpath-overlay.py "$lw_dir"

  # Nullpath's own MAR update-signing *public* keys, if generated (never commit
  # the private keys). These replace the LibreWolf keys librewolf-patches.py copied in.
  local updater_dir="$lw_dir/toolkit/mozapps/update/updater" k
  for k in primary secondary; do
    if [ -f "nullpath/keys/release_$k.der" ]; then
      cp -v "nullpath/keys/release_$k.der" "$updater_dir/release_$k.der"
    fi
  done
}

# librewolf-patches.py copies LibreWolf's MAR update-signing public keys into the
# tree. They are inert while the updater is disabled (toolkit/moz.build only
# builds it when MOZ_UPDATER is set), but an updater built with them would accept
# updates signed by LibreWolf. Refuse that combination.
check_update_keys() {
  local mozconfig="$lw_dir/mozconfig" updater=enabled opt
  # Firefox builds the updater by default; the last --enable/--disable-updater wins.
  opt="$(grep -Eo -- '--(enable|disable)-updater' "$mozconfig" | tail -n 1 || true)"
  [ "$opt" = "--disable-updater" ] && updater=disabled
  [ "$updater" = enabled ] || return 0

  local updater_dir="$lw_dir/toolkit/mozapps/update/updater"
  if cmp -s "$updater_dir/release_primary.der" assets/marsigner.der ||
     cmp -s "$updater_dir/release_secondary.der" assets/marsigner2.der; then
    die "the updater is enabled but still trusts LibreWolf's MAR keys; add Nullpath keys to nullpath/keys/ (see REBRAND-HANDOFF.md, 'Update signing keys')"
  fi
}

do_bootstrap() {
  require_mozillabuild bootstrap
  [ -d "$lw_dir" ] || do_prepare
  log "Bootstrapping toolchains into ~/.mozbuild"
  (cd "$lw_dir" && ./mach --no-interactive bootstrap --application-choice=browser)
}

do_build() {
  require_mozillabuild build
  [ -d "$lw_dir" ] || die "$lw_dir not found; run 'prepare' first"
  fix_mozconfig_paths
  check_update_keys
  log "Building (expect 1-3 hours on first build)"
  (cd "$lw_dir" && ./mach build)
  sccache_stats
}

# The overlay adds --with-ccache=sccache to the mozconfig. sccache's default
# 10 GB cache is too small to hold a whole Firefox build.
export SCCACHE_CACHE_SIZE="${SCCACHE_CACHE_SIZE:-30G}"

sccache_stats() {
  local sccache="$HOME/.mozbuild/sccache/sccache.exe"
  [ -x "$sccache" ] && "$sccache" --show-stats | grep -E '^(Compile requests|Cache hits|Cache misses|Cache size|Max cache size)' || true
}

do_fast() {
  require_mozillabuild fast
  [ -d "$OBJDIR/backend.FasterMakeBackend" ] || [ -f "$OBJDIR/backend.FasterMakeBackend" ] ||
    die "no build in $OBJDIR yet; run 'build' first"
  log "Copying Nullpath files into $lw_dir"
  python scripts/nullpath-overlay.py "$lw_dir"
  log "Rebuilding front-end files only"
  (cd "$lw_dir" && ./mach build faster)
}

do_package() {
  require_mozillabuild package
  log "Packaging"
  (cd "$lw_dir" && ./mach package)
  ls -l "$OBJDIR"/dist/*.zip
}

find_signtool() {
  if [ -n "${NULLPATH_SIGNTOOL:-}" ]; then
    echo "$NULLPATH_SIGNTOOL"
    return
  fi
  command -v signtool.exe 2>/dev/null && return
  # Newest x64 signtool from the Windows SDK (bootstrapped copy first, then a system SDK).
  ls -1d "$HOME"/.mozbuild/vs/*/bin/*/x64/signtool.exe \
    "/c/Program Files (x86)/Windows Kits/10/bin/"*/x64/signtool.exe 2>/dev/null |
    sort -V | tail -n 1 || true
}

# Authenticode-sign the packaged build with the Nullpath code-signing certificate.
#   NULLPATH_SIGN_CERT_SHA1      thumbprint of the certificate in the Windows
#                                certificate store (hardware token / HSM backed)
#   NULLPATH_SIGN_TIMESTAMP_URL  RFC 3161 timestamp server from your CA
#   NULLPATH_SIGNTOOL            optional path to signtool.exe
do_sign() {
  : "${NULLPATH_SIGN_CERT_SHA1:?set NULLPATH_SIGN_CERT_SHA1 to the signing certificate thumbprint}"
  : "${NULLPATH_SIGN_TIMESTAMP_URL:?set NULLPATH_SIGN_TIMESTAMP_URL to the RFC 3161 timestamp URL of your CA}"

  local signtool zip staging signed
  signtool="$(find_signtool)"
  [ -n "$signtool" ] && [ -f "$signtool" ] || die "signtool.exe not found; set NULLPATH_SIGNTOOL"
  zip="$(ls -1 "$OBJDIR"/dist/*.win64.zip 2>/dev/null | grep -v '\.signed\.zip$' | head -n 1 || true)"
  [ -n "$zip" ] || die "no package found; run 'package' first"
  signed="${zip%.zip}.signed.zip"

  staging="$(mktemp -d)"
  log "Signing $(basename "$zip") with $signtool"
  python -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$zip" "$staging"

  local -a files=()
  while IFS= read -r -d '' f; do files+=("$(cygpath -w "$f")"); done \
    < <(find "$staging" -type f \( -iname '*.exe' -o -iname '*.dll' \) -print0)
  [ "${#files[@]}" -gt 0 ] || die "no .exe/.dll files found in $zip"

  # Stop MSYS from rewriting signtool's /switches into paths.
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' "$signtool" sign \
    /fd sha256 /td sha256 /tr "$NULLPATH_SIGN_TIMESTAMP_URL" \
    /sha1 "$NULLPATH_SIGN_CERT_SHA1" "${files[@]}"
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' "$signtool" verify /pa /q "${files[@]}" ||
    die "signature verification failed"

  rm -f "$signed"
  python -c 'import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, names in os.walk(src):
        for n in names:
            p = os.path.join(root, n)
            z.write(p, os.path.relpath(p, src))' "$staging" "$signed"
  rm -rf "$staging"
  echo "Signed ${#files[@]} files -> $signed"
}

do_run() {
  require_mozillabuild run
  (cd "$lw_dir" && ./mach run --temp-profile)
}

[ "$#" -gt 0 ] || set -- all
for step in "$@"; do
  case "$step" in
    fetch|prepare|bootstrap|build|fast|package|sign|run) "do_$step" ;;
    all) do_fetch; do_prepare; do_bootstrap; do_build; do_package ;;
    *) die "unknown step '$step' (fetch prepare bootstrap build fast package sign run all)" ;;
  esac
done
