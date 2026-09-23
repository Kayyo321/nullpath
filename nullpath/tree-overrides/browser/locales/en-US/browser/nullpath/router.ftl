# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

# Nullpath I2P router control (docs/nullpath/I2P-ROUTER-TOGGLE.md).
# Copy rule: never describe any of this as "anonymous", "untraceable" or
# "leak-proof".

## Toolbar button (§2.2). Each state has its own label and tooltip.
## Variables:
##   $reason (String) - one-sentence reason from the "Needs attention" list

nullpath-router-button-off =
    .label = I2P router
    .tooltiptext = I2P router: Not connected
nullpath-router-button-setup =
    .label = I2P router
    .tooltiptext = I2P router: Not connected. Set up I2P
nullpath-router-button-connecting =
    .label = I2P router
    .tooltiptext = I2P router: Connecting…
nullpath-router-button-connected =
    .label = I2P router
    .tooltiptext = I2P router: Connected
nullpath-router-button-attention =
    .label = I2P router
    .tooltiptext = I2P router: Needs attention. { $reason ->
        [ROUTER_EXITED] Router stopped unexpectedly.
        [ROUTER_MISSING] The router program is missing.
        [PROXY_UNREACHABLE] Nothing is answering at the proxy address.
        [PROXY_NOT_I2P] The proxy address isn’t an I2P proxy.
        [START_TIMEOUT] The router is taking longer than expected to connect.
       *[other] Open the router panel for details.
    }

## Main view (§3.2)

nullpath-router-title = I2P router
nullpath-router-switch-on =
    .label = On
    .aria-label = I2P router: On
nullpath-router-switch-off =
    .label = Off
    .aria-label = I2P router: Off

## Status line. Variables:
##   $state (String) - "off", "connecting", "connected" or "attention"
##   $router (String) - "managed", "java", "i2pd", "other" or "none"
##   $endpoint (String) - the proxy address of the user's own router

nullpath-router-status = { $state ->
        [connecting] Connecting…
        [connected] Connected
        [attention] Needs attention
       *[off] Not connected
    } · { $router ->
        [managed] i2pd, managed by { -brand-short-name }
        [java] Your router (Java I2P) at { $endpoint }
        [i2pd] Your router (i2pd) at { $endpoint }
        [other] Your router at { $endpoint }
       *[none] No router set up
    }

nullpath-router-stage-starting = Starting router
nullpath-router-stage-peers = Finding peers
nullpath-router-stage-proxy = Checking the I2P proxy
nullpath-router-cancel = Cancel
nullpath-router-first-start-note = The first start usually takes a few minutes while the router finds peers and builds tunnels.
nullpath-router-first-site-note = The first I2P site can take a minute to load while the router builds tunnels.

nullpath-router-action-restart = Restart router
nullpath-router-action-retry = Retry
nullpath-router-action-edit = Edit router
nullpath-router-action-manage = Manage router
nullpath-router-action-wait = Keep waiting
nullpath-router-action-console = View router console
nullpath-router-action-reinstall = Reinstall router
nullpath-router-reinstalling = Reinstalling the router…

## Why the router needs attention, shown in the panel. Variables:
##   $reason (String) - one of the reasons in nullpath-router-button-attention

nullpath-router-attention-reason = { $reason ->
        [ROUTER_EXITED] The router stopped unexpectedly.
        [ROUTER_MISSING] The router program is missing. Antivirus software sometimes removes it by mistake. Restore i2pd.exe from your antivirus’s quarantine and allow { -brand-short-name }’s router folder, then restart the router. Or reinstall it.
        [PROXY_UNREACHABLE] Nothing is answering at the proxy address.
        [PROXY_NOT_I2P] The proxy address isn’t an I2P proxy.
        [START_TIMEOUT] The router is taking longer than expected to connect.
        [OUTPROXY_UNREACHABLE] The outproxy isn’t responding.
       *[other] Something went wrong with the router.
    }

nullpath-router-modes-heading = Browsing modes
nullpath-mode-i2p-sites = I2P sites
nullpath-mode-i2p-publicweb = Public web via I2P
nullpath-mode-direct = Direct web
nullpath-mode-this-window = This window
nullpath-mode-status-ready = Ready
nullpath-mode-status-unavailable = Unavailable
nullpath-mode-status-no-outproxy = No outproxy set
nullpath-mode-status-outproxy-unreachable = Outproxy unreachable
nullpath-mode-status-checking = Checking…
nullpath-mode-status-direct = Doesn’t use I2P

nullpath-router-proxy-label = Proxy
nullpath-router-router-label = Router
# Variables:
#   $uptime (String) - e.g. "12 min"
#   $peers (Number) - known peers
nullpath-router-details = Running { $uptime } · { $peers } peers
nullpath-router-details-unavailable = Router details: not available

nullpath-router-relay =
    .label = Relay traffic for other I2P users
nullpath-router-relay-help = Relaying helps the I2P network work and can help your own traffic blend in with other traffic. It uses more of your bandwidth, and your computer will carry encrypted traffic for other people. { -brand-short-name } can’t see or change that traffic.
nullpath-router-relay-help-short = Uses more bandwidth and carries encrypted traffic for other I2P users.
nullpath-router-relay-restart = Applies after the router restarts.
nullpath-router-relay-expire = Turning relaying off doesn’t cut existing relayed tunnels. They expire within about 10 minutes.
nullpath-router-relay-external = Set this in your router’s bandwidth or sharing settings.

nullpath-router-open-i2p-window = Open I2P window
nullpath-router-console = Router console ↗
nullpath-router-settings = Settings
nullpath-router-help = Help

## Subview titles

nullpath-view-settings =
    .title = Settings
nullpath-view-manage =
    .title = { -brand-short-name }’s router
nullpath-view-own =
    .title = Use my own I2P router
nullpath-view-outproxy =
    .title = Outproxy (Public web via I2P)
nullpath-view-advanced =
    .title = Advanced
nullpath-view-whatis =
    .title = What is I2P?

## Chooser (§4.3). Variables:
##   $size (Number) - download size in MB
##   $endpoint (String) - detected proxy address

nullpath-chooser-title = Connect { -brand-short-name } to I2P
nullpath-chooser-intro = { -brand-short-name } reaches I2P sites through an I2P router, a program that runs on this computer. Choose one:
nullpath-chooser-recommended = Recommended
nullpath-chooser-managed = Set up I2P for me
nullpath-chooser-managed-body = { -brand-short-name } downloads and runs i2pd (about { $size } MB). You can remove it at any time.
nullpath-chooser-own = Use my own I2P router
nullpath-chooser-detecting = Looking for an I2P router on this computer…
nullpath-chooser-found = Found: an I2P proxy at { $endpoint }
nullpath-chooser-not-now = Not now
nullpath-chooser-whatis = What is I2P?

nullpath-whatis-router = An I2P router is a separate program. It connects to other I2P routers over your ordinary internet connection.
nullpath-whatis-browser-only = { -brand-short-name } sends only its own browser traffic through I2P.
nullpath-whatis-other-apps = Other apps on this computer aren’t affected.
nullpath-whatis-faq = I2P FAQ ↗

## Own router form (§4.3)

nullpath-own-kind = Router type
nullpath-own-kind-java-i2p =
    .label = Java I2P
nullpath-own-kind-i2pd =
    .label = i2pd
nullpath-own-kind-other =
    .label = Other
nullpath-own-sites-proxy = I2P-sites HTTP proxy (IP:port)
nullpath-own-publicweb-proxy = Public-web HTTP proxy (optional)
nullpath-own-console = Router console URL (optional)
nullpath-own-control = I2PControl URL (optional)
nullpath-own-control-password = I2PControl password
nullpath-own-password-warning = The password is stored in plain text in router.json, the same way routers store their own.
nullpath-own-lan-warning = Traffic between { -brand-short-name } and this proxy isn’t encrypted and can be seen on your local network.
nullpath-own-lan-confirm-needed = Confirm the local-network warning first.
nullpath-own-test = Test
nullpath-own-save = Save
nullpath-own-save-connect = Save and connect

# Variables:
#   $endpoint (String) - the tested address
nullpath-router-test-running = Checking…
nullpath-router-test-none = No program is listening on { $endpoint }
nullpath-router-test-other = Something answered on { $endpoint }, but it doesn’t look like an I2P proxy
nullpath-router-test-ok = I2P proxy found

nullpath-router-error-endpoint-format = Enter an IP address and port, like 127.0.0.1:4444. Host names can’t be used.
nullpath-router-error-endpoint-port = The port must be between 1 and 65535.
nullpath-router-error-endpoint-not-loopback = Use an address on this computer (127.0.0.1), or turn on “Allow a proxy on my local network” in Advanced.
nullpath-router-error-endpoint-not-lan = Only addresses on this computer or your local network are allowed.
nullpath-router-error-url-format = Enter an http:// address with an IP, like http://127.0.0.1:7657/

## Guided setup (§5.2–5.3). Variables:
##   $version (String) - pinned i2pd version
##   $percent (Number) - download progress

nullpath-setup-title = Set up I2P
nullpath-setup-what = { -brand-short-name } installs i2pd { $version }, downloaded from github.com/PurpleI2P/i2pd/releases. { -brand-short-name } checks the download against a fingerprint built into this release.
nullpath-setup-where = It goes in %LOCALAPPDATA%\nullpath\i2p-router\. That folder holds the program, its settings, the router’s identity and its address book.
nullpath-setup-network-download = This one download is a direct connection to GitHub, including a lookup of GitHub’s address. It doesn’t go through I2P.
nullpath-setup-network-router = Once running, i2pd connects directly to other I2P routers and to I2P “reseed” servers to find peers. That is router traffic, separate from browser traffic.
nullpath-setup-network-firewall = Windows may ask whether to allow i2pd through the firewall. Allowing it on private networks helps other routers reach this one. Blocking it still works, but more slowly.
nullpath-setup-network-relay = Relaying traffic for other I2P users starts off. You can turn it on later in the router panel.
nullpath-setup-unchanged = Existing I2P installs, their settings and other apps aren’t changed.
nullpath-setup-remove = To remove it: Settings › Router › Manage › Remove { -brand-short-name }’s router.
nullpath-setup-back = Back
nullpath-setup-install = Install

nullpath-setup-step-download = { $percent ->
    [0] Downloading
   *[other] Downloading ({ $percent }%)
}
nullpath-setup-step-verify = Checking the download
nullpath-setup-step-install = Installing
nullpath-setup-step-ports = Choosing ports
nullpath-setup-step-start = Starting the router

nullpath-setup-error-download = The download didn’t finish. Check your connection and try again.
nullpath-setup-error-hash = The download didn’t match what { -brand-short-name } expected, so it wasn’t installed.
nullpath-setup-error-install = The download didn’t contain i2pd, so nothing was installed.
nullpath-setup-error-ports = { -brand-short-name } couldn’t find free ports for the router.
nullpath-setup-error-missing = The router program is missing. Use Restart guided setup to install it again.
nullpath-setup-error-generic = Setup didn’t finish. Nothing was left behind.
nullpath-setup-cancelled = Setup was cancelled. Nothing was left behind.

## Settings (§3.4)

nullpath-settings-router = Router
nullpath-settings-managed = { -brand-short-name }-managed i2pd
nullpath-settings-external = My own router
nullpath-settings-manage = Manage
nullpath-settings-install = Set up
nullpath-settings-edit = Edit
nullpath-settings-outproxy = Outproxy (Public web via I2P)
nullpath-settings-advanced = Advanced
nullpath-settings-restart-setup = Restart guided setup

nullpath-manage-none = { -brand-short-name } hasn’t installed a router.
nullpath-manage-version = Version
nullpath-manage-folder = Data folder
nullpath-manage-open-folder = Open folder
nullpath-manage-ports = Ports
nullpath-manage-bandwidth = Bandwidth
nullpath-manage-bandwidth-low =
    .label = Low
nullpath-manage-bandwidth-medium =
    .label = Medium
nullpath-manage-bandwidth-high =
    .label = High
nullpath-manage-restart-note = Applies after the router restarts.
nullpath-manage-keep-running =
    .label = Keep the router running when { -brand-short-name } is disconnected
nullpath-manage-upnp =
    .label = Use UPnP
nullpath-manage-upnp-help = UPnP changes your home router’s settings from this computer so other I2P routers can reach this one. Connections get faster and more reliable, but it opens a port on your home router.
nullpath-manage-console-password = Console password
# Variables:
#   $version (String) - the version this release pins
nullpath-manage-update = Update router to { $version }
nullpath-manage-remove = Remove { -brand-short-name }’s router
nullpath-manage-remove-warning = This stops i2pd and deletes its folder, including the router’s identity and address book.
nullpath-copy = Copy
nullpath-show = Show

## Outproxy (§3.5)

nullpath-outproxy-intro = Public web via I2P needs an outproxy. { -brand-short-name } never picks one for you.
nullpath-outproxy-needs-router = Set up a router first.
nullpath-outproxy-destination = Outproxy (.i2p name or .b32.i2p address)
nullpath-outproxy-note = Note about who runs it (optional)
nullpath-outproxy-error-destination = Enter a .i2p name or .b32.i2p address.
nullpath-outproxy-suggestions = Suggestions (I2P FAQ) ↗
nullpath-outproxy-ack = An outproxy is run by a third party, not by the I2P project or { -brand-short-name }. It can see which public websites you visit, and it can see the contents of any site that doesn’t use HTTPS. If it goes down, public-web browsing stops. { -brand-short-name } won’t switch to a direct connection.
nullpath-outproxy-ack-check = I understand
nullpath-outproxy-test = Test outproxy
nullpath-outproxy-test-send = Send test
# Variables:
#   $url (String) - the test address
nullpath-outproxy-test-url = The test asks the outproxy to connect to { $url }.
nullpath-outproxy-reachable = Reachable
# Variables:
#   $status (Number) - the proxy's HTTP status
nullpath-outproxy-unreachable = Unreachable (proxy answered { $status })
nullpath-outproxy-no-response = Unreachable (no response from the outproxy; it may be offline, or your router may not have finished connecting)

## Advanced

nullpath-advanced-interval = Check the router every (seconds)
nullpath-advanced-console-link =
    .label = Show the router console link
nullpath-advanced-allow-lan =
    .label = Allow a proxy on my local network
nullpath-advanced-diagnostics = Copy diagnostics
nullpath-advanced-diagnostics-copied = Copied

## Window banner and tree tabs

nullpath-banner-not-connected = Not connected to I2P. Use the router button at the top right to connect.
# Variables:
#   $level (Number) - depth in the tab tree, starting at 1
nullpath-tab-level = level { $level }

## about:nullpath-blocked (§7.4, §8.4)

nullpath-blocked-page-title = Page not loaded
nullpath-blocked-address = Address:
nullpath-blocked-not-connected-title = Not connected to I2P
nullpath-blocked-not-connected-desc = { -brand-short-name } isn’t connected to an I2P router, so this window doesn’t load anything. It never falls back to a direct connection.
nullpath-blocked-cant-open-title = Can’t open this site through I2P
nullpath-blocked-cant-open-desc = Public websites open in a Public web via I2P window, which reaches them through I2P and an outproxy. That path isn’t available right now.
nullpath-blocked-handed-off-title = Opened in a Public web via I2P window
nullpath-blocked-handed-off-desc = Public websites open in their own window, which has separate cookies and history.
nullpath-blocked-form-blocked-title = This form can’t be sent from an I2P sites window
nullpath-blocked-form-blocked-desc = Sending it would carry information from an I2P site to a public website. Open the public website in a Public web via I2P window instead.
nullpath-blocked-outproxy-unavailable-title = Outproxy unavailable
nullpath-blocked-outproxy-unavailable-desc = This window reaches public websites through an outproxy, and it isn’t working right now. { -brand-short-name } won’t switch to a direct connection.
nullpath-blocked-local-blocked-title = Local addresses are blocked in this window
nullpath-blocked-local-blocked-desc = I2P windows don’t load addresses on this computer or your local network.
nullpath-blocked-reason-not-connected = Reason: not connected to I2P.
nullpath-blocked-reason-connecting = Reason: still connecting. The page continues automatically when ready.
nullpath-blocked-reason-no-outproxy = Reason: no outproxy set.
nullpath-blocked-reason-outproxy-unreachable = Reason: the outproxy isn’t responding.
nullpath-blocked-reason-no-profile = Reason: the Public web via I2P profile doesn’t exist yet.
nullpath-blocked-connect = Connect
nullpath-blocked-open-panel = Open router panel
nullpath-blocked-setup-outproxy = Set up an outproxy
nullpath-blocked-try-again = Try again
nullpath-blocked-change-outproxy = Change outproxy
nullpath-blocked-go-back = Go back
nullpath-blocked-switch-window = Switch to that window
nullpath-blocked-status-connecting = Connecting…

## Site information for .i2p pages, which Nullpath treats as secure because
## I2P encrypts them end to end.

nullpath-identity-connection-i2p = Connected securely through I2P
nullpath-identity-connection-i2p-details = This site is on the I2P network. I2P encrypts the connection end to end and hides where both you and the site are, so it doesn’t need HTTPS.
