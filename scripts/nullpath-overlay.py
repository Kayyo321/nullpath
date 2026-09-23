"""Apply Nullpath's product identity after LibreWolf's upstream patch series."""

from pathlib import Path
import json
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
TREE = Path(sys.argv[1]).resolve()
REPO = "https://github.com/Kayyo321/nullpath"
ATTRIBUTION = (
    "Nullpath is an independent browser based on LibreWolf and Mozilla's "
    "open-source Firefox technology. It is not affiliated with Mozilla or "
    "the LibreWolf project."
)
# File names such as librewolf.inc.xhtml or category-librewolf.svg keep their
# upstream names, so references to them must survive the pref-key rename.
FILE_REF = r"(?:inc\.xhtml|js|css|svg)(?![\w.])"


def write(path, data):
    """Write only on change, so reruns don't invalidate the incremental build."""
    if not path.exists() or path.read_text(encoding="utf-8") != data:
        path.write_text(data, encoding="utf-8", newline="\n")


def replace(path, changes):
    path = TREE / path
    data = path.read_text(encoding="utf-8")
    for old, new in changes:
        if old not in data and new in data:
            continue
        if old not in data:
            raise RuntimeError(f"{path}: expected text missing: {old!r}")
        data = data.replace(old, new)
    write(path, data)


# Configure identity. Keep Firefox's MOZ_APP_ID and UA compatibility intact.
replace("mozconfig", [
    ("--with-app-name=librewolf", "--with-app-name=nullpath"),
    ("--with-branding=browser/branding/librewolf", "--with-branding=browser/branding/nullpath"),
    ("export MOZ_APP_REMOTINGNAME=LibreWolf", "export MOZ_APP_REMOTINGNAME=nullpath"),
])
mozconfig = TREE / "mozconfig"
data = mozconfig.read_text(encoding="utf-8")
data = data.replace("export MOZ_APP_VENDOR=Nullpath\n", "")
data = data.replace("export MOZ_APP_PROFILE=nullpath\n", "")
# Fail-closed routing (docs/nullpath/I2P-ROUTER-TOGGLE.md §8.1): no channel may
# bypass the proxy, and the code that retries system requests directly after
# a proxy failure is compiled out.
#
# --with-ccache=sccache: cache compiler output (sccache comes with mach
# bootstrap), so rebuilds after `prepare` or a flag change reuse unchanged files.
for option in ("--enable-proxy-bypass-protection", "--disable-proxy-direct-failover",
               "--with-ccache=sccache"):
    if f"ac_add_options {option}\n" not in data:
        data = data.rstrip("\n") + f"\nac_add_options {option}\n"
write(mozconfig, data)
replace("toolkit/moz.configure", [("default=\"LibreWolf\"", "default=\"Nullpath\""),
                                  ("default=\"librewolf\"", "default=\"nullpath\"")])

# Copy the upstream branding layout, then replace its identity. The artwork is
# replaced by a separate, visibly temporary asset set before any release.
brand = TREE / "browser/branding/nullpath"
upstream_brand = TREE / "browser/branding/librewolf"
BRAND_TEXT = {".ftl", ".properties", ".dtd", ".js", ".nsi", ".xml", ".svg", ".sh"}
shutil.copytree(upstream_brand, brand, dirs_exist_ok=True,
                ignore=lambda d, names: [n for n in names if Path(n).suffix in BRAND_TEXT])
for source in upstream_brand.rglob("*"):
    rel = source.relative_to(upstream_brand)
    if not source.is_file() or source.suffix not in BRAND_TEXT or (ROOT / "nullpath/branding" / rel).exists():
        continue
    data = source.read_text(encoding="utf-8")
    data = data.replace("https://librewolf.net/", REPO).replace("https://librewolf.dev", REPO)
    data = data.replace("LibreWolf", "Nullpath").replace("librewolf", "nullpath")
    (brand / rel).parent.mkdir(parents=True, exist_ok=True)
    write(brand / rel, data)
shutil.copytree(ROOT / "nullpath/branding", brand, dirs_exist_ok=True)
shutil.copytree(ROOT / "nullpath/tree-overrides", TREE, dirs_exist_ok=True)

replace("browser/base/content/aboutDialog.xhtml", [
    ("LibreWolf</label>", "Nullpath</label>"),
    ("https://librewolf.net/", REPO),
    ('data-l10n-id="about-librewolf"', 'value="' + ATTRIBUTION + '"'),
])
# LibreWolf inlines its wolf logo into the About dialog; use the branding logo.
about_css = TREE / "browser/base/content/aboutDialog.css"
write(about_css, re.sub(r'url\("data:image/svg\+xml;base64,[^"]*"\)',
                        'url("chrome://branding/content/about-logo.svg")',
                        about_css.read_text(encoding="utf-8")))
replace("browser/base/content/aboutDialog.js", [
    ("librewolf.aboutMenu.", "nullpath.aboutMenu."),
    ("https://librewolf.dev/api/v1/repos/librewolf/source/releases", ""),
])
replace("build/moz.build", [("update.librewolf.net", "localhost")])
replace("dom/canvas/ClientWebGLContext.cpp", [
    ("StaticPrefs::librewolf_webgl_prompt", "StaticPrefs::nullpath_webgl_prompt"),
])
replace("extensions/pref/autoconfig/src/prefcalls.js", [
    (".librewolf", ".nullpath"),
    ("/librewolf/librewolf/", "/nullpath/nullpath/"),
])
replace("toolkit/xre/nsXREDirProvider.cpp", [
    ('"LibreWolf"', '"Nullpath"'),
    ('.librewolf', '.nullpath'),
    ('/share/librewolf/', '/share/nullpath/'),
])
for name in [
    "widget/windows/WinTaskbar.cpp",
    "toolkit/mozapps/update/common/commonupdatedir.cpp",
    "toolkit/mozapps/update/common/pathhash.cpp",
    "toolkit/components/utils/WindowsInstallsInfo.sys.mjs",
    "browser/components/shell/StartupOSIntegration.sys.mjs",
    "browser/components/BrowserGlue.sys.mjs",
]:
    path = TREE / name
    data = path.read_text(encoding="utf-8")
    updated = data.replace("Software\\\\Mozilla\\\\", "Software\\\\Nullpath\\\\")
    updated = updated.replace("SOFTWARE\\\\Mozilla\\\\", "SOFTWARE\\\\Nullpath\\\\")
    updated = updated.replace('"Mozilla\\\\" + Services.appinfo.name', '"Nullpath\\\\" + Services.appinfo.name')
    write(path, updated)

# Runtime directories and the install-root autoconfig name.
replace("browser/installer/package-manifest.in", [("@RESPATH@/librewolf.cfg", "@RESPATH@/nullpath.cfg")])
replace("lw/moz.build", [('\"librewolf.cfg\"', '\"nullpath.cfg\"')])
replace("lw/local-settings.js", [("librewolf.cfg", "nullpath.cfg")])

cfg = (ROOT / "settings/librewolf.cfg").read_text(encoding="utf-8")
cfg = cfg.replace("librewolf.", "nullpath.")
overrides = (ROOT / "nullpath/settings/nullpath-overrides.cfg").read_text(encoding="utf-8")
write(TREE / "lw/nullpath.cfg",
      "// NULLPATH SETTINGS: LibreWolf base followed by Nullpath overrides.\n"
      + cfg + "\n" + overrides)

policies = json.loads((TREE / "lw/policies.json").read_text(encoding="utf-8"))
def scrub(value):
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items()}
    if isinstance(value, list):
        return [scrub(v) for v in value]
    if isinstance(value, str):
        return value.replace("LibreWolf", "Nullpath").replace("https://librewolf.dev/librewolf/issues", REPO + "/issues")
    return value
policies = scrub(policies)

# Bundle uBlock Origin instead of downloading it from addons.mozilla.org at
# first run (I2P-ROUTER-TOGGLE.md §8.5): I2P profiles must not reach AMO.
# Put the signed .xpi in nullpath/extensions/ and its SHA-256 in
# nullpath/extensions/SHA256SUMS ("<hash>  <file>"). Without it, the AMO
# install_url stays; I2P profiles then block that request (fail-closed) and
# only Direct web installs uBO.
UBO_ID = "uBlock0@raymondhill.net"
ubo_xpi = ROOT / "nullpath/extensions" / f"{UBO_ID}.xpi"
if ubo_xpi.exists():
    import hashlib
    sums = (ROOT / "nullpath/extensions/SHA256SUMS").read_text(encoding="utf-8")
    expected = {n.strip(): h for h, n in (l.split(None, 1) for l in sums.splitlines() if l.strip())}
    actual = hashlib.sha256(ubo_xpi.read_bytes()).hexdigest()
    if expected.get(ubo_xpi.name) != actual:
        raise RuntimeError(f"{ubo_xpi.name}: SHA-256 {actual} doesn't match nullpath/extensions/SHA256SUMS")
    shutil.copyfile(ubo_xpi, TREE / "lw" / ubo_xpi.name)
    lw_build = TREE / "lw/moz.build"
    data = lw_build.read_text(encoding="utf-8")
    entry = f'FINAL_TARGET_FILES.distribution.extensions += [\n  "{ubo_xpi.name}",\n]\n'
    if entry not in data:
        write(lw_build, data.rstrip("\n") + "\n\n" + entry)
    ubo = policies["policies"]["ExtensionSettings"][UBO_ID]
    ubo.pop("install_url", None)
    ubo["installation_mode"] = "allowed"
else:
    print(f"warning: {ubo_xpi} not found; uBlock Origin will be installed from AMO (Direct web only)")
write(TREE / "lw/policies.json", json.dumps(policies, indent=4) + "\n")

# Rename runtime preference keys in code and locale strings in the prepared
# source tree, while leaving upstream patches, attribution and license alone.
matches = subprocess.run(
    ["rg", "-l", "-e", r"librewolf\.", "-e", "LibreWolf", "-e", r"nullpath\.(?:inc\.xhtml|js|css|svg)\b", "-g", "*.js", "-g", "*.mjs", "-g", "*.yaml", "-g", "*.ftl", "-g", "*.properties", "-g", "*.xhtml", "-g", "*.cpp", "-g", "*.h", "browser", "toolkit", "modules", "services", "devtools", "lw/l10n"],
    cwd=TREE, capture_output=True, text=True, check=False,
)
if matches.returncode > 1:  # 1 only means no matches
    raise RuntimeError("rg failed: " + matches.stderr)
for name in matches.stdout.splitlines():
    path = TREE / name
    if not path.is_file() or path.suffix not in {".js", ".mjs", ".yaml", ".ftl", ".properties", ".xhtml", ".cpp", ".h"}:
        continue
    if any(part in {".git", "third_party", "node_modules"} for part in path.parts):
        continue
    try:
        data = path.read_text(encoding="utf-8")
    except UnicodeError:
        continue
    updated = re.sub(r"librewolf\.(?!" + FILE_REF + ")", "nullpath.", data)
    # Repair file references renamed by earlier versions of this overlay.
    updated = re.sub(r"nullpath\.(?=" + FILE_REF + ")", "librewolf.", updated)
    if "l10n" in path.parts and path.name == "preferences.inc.ftl":
        updated = updated.replace("LibreWolf", "Nullpath")
    if path.name == "appstrings.properties":
        updated = updated.replace("LibreWolf", "Nullpath")
    write(path, updated)

# Static prefs and their group declarations must remain in lexical order.
prefs = TREE / "modules/libpref/init/StaticPrefList.yaml"
data = prefs.read_text(encoding="utf-8")
start = data.index('# Prefs starting with "nullpath."')
start = data.rfind('#---------------------------------------------------------------------------', 0, start)
header_end = data.index('#---------------------------------------------------------------------------', start + 1)
end = data.index('#---------------------------------------------------------------------------', header_end + 1)
block = data[start:end]
data = data[:start] + data[end:]
insert = data.index('# Prefs starting with "page_load."')
insert = data.rfind('#---------------------------------------------------------------------------', 0, insert)
data = data[:insert] + block + data[insert:]
write(prefs, data)

groups = TREE / "modules/libpref/moz.build"
data = groups.read_text(encoding="utf-8").replace('    "librewolf",\n', '').replace('    "nullpath",\n', '')
data = data.replace('    "nglayout",\n', '    "nglayout",\n    "nullpath",\n')
write(groups, data)

print("Applied Nullpath identity, settings and endpoint overrides")
