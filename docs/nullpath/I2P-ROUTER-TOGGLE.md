# Nullpath I2P router control

This document specifies the I2P router button at the top right of the Nullpath
window: the small panel it opens, the first-run choice between guided setup and
a user's own router, and how switching the router on and off works. It also
turns every default in [PROJECT.md](PROJECT.md) into a concrete setting,
mechanism or decision (§10), so later work starts from settled answers.

It covers delivery priorities 2–4 in PROJECT.md. The code is written (§15)
but hasn't been compiled into a build or run yet. Until the verification in §12
passes, don't describe any of it as anonymous or leak-proof, in product copy or
anywhere else.

Paths such as `browser/components/...` are relative to the prepared tree
(`librewolf-156.0.1-1/`). New Nullpath files go in `nullpath/tree-overrides/`,
and edits to upstream files go in `nullpath/patches/` (see
[REBRAND-HANDOFF.md §3](REBRAND-HANDOFF.md)).

---

## 1. Summary of decisions

| Question | Decision |
|---|---|
| Where is the button? | The navigation bar's rightmost customizable slot, just left of the ☰ menu. It can't be removed and never moves into the overflow menu (§2). |
| What does a click do? | It opens a small panel, about 340 px wide, anchored under the button. The panel's first control is the **On/Off switch**, so turning the router on or off takes two clicks (§3). |
| What happens on the first click? | The panel offers **Set up I2P for me** or **Use my own I2P router**. If Nullpath detects a running router, it recommends the second option (§4). |
| Which router does guided setup install? | **i2pd**, a C++ router that doesn't need Java. Nullpath downloads a version pinned in the build and checks its SHA-256 hash. It runs as a child process with its own ports and its own data folder (§5). |
| What does Off mean? | Nullpath stops using I2P, and I2P windows block all requests. If Nullpath installed the router, Off also stops it. Nullpath never stops a router it didn't install (§3.3). |
| What is the state at launch? | Always **Not connected**. Nullpath doesn't start a router or connect to one until the user turns the switch on, and there is no auto-connect option (§6). |
| Which window opens at launch? | An **I2P sites** window. If the user opens a public-web address from it, Nullpath sends that page to a **Public web via I2P** window, so it travels through I2P and an outproxy. If that path isn't available, the page doesn't load at all (§7.4). |
| Does Nullpath relay traffic for other I2P users? | Only if the user turns **Relay traffic for other I2P users** on in the panel. It's off by default (§3.2, §5.4). |
| How are the three modes kept apart? | As three Firefox profiles: I2P sites, Public web through I2P, and Direct web. Router settings live in a shared file that all three profiles read (§7). |
| How does fail-closed work? | Four layers: build flags that remove the code for direct fallback, locked proxy prefs, a Nullpath channel filter that runs last, and a request blocker with its own error page (§8). |
| Who can change router settings? | Only browser UI running in the parent process. Web pages and extensions have no way to reach it (§9). |

---

## 2. The button

### 2.1 Placement and persistence

- Register the button as a CustomizableUI widget, modelled on Firefox's
  IP-protection widget (`browser/components/ipprotection/IPProtection.sys.mjs`,
  `#createWidget` and `#placeWidget`):
  - `id: "nullpath-router-button"`, `type: "view"`,
    `viewId: "nullpath-router-panel"`, `defaultArea: AREA_NAVBAR`
  - `removable: false`, so Customize can't remove it
  - `overflows: false`, so it stays visible in narrow windows
- Place it immediately before the PanelUI menu button. If an earlier session or
  a customization moved it, move it back at startup. Nullpath doesn't use a
  "placed once" pref the way IP protection does.
- Vertical tabs are the default (§10), so the navigation bar stays at the top of
  the window and the button sits in its top-right corner.
- **Popup windows** (`window.open` with `toolbar=no`) have no navigation bar.
  Add a Nullpath icon to the URL bar's identity box in those windows. It shows
  the same state and opens the same panel. This keeps the control present "in
  every window".
- The button appears in every profile, including Direct web, and in private
  windows. Router state belongs to the application, not to a single window
  (§7.3).
- The button must work without a router. With nothing installed, it still opens
  the panel and offers setup.

### 2.2 States and appearance

The button shows the four states named in PROJECT.md. Each state has its own
icon shape, tooltip and accessible name, so users don't have to tell states
apart by color.

| State | Icon | Tooltip / accessible name |
|---|---|---|
| **Not connected** | Hollow ring | "I2P router: Not connected" |
| **Connecting** | Ring with a rotating segment. With `prefers-reduced-motion`, a static half ring. | "I2P router: Connecting…" |
| **Connected** | Solid ring with a check mark | "I2P router: Connected" |
| **Needs attention** | Ring with a triangle badge | "I2P router: Needs attention. {reason}" |

- Before any setup exists, the state is still **Not connected**. The tooltip
  adds "Set up I2P", and the icon carries a small dot badge until the user opens
  the panel for the first time.
- The icons are SVGs in `nullpath/tree-overrides/browser/themes/shared/nullpath/`.
  They use `context-fill`, so they follow light, dark and high-contrast themes.
- Screen readers hear state changes through `aria-live="polite"` on the panel's
  status line. The button's `aria-label` also changes, but that change isn't
  announced on its own.
- Keyboard: the button is in the toolbar's Tab and F6 order. Enter or Space
  opens the panel, and Esc closes it. A keyboard shortcut goes in
  `browser/components/customkeys` with no default binding in v1, so it can't
  collide with an existing Firefox shortcut.

---

## 3. The panel

### 3.1 Size and structure

- The panel is a native `<panelview>` in a `PanelMultiView`, like the IP
  protection panel (`IPProtectionPanel.sys.mjs`). Settings open as subviews
  inside the same small window, which slides between views. Nothing opens a new
  tab or dialog, except the router console, which the user opens explicitly.
- Width is 340 px, and height is at most 560 px, with scrolling inside the view.
  The panel is anchored to the button, so it drops down from the top right.
- The markup is a `<template>` in `browser/base/content/browser.xhtml`, added
  by a small Nullpath patch. Behaviour lives in
  `browser/components/nullpath/router/NullpathRouterPanel.sys.mjs`.
- Strings live in `browser/locales/en-US/browser/nullpath/router.ftl`. They use
  `{ -brand-short-name }` and never say "anonymous".

### 3.2 Main view (after setup)

```
┌──────────────────────────────────────────┐
│ I2P router                      [ On ●] │  ← switch
│ ● Connected · i2pd, managed by Nullpath  │  ← status line (aria-live)
├──────────────────────────────────────────┤
│ Browsing modes                           │
│  I2P sites             Ready           › │
│  Public web via I2P    No outproxy set › │
│  Direct web            Doesn't use I2P › │
├──────────────────────────────────────────┤
│ Proxy     127.0.0.1:14444                │
│ Router    Running 12 min · 38 peers      │  (shown when a control API exists)
│ Relay traffic for other I2P users [Off○] │  ← relay switch (§3.6)
├──────────────────────────────────────────┤
│ [ Open I2P window ]   [ Router console ↗ ]│
│ Settings ›                       Help ›  │
└──────────────────────────────────────────┘
```

- **Switch:** a `moz-toggle` element. Its label says "On" or "Off". While the
  state is Connecting, it stays on and shows a **Cancel** link. §3.3 describes
  what the switch does.
- **Status line:** shows the state and which router is in use: "i2pd, managed
  by Nullpath", "Your router (Java I2P) at 127.0.0.1:4444" or "Your router at
  127.0.0.1:4444". In **Needs attention**, it shows a one-sentence reason and a
  single suggested action (§6.3).
- **Browsing mode rows:** each row shows whether that mode can work right now.
  Selecting a row opens a new window in that mode's profile (§7), which is the
  visible action PROJECT.md requires when switching modes. The row for the
  current window's mode has a "This window" tag and nothing to select.
  - *I2P sites:* **Ready** when the switch is on and the I2P proxy check
    passes. Otherwise **Unavailable**, with the reason.
  - *Public web via I2P:* **Ready** only when an outproxy is configured and its
    last check passed. Otherwise **No outproxy set**, **Outproxy unreachable** or
    **Unavailable**. Selecting it when it isn't ready opens the Outproxy subview
    instead of a window.
  - *Direct web:* always **Doesn't use I2P**.
- **Router console:** shown when a console URL is known. It opens the console in
  a new tab of the current window. The request blocker (§8.4) allows that exact
  loopback origin and no other.
- **Open I2P window:** appears when the current window isn't an I2P-sites window.
- **Relay switch:** turns relaying for other I2P users on or off (§3.6).

### 3.3 The On/Off switch

The switch records the application-wide *desired* state (§7.3), then the router
service (§6) works toward it. What the switch does depends on the router type:

| Action | Nullpath-managed router (i2pd) | User's own router |
|---|---|---|
| **On** | Starts i2pd if it isn't running, then waits for the proxy to become ready (§6.2) | Checks the configured proxy. Nullpath never starts or stops this router. |
| **Off** | Stops i2pd: sends an I2PControl `Shutdown`, then kills the process after 5 s. If "Keep the router running when Nullpath is disconnected" is on, i2pd keeps running. | Stops using the router. The panel says: "Your router is still running. Manage it from its own console." |
| Both | I2P-mode windows stay open. While the switch is off, every request from them is blocked and shows the Not-connected error page (§8.4). None of them falls back to a direct connection. | Same |

Turning the switch off while I2P tabs are loading cancels those loads. They
don't fail over to anything. Direct-web windows aren't affected.

### 3.4 Settings subview

```
‹ Settings
  Router
    (•) Nullpath-managed i2pd    Running · v{x}      [Manage ›]
    ( ) My own router            127.0.0.1:4444      [Edit ›]
  Outproxy (Public web via I2P)                      [Configure ›]
  Advanced                                            [›]
  Restart guided setup
```

- **Router choice:** the user can switch between the managed and custom setups.
  Nullpath stores each setup's settings separately (§7.2), so switching never
  erases the other one. "Restart guided setup" reruns §5 without touching
  custom settings, and it never overwrites a router it didn't create.
- **Manage (managed router):** shows the version, data folder (with an **Open
  folder** button), ports, bandwidth class (Low/Medium/High), a "Keep the router
  running when Nullpath is disconnected" option (off by default), a UPnP option
  (off by default; §5.4 explains why) and **Remove Nullpath's router** (§5.6).
- **Edit (own router):** the fields from §4.3.
- **Outproxy:** §3.5.
- **Advanced:** check interval and timeouts, "Show the router console link", and
  "Allow a proxy on my local network" (off by default; §4.3). It also has **Copy
  diagnostics**, which puts the state, redacted endpoints, the result of the
  last check and the i2pd log's last 50 lines on the clipboard. It never sends
  anything anywhere.

### 3.5 Outproxy subview

Public web through I2P requires an outproxy that the user sets up explicitly.
Nullpath never picks one on its own.

- **Managed router:** the user enters an outproxy destination (a `.i2p` name or
  `.b32.i2p` address) and an optional note naming the operator. Nullpath writes
  it into the `nullpath-publicweb` tunnel (§5.4) and restarts that tunnel only.
  A "Suggestions" link opens the I2P FAQ's outproxy section. The list isn't
  compiled into Nullpath, because the I2P project's default outproxy
  (currently `exit.stormycloud.i2p`) can change.
- **User's own router:** the user enters the local HTTP proxy endpoint whose
  tunnel has an outproxy configured. It can be the same endpoint as the
  I2P-sites proxy. In that case, the request blocker is what keeps I2P-sites
  windows from reaching the public web.
- Before the user can save, they must read and tick an acknowledgement:
  > An outproxy is run by a third party, not by the I2P project or Nullpath.
  > It can see which public websites you visit, and it can see the contents of
  > any site that doesn't use HTTPS. If it goes down, public-web browsing stops.
  > Nullpath won't switch to a direct connection.
- **Test outproxy:** sends a `HEAD https://github.com/Kayyo321/nullpath`
  request through the public-web proxy (pref
  `nullpath.i2p.outproxy.testURL`). The panel shows the URL before sending it.
  The result shows as **Reachable** or **Unreachable**, with a reason.
- After that, Public-web windows re-check the outproxy each time one opens, and
  also after a proxy error (§6.3).

### 3.6 Relay switch

The main view has a second switch, **Relay traffic for other I2P users**. It's
**off by default**. When it's on, the router accepts transit tunnels, which
means it carries encrypted traffic for other I2P users.

- **Help text** under the switch, shown in full the first time the user turns
  it on:
  > Relaying helps the I2P network work and can help your own traffic blend in
  > with other traffic. It uses more of your bandwidth, and your computer will
  > carry encrypted traffic for other people. Nullpath can't see or change that
  > traffic.
- **Managed router:** the switch sets i2pd's `notransit` (§5.4). Off writes
  `notransit = true`, and on writes `notransit = false`. Nullpath applies the
  change right away through i2pd's web console command to accept or decline
  transit tunnels, and also writes it to `i2pd.conf` so it survives a restart.
  If the running version has no such command, Nullpath restarts the router
  instead, and the switch shows "Applies after the router restarts" until it
  does. *Verify the console command against the pinned i2pd version.* Turning
  relaying off doesn't cut existing transit tunnels. They expire within about
  10 minutes, and the panel says so.
- **User's own router:** Nullpath doesn't change settings on routers it didn't
  install. The switch is shown disabled, with "Set this in your router's
  bandwidth or sharing settings" and a **Router console** link.
- **Always available:** the switch works whether the main On/Off switch is on or
  off. It's stored as `managed.relay` in `router.json` (§7.2), so it applies
  across all profiles, and it's kept when the router is updated or restarted.
- **Accessibility:** the relay switch is a separate `moz-toggle` with its own
  label, so a screen reader can't confuse it with the On/Off switch.

---

## 4. First click: choosing a setup

### 4.1 Trigger

When no setup exists (`setup: null` in the shared config, §7.2), opening the
panel shows the chooser instead of the main view. The chooser also appears when
the user selects **Restart guided setup**.

### 4.2 Detection

Detection runs when the chooser opens, never at browser launch. It is local and
read-only. It doesn't connect the browser to anything, and it sends nothing
beyond the loopback interface.

1. **Port checks on `127.0.0.1`**, 1 second timeout each. A port counts as
   found when a TCP connection succeeds:
   - HTTP proxy: 4444 (the common default)
   - Java I2P console: 7657
   - i2pd console: 7070
   - I2PControl: 7650
2. **Identifying the proxy:** for each found proxy port, request
   `http://nullpath-probe.invalid.i2p/` through it. Both Java I2P and i2pd
   answer a name missing from the address book with an error page they generate
   themselves, without using the network. If a proxy-generated 4xx/5xx
   response arrives within 3 s and identifies I2P, the port counts as a
   probable I2P proxy.
   *Verify the exact signatures against current Java I2P 2.x and the pinned
   i2pd version.* Record them in
   `browser/components/nullpath/router/NullpathRouterDetect.sys.mjs`.
3. **Config files, read-only:** if `%APPDATA%\i2pd\i2pd.conf` or a Java I2P
   `i2ptunnel.config.d\*HTTP Proxy*` file exists, read the configured proxy
   port and interface from it. Custom ports are how Nullpath finds routers that
   don't use the defaults. *Verify the default Java I2P config paths on
   Windows* (`%LOCALAPPDATA%\I2P` and `%APPDATA%\I2P` for the Easy Install
   Bundle and the plain installer). Never write to these files.
4. **Nullpath's own managed ports** (§5.4) are left out, so a leftover managed
   i2pd never appears as the user's router.

### 4.3 Chooser view

```
┌──────────────────────────────────────────┐
│ Connect Nullpath to I2P                  │
│ Nullpath reaches I2P sites through an    │
│ I2P router, a program that runs on this  │
│ computer. Choose one:                    │
│ ┌──────────────────────────────────────┐ │
│ │ Set up I2P for me       Recommended │ │
│ │ Nullpath downloads and runs i2pd     │ │
│ │ (about {size} MB). You can remove it │ │
│ │ at any time.                         │ │
│ └──────────────────────────────────────┘ │
│ ┌──────────────────────────────────────┐ │
│ │ Use my own I2P router                │ │
│ │ Found: an I2P proxy at 127.0.0.1:4444│ │
│ └──────────────────────────────────────┘ │
│ Not now                   What is I2P? › │
└──────────────────────────────────────────┘
```

- If a probable I2P proxy was detected, the **Recommended** tag moves to **Use
  my own I2P router**. The "Found:" line appears only when detection succeeded.
- **Not now** closes the panel and leaves the state at Not connected. The
  chooser appears again next time.
- **What is I2P?** opens a short subview. It explains that the router is a
  separate program that connects to other I2P routers over the user's ordinary
  internet connection, that Nullpath sends only its own browser traffic
  through I2P, and that other apps on the computer aren't affected. It links to
  the I2P FAQ.

**Use my own I2P router** opens a form with these fields. Detected values are
filled in, and every field can be edited.

| Field | Required | Validation |
|---|---|---|
| Router type | No | Java I2P, i2pd or Other. Detection guesses it. It only changes help text and the default console URL. |
| I2P-sites HTTP proxy | Yes | An IP literal and a port from 1 to 65535. The IP must be loopback unless "Allow a proxy on my local network" is on. Hostnames are rejected, because DNS is off in I2P profiles (§8.2). |
| Public-web HTTP proxy | No | Same rules. When empty, Public web via I2P shows **No outproxy set**. |
| Router console URL | No | Must be an `http://` URL on loopback, or on the LAN when that option is on |
| I2PControl URL and password | No | When set, the panel can show router health (peers, uptime). Without it, the panel shows "Router details: not available". Nullpath warns that the password is stored in plain text in `router.json`, which is how routers store their own. |

- A LAN proxy (for example `192.168.1.5:4444`) needs a confirmation: "Traffic
  between Nullpath and this proxy isn't encrypted and can be seen on your local
  network."
- **Test** runs §4.2 step 2 against the entered proxy and reports the result in
  plain words: "No program is listening on 127.0.0.1:4445", "Something answered
  on 127.0.0.1:4445, but it doesn't look like an I2P proxy" or "I2P proxy found".
- **Save and connect** writes the `external` block (§7.2) and turns the switch
  on. **Save** without connecting is also available.

---

## 5. Guided setup (Nullpath-managed i2pd)

### 5.1 Why i2pd

- It's a native Windows binary and doesn't need Java, which PROJECT.md says
  not to require.
- Its size and config format make it practical to provision and run it
  as a child process.
- It has an HTTP proxy, a local web console, I2PControl and per-tunnel
  outproxy settings.
- It is BSD-3-Clause licensed. Nullpath ships its license text in
  `about:license` for the downloaded component.

Java I2P remains fully supported through **Use my own I2P router**.

### 5.2 Explain screen (shown before anything is downloaded)

The first view of guided setup lists everything the setup will do. **Install**
stays disabled until this view has been shown. The view lists:

- **What Nullpath installs:** i2pd {version}, downloaded from
  `https://github.com/PurpleI2P/i2pd/releases/`. Nullpath checks the download
  against a hash built into this Nullpath release.
- **Where it goes:** `%LOCALAPPDATA%\nullpath\i2p-router\`. That folder holds
  the program, its settings, the router's identity and its address book.
- **What network access it needs:**
  - This one download is a direct connection to GitHub. It doesn't go through
    I2P.
  - Once running, i2pd connects directly to other I2P routers and to I2P
    "reseed" servers to find peers. That is router traffic, which is separate
    from browser traffic.
  - Windows may ask whether to allow i2pd through the firewall. Allowing it on
    private networks helps other routers reach this one. Blocking it still
    works, but more slowly.
  - Relaying traffic for other I2P users starts off. It can be turned on
    later from the router panel (§3.6).
- **What it doesn't change:** existing I2P installs and their settings, and
  other apps.
- **How to remove it:** Settings › Router › Manage › Remove Nullpath's router.

### 5.3 Steps and progress

A progress list replaces the explain screen. Each step shows a spinner,
✓ or ✗, and **Cancel** is available until step 5.

1. **Download.** Download the pinned `i2pd_<ver>_win64_mingw.zip` to a
   temporary file under the router folder. This is the only direct request
   Nullpath itself makes in an I2P profile. Its channel is created by
   `NullpathManagedRouter.sys.mjs`, and it is tagged in a `WeakSet` that the
   channel filter checks (§8.3). Nothing else can get that tag.
2. **Verify.** Compute SHA-256 with `nsICryptoHash` and compare it with
   `NULLPATH_I2PD_SHA256` in `NullpathRouterManifest.sys.mjs`. On a mismatch,
   delete the file and stop with "The download didn't match what Nullpath
   expected, so it wasn't installed." There is no retry-and-accept path.
3. **Install.** Extract `i2pd.exe` with `nsIZipReader` into `bin\`, then write
   the config (§5.4).
4. **Choose ports.** Try each port in §5.4. If one is taken, move up one at a
   time, for up to 20 ports. Record the ports actually used.
5. **Start.** Launch i2pd (§5.5) and move to Connecting (§6.2). The first start
   usually takes a few minutes, while i2pd reseeds and builds tunnels, and the
   panel says so.

If setup fails or is cancelled, Nullpath deletes the partial folder and leaves
`setup` unchanged. The user can retry or pick **Use my own router**.

### 5.4 Managed configuration

The managed router uses its own block of ports. They don't overlap Java I2P or
i2pd defaults, so the managed router can't collide with a router the user
installs later, and detection (§4.2) never mistakes one for the other.

| Purpose | Address |
|---|---|
| I2P-sites HTTP proxy (no outproxy) | `127.0.0.1:14444` |
| Public-web HTTP proxy (outproxy set by the user) | `127.0.0.1:14450`. The tunnel is present but disabled until an outproxy is set. |
| Web console | `127.0.0.1:17070`, with HTTP auth and a random password |
| I2PControl | `127.0.0.1:17650`, with a random password |
| NTCP2/SSU2 (router-to-router) | One random port from 20000–40000, chosen once at setup, so the Windows firewall rule doesn't change |

`i2p-router\i2pd.conf` (keys to be checked against the pinned version):

```ini
# Written by Nullpath. Edits are kept unless you choose "Restart guided setup".
log = file
logfile = <dir>\logs\i2pd.log
loglevel = warn
port = <random 20000-40000>
ipv4 = true
ipv6 = false
bandwidth = L
notransit = true            # relay switch (§3.6); off by default
floodfill = false

[httpproxy]
enabled = true
address = 127.0.0.1
port = 14444
outproxy =
addresshelper = true
keys = nullpath-sites.dat

[http]
enabled = true
address = 127.0.0.1
port = 17070
auth = true
user = nullpath
pass = <random 32 chars>
strictheaders = true

[i2pcontrol]
enabled = true
address = 127.0.0.1
port = 17650
password = <random 32 chars>

[socksproxy]
enabled = false
[sam]
enabled = false
[bob]
enabled = false
[i2cp]
enabled = false
[upnp]
enabled = false

[reseed]
verify = true
```

`i2p-router\tunnels.conf`:

```ini
[nullpath-publicweb]
type = httpproxy
address = 127.0.0.1
port = 14450
outproxy = <user's outproxy, empty until configured>
keys = nullpath-publicweb.dat
```

Notes:

- **Why two proxies:** the I2P-sites proxy has no outproxy, so a request for a
  public-web address that got past the browser's own blocking still fails.
  Each mode also gets its own client destination (`keys`), created once at
  setup, not per tab. Describe this accurately in help text: I2P sites and the
  outproxy see different I2P destinations for the two modes, but this isn't a
  per-site or per-tab identity. Browser profiles and router destinations are
  separate layers.
- **UPnP is off by default** because it changes the home router's settings from
  this computer. The Manage subview explains the trade-off, faster and more
  reliable connections against changes to the home router, and lets the user
  turn it on.
- **Relaying is off by default** (`notransit = true`). That's the owner's
  decision: Nullpath doesn't use the user's bandwidth for other people unless
  they choose to allow it. The trade-off: a router that relays helps the
  network and gives its own traffic more cover, while one that doesn't is less
  common and contributes nothing back. The relay switch (§3.6) states this.
- **SOCKS, SAM, BOB and I2CP are off.** The browser doesn't need them, and each
  one is another local control interface.
- Nullpath writes these files once at setup. After that, it changes only the
  keys it manages (the ports, `outproxy`, `bandwidth`, `notransit` and
  `[upnp] enabled`),
  and each change is a targeted line edit. Anything else the user edits by
  hand is kept.

### 5.5 Running the managed router

- Launch it with `Subprocess.call()` (`resource://gre/modules/Subprocess.sys.mjs`),
  using the command `i2pd.exe --datadir=<dir>\data --conf=<dir>\i2pd.conf
  --tunconf=<dir>\tunnels.conf`. The process runs as the current user. It
  isn't a Windows service and doesn't need administrator rights.
- When it starts, write `<dir>\i2pd.pid` containing the PID and start time.
- **Ownership across profiles:** the first Nullpath process that needs the
  router starts it. The others see a live `i2pd.pid` and use the running
  router instead of starting a second one. Subprocess puts the child in a
  job object, so Nullpath's own profile processes don't hold it. *Verify*
  whether that job kills i2pd when the launching process exits. If it
  does, launch i2pd so that it breaks away from the job
  (`JOB_OBJECT_LIMIT_BREAKAWAY_OK`) and track it by PID, so closing one
  profile's window doesn't stop the router while other profiles still use it.
- **Stopping:** when the switch turns off, or the last Nullpath process exits
  without "Keep the router running when Nullpath is disconnected" on, send an
  I2PControl `RouterManager` `Shutdown` request, wait 5 s, then kill the
  process. Don't use a graceful shutdown by default, because i2pd can take up
  to 10 minutes to finish one.
- **Crash:** if i2pd exits while the switch is on, the state becomes **Needs
  attention**, with the reason "Router stopped unexpectedly" and a **Restart
  router** action. It doesn't restart on its own in a loop. It restarts once
  automatically, and a second crash within 5 minutes needs the user.
- **Leftover process at launch:** if `i2pd.pid` names a live i2pd from an
  earlier session (after a Nullpath crash) and the desired state is off, stop
  it. The browser always starts not connected (§6.1).

### 5.6 Removing the managed router

**Remove Nullpath's router** asks for confirmation. The confirmation says this
deletes the router's identity and address book. After confirmation, Nullpath
stops i2pd and deletes `%LOCALAPPDATA%\nullpath\i2p-router\`, clears the
`managed` block (§7.2) and returns to the chooser if no custom setup exists.
The Nullpath uninstaller (bsys6 fork) gets a checkbox, off by default, to
delete the same folder. That checkbox is an open item in the packaging work.

### 5.7 Updating i2pd

The Nullpath updater is disabled (REBRAND-HANDOFF §2b.2), so each Nullpath
release pins one i2pd version and hash in `NullpathRouterManifest.sys.mjs`.
When a newer Nullpath release pins a newer version, the Manage subview shows
**Update router to {version}**, which repeats steps 1–3 of §5.3 and keeps
`data\` and the config. Nothing updates without the user's action.

---

## 6. Router service and state machine

### 6.1 Module

`browser/components/nullpath/router/NullpathRouter.sys.mjs` is a parent-process
singleton, initialised from `BrowserGlue` in `_onFirstWindowLoaded`. It owns the
state, runs the checks, and notifies the widget and panel through
`Services.obs` topic `nullpath-router-state-changed`.

States: `off`, `connecting`, `connected` and `attention`. The panel shows these
as the four PROJECT.md labels. `off` with `setup == null` has the
"Set up I2P" hint.

```
         switch on                     proxy check passes
  off ─────────────► connecting ──────────────────────────► connected
   ▲                   │  timeout / router exited              │
   │ switch off        ▼                                        │ check fails
   └────────────── attention ◄──────────────────────────────────┘
                       │  retry / check passes
                       └──────────► connecting / connected
```

- **At launch the state is always `off`**, and the shared desired state (§7.3)
  resets to `off` when no other Nullpath process is running. There is no
  auto-connect option in v1. Adding one would contradict "The browser starts
  Not connected", so it needs the owner's decision.
- Every transition is logged to the browser console under the
  `nullpath.router` log prefix. The log never includes page URLs.

### 6.2 Connecting and readiness

**Connecting** shows a list of stages in the panel:

1. *Starting router* (managed only): the process has started and the
   I2PControl port answers.
2. *Finding peers:* read `i2p.router.netdb.knownpeers` over I2PControl, when
   it's available. The stage is done when the count is above 0.
3. *Checking the I2P proxy:* the identification request from §4.2 step 2 is
   sent to the I2P-sites proxy.

The state becomes **Connected** when stage 3 passes. The panel then adds: "The
first I2P site can take a minute to load while the router builds tunnels."

Nullpath doesn't treat tunnel readiness as a precondition. The router interfaces
don't report it consistently, and saying the router is ready before it is would
break the rule of clear network state.

Timeouts: 10 minutes for a managed router's first start (it has to reseed),
3 minutes for later starts and 20 s for a user's router. A timeout moves the
state to **Needs attention**.

### 6.3 Health checks and "Needs attention"

While the state is **Connected**, the service re-runs the proxy identification
check every 15 s. It also checks right away after any proxy connection error
reported by `NullpathNetworkErrorObserver`, which is modelled on
`IPPNetworkErrorObserver.sys.mjs`. Two failures in a row move the state to
**Needs attention**.

| Reason code | Message | Suggested action |
|---|---|---|
| `ROUTER_EXITED` | Router stopped unexpectedly. | Restart router |
| `PROXY_UNREACHABLE` | Nothing is answering at {endpoint}. | Retry, Edit router |
| `PROXY_NOT_I2P` | {endpoint} answered, but it isn't an I2P proxy. | Edit router |
| `START_TIMEOUT` | The router is taking longer than expected to connect. | Keep waiting, View router console |
| `OUTPROXY_UNREACHABLE` | Public web via I2P: the outproxy isn't responding. | Test again, Configure outproxy |

`OUTPROXY_UNREACHABLE` affects only the Public-web mode row and Public-web
windows. It gives the button the triangle badge only while a Public-web window
is open. In every state that isn't Connected, the request blocker keeps each
I2P mode closed (§8).

---

## 7. Profiles and shared router state

### 7.1 Three profiles

Nullpath uses Firefox's selectable profiles (`browser/components/profiles/`).
It creates three profiles in one profile group the first time it runs:

| Profile | Name shown | Mode pref (`nullpath.mode`) |
|---|---|---|
| I2P sites | "Nullpath: I2P sites" | `i2p-sites` |
| Public web via I2P | "Nullpath: Public web via I2P" | `i2p-publicweb` |
| Direct web | "Nullpath: Direct web" | `direct` |

- Profiles, not containers, because PROJECT.md requires history, cache and
  logins to be separate too, and containers share history.
- `nullpath.mode` is written to each profile's `user.js` when the profile is
  created, and the router component locks it at startup. The component reads
  the mode once at startup, so a profile can't change modes.
- **Launch default:** Nullpath opens the **I2P sites** profile. Because the
  browser starts Not connected, the first window makes no network requests and
  shows the local new-tab page, with a banner: "Not connected to I2P. Use the
  router button at the top right to connect." Launching into Direct web would
  mean ordinary internet traffic at every launch, even though Nullpath's
  purpose is I2P. Public-web addresses opened from this window go through I2P
  in a Public web via I2P window, or don't load at all (§7.4).
- **Switching modes** always opens a window of another profile, from the
  panel's mode rows or the profiles menu. A tab never changes mode.

### 7.2 Shared config: `%APPDATA%\nullpath\i2p\router.json`

The shared config sits next to `profiles.ini`, outside every profile, so all
three profiles read the same settings. Writes are atomic (`IOUtils.writeJSON`
with `tmpPath`), and only the parent process of a Nullpath profile writes the
file.

```json
{
  "version": 1,
  "setup": "managed",
  "managed": {
    "dir": "%LOCALAPPDATA%\\nullpath\\i2p-router",
    "i2pdVersion": "x.y.z",
    "ports": { "sites": 14444, "publicWeb": 14450, "console": 17070, "control": 17650, "router": 27311 },
    "consolePassword": "…", "controlPassword": "…",
    "keepRunningWhenDisconnected": false,
    "upnp": false,
    "relay": false,
    "bandwidth": "L"
  },
  "external": {
    "kind": "java-i2p",
    "sitesProxy": "127.0.0.1:4444",
    "publicWebProxy": null,
    "consoleURL": "http://127.0.0.1:7657/",
    "control": null,
    "allowLan": false
  },
  "outproxy": {
    "destination": null,
    "operatorNote": "",
    "acknowledged": false
  }
}
```

`setup` is `null`, `"managed"` or `"external"`. Both setup blocks can be
present at once, and switching `setup` never erases either one.

### 7.3 Application-wide on/off

Each profile runs in its own process, so the switch state is kept in
`%APPDATA%\nullpath\i2p\state.json`:
`{ "desired": "on"|"off", "changedAt": …, "processes": [pid, …] }`.

- Every Nullpath process registers its PID at startup and removes it at
  shutdown. At launch, dead PIDs are pruned. If none remain, `desired` is reset
  to `off`.
- A toggle in any window writes `desired`. Every process polls the file every
  2 s and follows it, so switching off in one window turns every I2P window off
  within 2 s. Each process then runs its own proxy check. The observed state
  can differ between processes for a moment, but it never depends on another
  process having checked.

### 7.4 Public-web links from the launch window

Nullpath launches into an I2P sites window (§7.1), but users will still type or
click public-web addresses there. Such a page always goes through I2P, and if
that isn't possible, it doesn't load. Nullpath never sends it over a direct
connection, and never offers to.

**What counts:** any top-level `http(s)` navigation to a host that isn't
`*.i2p`, started in an I2P sites window. That includes a typed URL, a link, a
bookmark, a redirect from an `.i2p` site, and a URL passed in from another app
when Nullpath is the default browser.

**How it works:**

1. The request blocker (§8.4) cancels the navigation in the I2P sites profile
   before it sends any request. The I2P sites profile never makes a
   public-web request.
2. The blocker checks whether the Public web via I2P path is ready right now.
   It's ready when the switch is on, the state is Connected, an outproxy is
   configured and its last check passed.
3. **If it's ready:** Nullpath opens the URL in a Public web via I2P window. It
   starts that profile with the URL if the profile isn't running, and otherwise
   opens a new tab in its most recent window. Only the URL is passed: no
   referrer, cookies or form data. The original tab shows "Opened in a Public
   web via I2P window", with **Go back** and **Switch to that window** buttons.
   A blank tab that did nothing else is closed instead. The first time this
   happens, a one-time note in the new window explains that public websites
   open in their own window, which has separate cookies and history.
4. **If it isn't ready:** the tab shows **Can't open this site through I2P**
   with the reason and one action:

   | Reason | Action |
   |---|---|
   | Not connected | **Connect** (turns the switch on) |
   | Connecting | None. The page continues automatically once the path is ready. |
   | No outproxy set | **Set up an outproxy** (opens §3.5) |
   | Outproxy unreachable | **Try again**, **Change outproxy** |

   The page has no "open directly" or "open in Direct web" option. While it's
   still open, it continues automatically if the path becomes ready.

**Not handed off:**

- **Form submissions (POST) to a public-web host** are blocked, and the page
  says the form can't be sent from an I2P sites window. Moving form data into
  another profile would carry I2P-site data to a public website without the
  user seeing it.
- **Embedded public-web content** (images, scripts, frames) on an `.i2p` page is
  blocked, as before. It can't be moved to another profile, and the I2P sites
  proxy has no outproxy.

This fits PROJECT.md's rules. Every mode switch is visible, because the page
opens in a clearly labelled window of a separate profile. I2P sites and public
web keep separate cookies and history. There is no direct fallback.

---

## 8. Fail-closed routing

The mechanisms below apply to the I2P sites and Public web via I2P profiles.
The Direct web profile keeps LibreWolf's defaults and has no proxy.

### 8.1 Build flags (all profiles; `assets/mozconfig.new` via the overlay)

```
ac_add_options --enable-proxy-bypass-protection
ac_add_options --disable-proxy-direct-failover
```

- `--disable-proxy-direct-failover` removes the code in
  `nsHttpChannel.cpp` (~L4035, `#ifdef MOZ_PROXY_DIRECT_FAILOVER`) that retries
  "conservative" system requests directly after a proxy fails.
- `--enable-proxy-bypass-protection` makes `network.proxy.allow_bypass` default
  to false, so no channel can set a bypass-proxy flag.
- Direct web is unaffected, because it doesn't use a proxy.

### 8.2 Locked prefs in I2P profiles

At startup, `NullpathProfileMode.sys.mjs` sets these prefs on the default
branch and calls `Services.prefs.lockPref` on each one. Locked prefs can't be
changed from about:config, by a user.js file or by an extension's
`browser.proxy.settings`.

| Pref | I2P sites | Public web | Why |
|---|---|---|---|
| `network.proxy.type` | 1 | 1 | Manual proxy |
| `network.proxy.http` / `_port` | sites proxy | public-web proxy | From `router.json` |
| `network.proxy.ssl` / `_port` | same | same | HTTPS goes through CONNECT on the same proxy |
| `network.proxy.share_proxy_settings` | true | true | |
| `network.proxy.socks` | "" | "" | No SOCKS (I2P has no general SOCKS outproxy) |
| `network.proxy.no_proxies_on` | "" | "" | The request blocker handles loopback exceptions |
| `network.proxy.allow_hijacking_localhost` | true | true | Loopback goes to the proxy unless the blocker allows it |
| `network.proxy.failover_direct` | false | false | Protection in case a build lacks the flag |
| `network.proxy.allow_bypass` | false | false | Same |
| `network.dns.disabled` | true | true | No local DNS at all. The proxy resolves hosts. |
| `network.trr.mode` | 5 | 5 | DoH off (already LibreWolf's default) |
| `network.dns.disablePrefetch`, `…FromHTTPS` | true | true | Already LibreWolf's defaults. Locked. |
| `network.predictor.enabled`, `network.prefetch-next` | false | false | |
| `network.http.speculative-parallel-limit` | 0 | 0 | |
| `browser.urlbar.speculativeConnect.enabled`, `browser.places.speculativeConnect.enabled` | false | false | |
| `network.http.http3.enable`, `network.webtransport.enabled` | false | false | An HTTP proxy can't carry UDP |
| `media.peerconnection.enabled` | false | false | WebRTC can't go through the I2P HTTP proxy |
| `network.captive-portal-service.enabled`, `network.connectivity-service.enabled` | false | false | |
| `geo.enabled`, `geo.provider.network.url` | false, "" | false, "" | Replaces LibreWolf's beacondb endpoint in these profiles |
| `dom.push.enabled`, `dom.push.connection.enabled` | false | false | |
| `browser.safebrowsing.*` (malware, phishing, downloads) | false | false | Google endpoints |
| `extensions.update.enabled`, `extensions.getAddons.cache.enabled`, `xpinstall.enabled` | false | false | No add-on traffic. Bundled add-ons only (§8.5). |
| `services.settings.server` | `data:,#remote-settings-disabled` | same | Remote settings use the built-in dumps only |
| `browser.ipProtection.enabled` | false | false | Firefox's built-in VPN is a Mozilla proxy service. Also false in Direct web (§10). |
| `security.OCSP.enabled` | 0 | 0 | OCSP would be a public-web request |
| `network.protocol-handler.warn-external-default` | true | true | A prompt appears before any other app is launched (§8.4) |

### 8.3 Channel filter (backstop)

`NullpathChannelFilter.sys.mjs` is modelled on
`toolkit/components/ipprotection/IPPChannelFilter.sys.mjs` and
`IPPEarlyStartupFilter.sys.mjs`.

- Register it with `nsIProtocolProxyService.registerChannelFilter` during
  early startup, before the first window opens, at position `0xFFFFFFFF` so it
  runs after every other filter, including extension `proxy.onRequest`
  filters.
- In I2P profiles, `applyFilter` always returns the mode's proxy, with
  `failoverProxy = null` and `TRANSPARENT_PROXY_RESOLVES_HOST`. It ignores
  what earlier filters returned. It never returns `direct`. The one exception is
  the setup download channel tagged in §5.3 step 1.
- When the state isn't Connected, the proxy it returns is still the configured
  one. If the router is down, the connection is refused and the request fails.
  It doesn't go direct.

### 8.4 Request blocker (primary, gives the user a clear error)

`NullpathRequestBlocker.sys.mjs` observes `http-on-modify-request` and
`http-on-opening-request` in the parent process, and cancels a request when:

| Condition | I2P sites | Public web |
|---|---|---|
| State isn't Connected | Cancel: **Not connected** page | Cancel: **Not connected** page |
| Host isn't `*.i2p`, top-level GET | Cancel, then hand off to a Public web via I2P window, or show **Can't open this site through I2P** (§7.4) | Allowed (goes through the outproxy) |
| Host isn't `*.i2p`, POST or subresource | Cancel. POST shows the form-blocked page, and subresources fail silently (§7.4). | Allowed (goes through the outproxy) |
| Host is `*.i2p` | Allowed | Allowed (the router handles it) |
| Outproxy not configured or last check failed | n/a | Cancel non-`.i2p` requests: **Outproxy unavailable** page |
| Loopback or private-network address | Cancel, unless the address is the configured console origin and the request is a top-level navigation the user started | Same |
| Scheme not http(s)/ws(s) | Cancel, except for local schemes (`about:`, `chrome:`, `resource:`, `moz-extension:`, `blob:`, `data:`) | Same |

- The error pages are `about:neterror` variants with Nullpath text, added by
  a patch to `neterror`. Each one has an **Open router panel** button that
  sends a privileged message to open the panel. The page can't read or change
  router state.
- External protocols (`mailto:`, `magnet:` and others) always show a prompt
  saying that another app will open outside Nullpath's I2P routing.
- The blocker covers service workers, WebSockets (upgrades are HTTP channels),
  downloads, redirects (each redirect is checked again) and requests from
  extensions and system features. Anything the blocker misses still reaches
  the channel filter, and after that the proxy, which has no outproxy in I2P
  sites mode.
- `.i2p` names that aren't in the router's address book fail at the router with
  its own error page. They are never resolved or retried anywhere else.

### 8.5 Background features in I2P profiles

| Feature | Handling |
|---|---|
| uBlock Origin install (`policies.json` downloads it from addons.mozilla.org) | Bundle the signed uBO `.xpi` in `distribution/extensions/` instead, and remove the AMO `install_url`. That applies to every profile. |
| uBO filter-list updates | I2P sites: managed storage (`adminSettings`) turns off auto-update, and the bundled lists are used. Public web: lists update through the outproxy. |
| Telemetry, crash reports, Normandy, studies | Already off in LibreWolf. Lock the relevant prefs anyway, and check that crash reporting is disabled in the build config. |
| App updates | Already off (`DisableAppUpdate`). The compiled-in host was removed in the rebrand. |
| LibreWolf about-dialog version check | Already off (`nullpath.aboutMenu.checkVersion=false`) |
| New-tab page, Pocket, sponsored content | Local new-tab page only. Every feed pref is false. |
| Favicons and page thumbnails | Normal page requests, so the filter and blocker cover them |
| Fonts from the web | Normal page requests, so the filter and blocker cover them |

Any row that turns out to need a direct connection must be listed in the help
content's network disclosures before release. Direct connections aren't
allowed as undocumented exceptions.

---

## 9. Privileged boundary

- Everything that reads or writes router state (the router service, the panel,
  the setup flow and the Settings subviews) runs in the parent process as
  chrome JS.
- No `JSWindowActor`, WebIDL binding, `postMessage` channel or WebExtension API
  exposes router state or router actions to content. The error pages' **Open
  router panel** button uses a one-way message on the existing
  `NetErrorParent` actor, which only opens the panel.
- The router console opens as a normal tab and is protected by its own
  password (on the managed router). Nullpath never puts that password in a URL.
  The panel shows it on request with a **Copy** button.
- Because I2P profiles block loopback (§8.4), web pages in those profiles
  can't reach the console or I2PControl, even through DNS rebinding. Direct web
  pages can reach loopback, as in any browser. There, the managed router's
  console relies on its HTTP auth and random password, and I2PControl relies
  on its password.
- Endpoints are validated on every write to `router.json`. A LAN endpoint needs
  `allowLan` and the confirmation in §4.3. Nullpath never binds anything to
  a non-loopback address.

---

## 10. PROJECT.md defaults and how they are implemented

| Default in PROJECT.md | Implementation |
|---|---|
| **Vertical tree tabs are the default layout** | `defaultPref("sidebar.revamp", true)` in `nullpath-overrides.cfg`. `NullpathGlue` switches `sidebar.verticalTabs` on once per profile after the first window opens (tracked by `nullpath.tabtree.verticalTabsSet`), the way the Settings toggle does. A default of `true` would make Firefox's first-run toolbar layout scramble the navigation bar (reversed order, missing Reload and Downloads). The tree comes from a new `browser/components/nullpath/tabtree/`: a tab opened from another tab (`openerTab`) becomes its child. The component stores the parent in `SessionStore` tab values and sets a `nullpath-depth` attribute that CSS uses for indentation, capped at 6 levels. A twisty on each parent collapses and expands its children. Keyboard: with a tab focused, **←** collapses the tree or moves to the parent, and **→** expands it. Assistive tech hears `aria-expanded` on parent tabs, and each tab's accessible description says "level {n}". Test with NVDA and Narrator. Users can switch to horizontal tabs in Settings › General. |
| **Tabs show their browsing context, not by color alone** | Each window's profile has one mode, so the label goes on the window as well as the tab: the sidebar header shows a text chip (**I2P sites**, **Public web via I2P** or **Direct web**) with a distinct icon for each mode, and the window title gets a matching suffix. Direct web windows also get a fixed striped strip along the top of the sidebar, a shape that can't be mistaken for an I2P window. |
| **The router control is always at the top right, in every window and mode** | §2.1: a widget that can't be removed or overflow, is placed again at startup, and has a URL-bar fallback in popup windows |
| **The browser starts Not connected. It never silently connects at launch.** | §6.1: the state always starts `off`, the shared desired state resets, and a managed i2pd left from an earlier session is stopped. Detection runs only when the chooser opens (§4.2). |
| **I2P modes are unavailable until connected, with an explanation and no fallback** | §8.4: the **Not connected** error page, the §8.3 channel filter and the §8.1 build flags |
| **The browser proxy is commonly `127.0.0.1:4444`, but can't be assumed** | Detection tries 4444 first, reads config files for custom ports and accepts any endpoint (§4.2 and §4.3). The managed router uses 14444 so it can't collide (§5.4). |
| **Router console and control interfaces are local by default** | Managed router: loopback only, with a password (§5.4). Own router: a non-loopback endpoint needs an explicit opt-in (§4.3). Loopback is blocked from I2P pages (§8.4). |
| **The basic router setup is optional and never overwrites an existing config** | §4.3: the chooser, with **Not now**. §5.4: separate folder and ports. §3.4: the two setups are stored separately. |
| **The outproxy must be configured explicitly. Don't hard-code `exit.stormycloud.i2p`.** | §3.5: nothing is configured by default, the user enters the outproxy and acknowledges it, and suggestions are only a link to the I2P FAQ |
| **Public web mode fails closed when the outproxy is unavailable** | §8.4: the **Outproxy unavailable** page. There's no system-proxy retry, because `network.proxy.type=1` is locked. |
| **Direct web is separate and never a fallback** | §7.1: its own profile, which never opens by default. The filter and blocker never return a direct route in I2P profiles. |
| **Separate cookies, storage, history, cache, logins and permissions per mode** | §7.1: three profiles. Each profile's **Clear data** is Firefox's standard "Clear browsing data", reached from the profile menu. **Close all windows of this mode** is added to the profile menu. |
| **Don't create router sessions per tab** | §5.4: two client destinations, created once at setup. Tabs share them. |
| **Firefox-compatible identifying behaviour** | Keep `firefox-in-ua.patch` (UA says Firefox), and don't add a Nullpath UA token. Keep LibreWolf's `privacy.resistFingerprinting=true`. Nullpath adds no fingerprinting prefs of its own until they have been measured. |
| **Accessible, plain-language first run** | The §4.3 and §5.2 copy. Everything works by keyboard, with live regions (§2.2). Copy review checks every string against the "no anonymity claims" rule. |
| **Disclose any required direct network access** | The §5.2 explain screen for setup. A help page, `about:nullpath-network`, lists direct connections for each mode, starting with the i2pd download, router peer and reseed traffic and Direct web itself. |
| **Publish a network diagram** | `docs/nullpath/NETWORK.md`, one diagram showing browser → blocker/filter → local proxy → router → I2P network → outproxy boundary, with router peer/reseed traffic drawn separately. `about:nullpath-network` shows the same diagram. |
| **Firefox's built-in VPN is removed** (PROJECT.md, "Firefox's built-in VPN is removed") | `browser.ipProtection.enabled=false` in `nullpath-overrides.cfg`, so it's off in every profile, and locked in I2P profiles (§8.2) |

---

## 11. Files

New files, under `nullpath/tree-overrides/`:

```
browser/components/nullpath/moz.build
browser/components/nullpath/jar.mn
browser/components/nullpath/router/NullpathRouter.sys.mjs            # state machine, checks (§6)
browser/components/nullpath/router/NullpathRouterWidget.sys.mjs      # CustomizableUI widget (§2)
browser/components/nullpath/router/NullpathRouterPanel.sys.mjs       # panel + subviews (§3)
browser/components/nullpath/router/NullpathRouterDetect.sys.mjs      # detection (§4.2)
browser/components/nullpath/router/NullpathManagedRouter.sys.mjs     # i2pd provisioning/process (§5)
browser/components/nullpath/router/NullpathRouterManifest.sys.mjs    # pinned i2pd version + hash
browser/components/nullpath/router/NullpathRouterConfig.sys.mjs      # router.json / state.json (§7.2–7.3)
browser/components/nullpath/network/NullpathProfileMode.sys.mjs      # mode + locked prefs (§8.2)
browser/components/nullpath/network/NullpathChannelFilter.sys.mjs    # §8.3
browser/components/nullpath/network/NullpathRequestBlocker.sys.mjs   # §8.4
browser/components/nullpath/network/NullpathNetworkErrorObserver.sys.mjs
browser/components/nullpath/tabtree/NullpathTabTree.sys.mjs          # §10
browser/components/nullpath/content/router-panel.css
browser/components/nullpath/tests/{xpcshell,browser}/…
browser/locales/en-US/browser/nullpath/router.ftl
browser/themes/shared/nullpath/router-{off,connecting,connected,attention}.svg
```

Nullpath patches (`nullpath/patches/`, listed in `patches.txt`):

- `nullpath-components.patch`: adds `"nullpath"` to `browser/components/moz.build`
  `DIRS`, calls init from `BrowserGlue`, and adds the panel `<template>` in
  `browser.xhtml`.
- `nullpath-neterror.patch`: the error pages from §7.4 and §8.4.
- `nullpath-early-filter.patch`: registers the channel filter in early startup,
  as `IPPEarlyStartupFilter` does.

Overlay script (`scripts/nullpath-overlay.py`): add the two `ac_add_options` from
§8.1 to the generated `mozconfig`, and bundle the uBO `.xpi` (§8.5).

Settings (`nullpath/settings/nullpath-overrides.cfg`): the prefs that apply to
every profile (`sidebar.*`, `browser.ipProtection.enabled`). Mode-specific
prefs are applied at runtime by `NullpathProfileMode`, because autoconfig can't
tell profiles apart.

---

## 12. Verification

### Automated tests

| Test | Kind |
|---|---|
| State machine transitions, timeouts and reason codes (with a fake proxy) | xpcshell |
| `router.json` and `state.json` round-trips, atomic writes, pruning dead PIDs | xpcshell |
| Detection with fake listeners on 4444/7657/7070 and a non-I2P listener | xpcshell |
| Channel filter never returns `direct` in I2P modes, even when an extension filter tries to | xpcshell |
| Request blocker decision table (§8.4), including redirects and WebSocket upgrades | xpcshell |
| Widget present, not removable and not in overflow after Customize and after resizing to 500 px | browser-chrome |
| First click shows the chooser. **Not now** leaves the state `off`. Chooser → own router → Save and connect. | browser-chrome |
| Switch on/off updates every open window, including a popup | browser-chrome |
| Relay switch writes `notransit` and survives a router restart. It's disabled for a user's own router. | browser-chrome |
| Public-web hand-off (§7.4): opens in a Public web window when ready, shows each "can't open" reason when not, blocks POST, passes no referrer | browser-chrome |
| Keyboard-only walk through the chooser, guided setup and settings. Accessibility checks pass. | browser-chrome |

### Network-level checks (manual, before any release)

Capture with `pktmon` (or Wireshark) filtered to non-loopback traffic from
`nullpath.exe`. Each scenario runs from a fresh install.

1. Launch, idle 5 minutes, open Settings and the About dialog, and open the
   router panel. Expect **no** packets from `nullpath.exe`.
2. Guided setup. Expect exactly one direct connection from `nullpath.exe` (the
   GitHub download). All other traffic comes from `i2pd.exe`.
3. Connected in I2P sites. Load `.i2p` sites, a public-web URL, a page with
   WebRTC, a service worker, a WebSocket, a download and a redirect to the
   public web. Expect nothing from `nullpath.exe`.
4. Kill `i2pd.exe` while pages are loading. Also stop a user-run Java I2P, and
   set the proxy to a closed port. Expect nothing from `nullpath.exe`, and the
   **Not connected** or **Needs attention** pages.
5. Public web with the outproxy reachable, then unreachable (point it at a
   nonexistent destination). Expect nothing from `nullpath.exe` in either
   case, and the **Outproxy unavailable** page. Repeat from an I2P sites
   window: typed public-web URLs must open in a Public web window when the
   outproxy is reachable, and must show **Can't open this site through I2P**
   when it isn't (§7.4).
6. Install an extension that uses `proxy.onRequest` to return `direct`, in a
   test build with add-on installs enabled. Expect nothing from `nullpath.exe`.
7. Direct web: expect normal traffic. The router state has no effect on it.

Publish the results and the capture method with each release. They are the
basis for any claim in help text.

---

## 13. Delivery order

Following PROJECT.md's priorities:

1. **Priority 2 (I2P-site mode):** §2, §3 (without outproxy), §4 with **Use my
   own I2P router** only, §6, §7, §8 for the I2P sites profile, the §10 rows for
   state, tabs and profiles, the relay switch (§3.6), and the §12 tests and
   checks 1, 3, 4 and 7. Until priority 4, the hand-off in §7.4 always ends
   on **Can't open this site through I2P**, with the reason "No outproxy set".
2. **Priority 3 (guided setup):** §5 and the **Set up I2P for me** option, plus
   check 2.
3. **Priority 4 (public web):** §3.5, the `nullpath-publicweb` tunnel, the
   Public web profile and checks 5 and 6.

## 14. Owner decisions (settled 2026-09-22)

1. **i2pd is downloaded during guided setup** (§5.3). It isn't bundled in the
   installer.
2. **Nullpath launches into an I2P sites window.** Public-web addresses opened
   there go through I2P in a Public web via I2P window, or don't load (§7.4).
3. **No auto-connect option for now** (§6.1). The browser always starts Not
   connected.
4. **Relaying for other I2P users is a switch in the router panel, off by
   default** (§3.6, §5.4).
5. **Firefox's built-in VPN is off in every profile.** The reasons are recorded
   in PROJECT.md ("Firefox's built-in VPN is removed").

---

## 15. Implementation status (2026-09-22)

Everything in §2–§8 and the §10 rows is written, across all three delivery
priorities. Nothing has been compiled into a build or run in a browser yet.
The first build is the next step, followed by the §12 tests and the manual
network checks.

### Where it lives

- `nullpath/tree-overrides/browser/components/nullpath/` holds the §11 files,
  plus:
  - `NullpathGlue.sys.mjs`, the startup entry points
  - `router/NullpathLoopback.sys.mjs`, raw TCP/HTTP to local routers
  - `router/NullpathProcess.sys.mjs`, Win32 process helpers
  - `network/NullpathAboutBlocked.sys.mjs` and `actors/`, the error page
  - `NullpathComponents.manifest` and `components.conf`
- Strings: `nullpath/tree-overrides/browser/locales/en-US/browser/nullpath/router.ftl`.
- Icons: `nullpath/tree-overrides/browser/themes/shared/nullpath/`.
- The only upstream edit is `nullpath/patches/nullpath-components.patch`, which
  adds `"nullpath"` to `browser/components/moz.build`.
- `nullpath-overrides.cfg` sets the tree-tab defaults, turns IP protection off
  and adds the fail-closed network defaults.
- `scripts/nullpath-overlay.py` adds the two §8.1 build flags and bundles uBO.

### Where the code departs from the spec, and why

| Spec | Implementation | Reason |
|---|---|---|
| Error pages as `about:neterror` variants via `nullpath-neterror.patch` (§8.4) | A separate page, `about:nullpath-blocked`. It's unprivileged, web pages can't link to it, and it talks to the parent only through the `NullpathBlocked` actor. | neterror gets its text from nsresult codes in C++ (`nsDocShell::DisplayLoadError`) and has no way to add new codes. The actor accepts only the page's own button actions: open panel, connect, retry, go back, switch window, outproxy settings. The URL to retry is re-read from the page's location in the parent. This is a narrow exception to §9: only this page can turn the switch on. |
| Panel `<template>` in `browser.xhtml` (§3.1) | The panelviews are added to each window's `appMenu-viewCache` template at runtime. | Avoids patching `browser.xhtml`. `PanelMultiView.getViewNode` finds views in that template. |
| Init from `BrowserGlue._onFirstWindowLoaded`, and `nullpath-early-filter.patch` (§6.1, §8.3) | Startup categories: the network layer and router in `browser-before-ui-startup`, before any window or session restore. Profiles are set up in `browser-first-window-ready`. | This is the mechanism BrowserGlue uses for IP protection, and it needs no patch. |
| Fail-closed from the first request | `nullpath.cfg` makes every profile start with proxy `127.0.0.1:14444` and DNS off. Direct web's `user.js` undoes that. | Autoconfig can't tell profiles apart, so the safe setting is the default. A profile without `nullpath.mode` (created some other way, or with a deleted `user.js`) is an I2P sites profile. |
| Launch i2pd with `Subprocess.call()` (§5.5) | `CreateProcessW` through ctypes, with `CREATE_BREAKAWAY_FROM_JOB`, tracked by PID and creation time. | Any profile's process has to be able to stop the router, not just the one that started it, so it's tracked by PID anyway. Subprocess puts each child in its own job, and a Subprocess handle is only usable in the process that launched it. Launching it directly means the router has no tie to that process or its job. That settles the §5.5 *Verify* item by design rather than by test. |
| I2PControl `Shutdown` for the managed router, and the "Finding peers" count (§5.5, §6.2) | The i2pd web console: the `terminate` command, then kill after 5 s. Peers and uptime come from the console's main page. I2PControl (JSON-RPC over plain HTTP) is still used for a user's own Java I2P router. | i2pd serves I2PControl over TLS with a self-signed certificate, which chrome JS can't reach without a certificate exception. *Verify the console command names (`terminate`, `enable_transit`, `disable_transit`, `reload_tunnels_config`) against i2pd 2.61.0.* |
| Setup download is "the only direct request" (§5.3) | It also needs a DNS lookup for github.com. `network.dns.disabled` is unlocked only for the length of that download, then locked again. The explain screen says so. | DNS is disabled application-wide in I2P profiles (§8.2), so a direct download can't resolve otherwise. Every other channel still goes to the proxy, which resolves names itself. |
| Test outproxy with `HEAD https://github.com/…` (§3.5) | A `CONNECT github.com:443` through the public-web proxy. Only the proxy's answer is read. | This checks the outproxy path without a TLS stack on a raw socket, and nothing is sent to GitHub inside the tunnel. |
| "Public-web tunnel present but disabled" (§5.4) | The `[nullpath-publicweb]` tunnel is written only once an outproxy is set. | i2pd has no per-tunnel `enabled` key. |
| Bandwidth Low/Medium/High | i2pd classes `L` / `O` / `P`. | These are i2pd's class letters. |
| `browser.xhtml` title suffix (§10) | The profile names ("Nullpath: I2P sites", …) are used. | Firefox already adds the profile name to the window title once a group has more than one profile. |
| Button just left of ☰ (§2.1) | The last customizable nav-bar slot, left of the extensions button and ☰. | Neither of those two buttons is a CustomizableUI placement, so nothing can be placed after them. |

### Pinned i2pd

`NullpathRouterManifest.sys.mjs` pins i2pd **2.61.0**
(`i2pd_2.61.0_win64_mingw.zip`, 4,301,473 bytes), SHA-256
`a0a8fb199a6bc5b487df71567791de6997050b921d65622ef9e936ffa88bc83f`. The hash
is the digest GitHub reports for that release asset. Before a release, check it
against a local download and the i2pd maintainers' signed checksums.

### Not done yet

- **Build and run.** Nothing has been compiled yet. Before merging, run
  `prepare` + `build` and the §12 tests. The tests are in `tests/` but only
  run in a build without `--disable-tests`.
- The keyboard shortcut in `customkeys` (§2.2).
- The `about:nullpath-network` page (§10). The diagram exists in
  [NETWORK.md](NETWORK.md).
- "Close all windows of this mode" in the profile menu (§10).
- The i2pd license in `about:license`, and the uninstaller checkbox (§5.6).
- **uBO bundling.** It needs the signed `.xpi` in `nullpath/extensions/` and
  a `SHA256SUMS` line. Until then, the AMO install stays: I2P profiles block
  it, and only Direct web installs uBO.
- Verifying the detection signatures (§4.2), the Java I2P config paths, and
  the i2pd console commands against the real programs.
