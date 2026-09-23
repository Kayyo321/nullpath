# Nullpath Project Brief

## Vision

Nullpath is a privacy-focused browser based on LibreWolf and Firefox, designed to make I2P approachable without hiding how it works. It should serve both people who want to visit sites hosted inside I2P and people who deliberately choose to send their browser's public-web traffic through an I2P outproxy.

The product should make the active network state obvious, keep browsing modes separate, and fail closed whenever a user has asked for I2P routing. Nullpath must not claim that it makes users anonymous or that it routes traffic from other applications on the computer.

## Product principles

- **Clear network state:** Users can always see whether Nullpath is disconnected from I2P, connecting, connected, or experiencing a problem.
- **No accidental fallback:** An I2P browsing mode never silently switches to a direct internet connection.
- **Choice of router:** Users can connect to an existing router, use a basic Nullpath-assisted setup, or enter a custom configuration.
- **Separate contexts:** I2P, public-web-through-I2P, and direct-web browsing keep their cookies, history, storage, and logins in separate browser profiles.
- **Honest scope:** Explain which requests go through the browser proxy, which traffic belongs to the I2P router itself, and what remains outside Nullpath's control.
- **Maintainable integration:** Integrate with supported I2P router software and interfaces. Keep Nullpath's browser layer independently maintainable and coordinate changes with I2P maintainers.
- **Accessible by default:** First-run setup should use plain language and safe defaults, while advanced configuration stays available without forcing users through a simplified-only path.

## Main browser layout

### Vertical tree tabs

Vertical tabs with a nested, side-tree effect inspired by the Sidebery Firefox add-on are the default tab layout. The tree should make parent and related tabs easy to recognize, collapse and expand, and remain usable with a keyboard and screen reader. Users can change the layout in settings, but a horizontal tab strip is not the default.

Tabs should make their browsing context visible. Use clear labels or visual cues for **I2P sites**, **Public web through I2P**, and **Direct web**. Do not rely on color alone. Keep related tabs grouped in their context and make it difficult to mistake a direct-web tab for an I2P-routed tab.

### Persistent I2P router control

Place an I2P router button at the top right of the browser chrome and keep it available in every window and browsing mode. It opens a native Nullpath panel for router connection, status, and configuration. The control must remain available even when the router is not installed or cannot be reached.

The panel should show, at a glance:

- Connection state: **Not connected**, **Connecting**, **Connected**, or **Needs attention**.
- Which router or configuration Nullpath is using.
- Whether the browser's I2P HTTP proxy is ready and which browsing modes it can support.
- Whether public-web-through-I2P has a configured and reachable outproxy.
- Useful next actions, such as connect, retry, configure, or view router status.

The browser starts **Not connected to I2P**. Do not silently connect to a detected or bundled router at launch. The user connects from the browser control. Until that succeeds, I2P modes remain unavailable and show a useful explanation; they must not fall back to direct connections.

### Firefox's built-in VPN is removed

Firefox 156 includes Mozilla's built-in VPN ("IP Protection"): a toolbar button and panel that send browser traffic through a proxy service operated by Mozilla. Nullpath turns it off in every profile (`browser.ipProtection.enabled=false`), so its button never appears. It is removed for three reasons:

- It sends traffic to a Mozilla-operated network service, which is exactly the kind of inherited endpoint Nullpath must remove or disclose.
- A second top-right "protection" button with its own on/off switch would compete with the I2P router control and blur which path the browser is using.
- It is a second proxy layer outside the I2P design, so it would complicate fail-closed routing and leak verification.

Do not re-enable it without revisiting these points. See [I2P-ROUTER-TOGGLE.md](I2P-ROUTER-TOGGLE.md) §8.2 and §10.

## Router setup and configuration

The router control must support both a guided path and user-managed setups.

### Connect an existing router

Allow Nullpath to detect or accept the local I2P router and its browser-facing HTTP proxy configuration. Show the endpoint Nullpath will use and provide an explicit Connect action. Support routers already installed and configured by the user, including non-default ports and custom arrangements.

### Optional basic setup

In the configuration panel, offer an optional action such as **Install and set up a basic I2P router**. This should install or provision the supported router components and apply a minimal working configuration only after the user chooses it. Explain what will be installed, where its data will be stored, what network access it requires, and how to remove or change it.

The basic path is a convenience, not a requirement. It must not overwrite an existing router configuration without the user's explicit choice.

### Custom and pre-installed configurations

Keep the door open to an advanced configuration path where users can select or enter their own router, local proxy endpoint, and other supported settings. A user may have installed and configured I2P before installing Nullpath. Do not require the Nullpath installer, a bundled router, Java installation, or a single fixed port to use that setup.

Show which settings are managed by Nullpath and which belong to the external router. Validate endpoints, report connection failures in understandable terms, and provide a way to return to the guided setup without destroying custom settings.

Router status and configuration controls belong to privileged browser UI. A web page, extension, or remote site must not be able to change router configuration or issue router-control commands through the panel.

## Browsing modes

### I2P sites — I2P destinations only

This mode is for sites and services hosted inside I2P. Route requests through the configured local I2P HTTP proxy and use the router's address-book and naming behavior for I2P destinations. Do not send an unrecognized or failed I2P destination directly to the public internet. Explain that human-readable `.i2p` names depend on local I2P address-book mappings.

The I2P project documents browser access through a local HTTP proxy (commonly `127.0.0.1:4444`) and identifies the router console as a local administrative interface. Ports and addresses can differ in custom setups, so Nullpath must not assume every user uses defaults. [I2P FAQ and local ports](https://i2p.net/en/docs/overview/faq/)

### Public web through I2P — outproxy required

This mode is for public-web sites reached through an I2P outproxy. Require an explicitly configured and reachable outproxy. If it is unavailable, browsing stops with a clear error; there is no direct-connection fallback, automatic proxy bypass, or retry through the system proxy.

Show the outproxy identity or endpoint and explain that it is a separate service operator. HTTPS protects the connection between the browser and the destination through the proxy, but the outproxy is not operated by the I2P project by default and can affect availability and trust. The I2P project currently documents `exit.stormycloud.i2p` as its default HTTP/HTTPS outproxy; do not hard-code that assumption because router configurations and outproxy availability can change. I2P does not provide a general-purpose SOCKS outproxy. [I2P FAQ: outproxies and SOCKS](https://i2p.net/en/docs/overview/faq/)

### Direct web — explicitly separate

Direct web is the ordinary public internet connection, outside I2P. It may be available as a separate profile and must be labeled clearly. Never make direct web the silent fallback for either I2P mode. Switching between direct web and an I2P mode should be a visible user action.

## Fail-closed routing and leak prevention

When a user selects **I2P sites** or **Public web through I2P**, all browser-originated network requests covered by that mode must use the configured I2P path or be blocked. A proxy error, router shutdown, lost connection, or unavailable outproxy must not cause direct access.

The routing and verification plan must account for more than ordinary page loads, including:

- DNS resolution, DNS-over-HTTPS, prefetching, and speculative connections.
- WebRTC and other peer-to-peer browser features.
- Background network activity such as remote settings, telemetry, crash reporting, captive-portal checks, safe-browsing services, push, update checks, extension installation, and extension updates.
- Downloads, redirects, service workers, WebSockets, and proxy authentication or connection failures.
- Built-in pages and browser features that may make requests outside the normal page-loading path.

For each feature, either route its requests through the selected I2P path or disable/block it in that mode. Any necessary direct connection must be disclosed and must not occur as an undocumented exception. The product must have network-level verification showing that requests do not escape when the router or proxy is unavailable.

The promise is about **browser traffic**. Nullpath does not automatically route traffic from other applications. The I2P router itself must communicate with I2P peers and bootstrap services over the user's ordinary internet connection; this is distinct from the browser's proxied requests. Explain this distinction in setup and help content. [I2P FAQ: router traffic and outproxy limits](https://i2p.net/en/docs/overview/faq/)

## Profiles, identity, and session boundaries

Maintain separate browser profiles for I2P sites, public-web-through-I2P, and direct web. Keep cookies, local storage, history, cache, logins, and permissions isolated between them. Offer a simple way to clear a profile's data and to close its windows.

Do not describe separate browser profiles as separate I2P network identities. Browser storage isolation and router/tunnel behavior are different layers. Avoid creating and discarding large numbers of router sessions or tunnels as a per-tab feature; use supported I2P router interfaces and document the actual isolation guarantees.

Keep the browser's identifying behavior aligned with a broad, common Firefox-compatible population where practical. Avoid unique Nullpath-only user-agent strings or needless fingerprint variation. Any anti-fingerprinting setting should be measured for compatibility and should not be sold as anonymity.

## Security, updates, and transparency

- Keep the I2P router's administrative console and client-control interfaces local by default; never expose them to websites or bind them broadly without a clear user-managed choice.
- Review every browser and Nullpath network endpoint for each mode, including inherited LibreWolf endpoints, DNS providers, geolocation, extension sources, update services, and remote settings.
- Use authentic, verifiable distribution and update channels. Clearly disclose any required direct network access during installation or updating.
- Publish a plain-language network diagram that shows browser requests, the local proxy, the I2P router, the I2P network, and the outproxy boundary.
- Document limitations, expected performance, router startup time, outproxy availability, and the threat model Nullpath is designed to address.
- Provide a security contact and a process for independent review. Do not claim anonymity, untraceability, or leak-proof behavior until independently tested.

## Delivery priorities

1. **Foundation:** finish the browser rebrand and maintainable overlay; remove or replace inherited Nullpath-inappropriate network endpoints; document the intended network architecture.
2. **I2P-site mode:** connect to an existing local router, provide the persistent status/configuration panel, create an isolated profile, and route I2P destinations without direct fallback.
3. **Guided setup:** add the optional basic router installation/configuration path while preserving custom and pre-installed router support.
4. **Public web through I2P:** add explicit outproxy configuration, visible operator information, fail-closed behavior, and a separate profile.
5. **Verification and expansion:** test all browser request paths under success and failure conditions, publish results and limitations, then broaden platform packaging, localization, accessibility, and router compatibility.

## Success criteria

- A first-time user can tell how to connect to I2P and can choose a basic setup without being forced into it.
- A user with their own router can connect without replacing their configuration or accepting default ports.
- The top-right router control remains available and accurately reports status in every mode.
- The browser starts not connected to I2P, and a requested I2P mode never falls back to direct internet access.
- I2P sites and public-web-through-I2P are distinct, isolated modes; the latter requires a working outproxy.
- Network-level checks cover page, browser background, DNS, WebRTC, extension, update, and proxy-failure traffic.
- Product copy distinguishes browser traffic from other computer traffic and from the router's own peer/bootstrap connections.
- Users can understand who operates the outproxy, what it can access, and what Nullpath does when it is unavailable.

## Reference material

- [I2P FAQ](https://i2p.net/en/docs/overview/faq/) — browser proxy configuration, local services, outproxies, and limitations.
- [I2P Easy Install Bundle](https://geti2p.net/en/download/nsis) — reference for guided installation and profile integration.
- [Mozilla Firefox connection settings](https://support.mozilla.org/en-US/kb/connection-settings-firefox) — browser proxy configuration concepts.
- [I2P Browser source repository](https://github.com/i2p/i2p-browser) — archived January 10, 2026; review for ideas and history, not as an assumed actively maintained foundation.
