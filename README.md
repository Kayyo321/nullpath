<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="nullpath/artwork/LogoDark.png">
    <img src="nullpath/artwork/Logo.png" alt="Nullpath" width="220">
  </picture>
</p>

Nullpath is a web browser for I2P. It's built on LibreWolf, and so on Firefox, with an I2P router button in the toolbar and a separate profile for each way of browsing: I2P sites, the public web through an I2P outproxy, and the regular internet.

The main idea is simple. When you ask for I2P, you get I2P or nothing. If the router goes down or the outproxy stops answering, pages just don't load. They never fall back to your normal connection without you noticing.

## What it does

- Works with an I2P router you already run, or sets up i2pd for you if you'd rather not deal with it
- Keeps I2P sites, public web via I2P and direct browsing in separate profiles, each with its own cookies, history and logins
- Starts disconnected, and only connects when you tell it to
- Shows the connection state at a glance, and explains why a page was blocked

## Status

Nullpath is in early development and only runs on Windows for now. It hasn't had an independent security review yet, so please don't rely on it to keep you anonymous. What's left before a first release is tracked in the [production-readiness checklist](docs/nullpath/PRODUCTION-READINESS-HANDOFF.md).

## Building

Windows build steps are in [README.nullpath.md](README.nullpath.md), and the design notes live in [docs/nullpath](docs/nullpath).

---

Nullpath is an independent browser based on LibreWolf and Mozilla's open-source Firefox technology. It is not affiliated with Mozilla or the LibreWolf project. Licensed under the [Mozilla Public License 2.0](LICENSE).
