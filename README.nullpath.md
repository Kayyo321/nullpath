# Nullpath

Nullpath is an independent browser based on LibreWolf and Mozilla's open-source Firefox technology. It is not affiliated with Mozilla or the LibreWolf project.

This fork is currently a development build for Windows. Its planned I2P routing has not been implemented or tested; do not treat this build as anonymous or untraceable. Releases and issues are tracked at https://github.com/Kayyo321/nullpath.

## Native Windows build

Use MozillaBuild 4.2.1 or later. From its shell:

```bash
cd /d/nullpath/librewolf-source
./scripts/windows-build.sh fetch prepare
./scripts/windows-build.sh bootstrap build package
```

The source preparation applies LibreWolf's patches, then Nullpath's overlay. Set `NULLPATH_BASELINE=1` for an upstream baseline build. The updater remains disabled until Nullpath has its own update service and signing keys. See [the handoff](docs/nullpath/REBRAND-HANDOFF.md) for build requirements and verification steps.
