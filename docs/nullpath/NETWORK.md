# Nullpath network paths

This page shows where Nullpath's traffic goes in each browsing mode. It
implements the "Publish a network diagram" row of
[I2P-ROUTER-TOGGLE.md §10](I2P-ROUTER-TOGGLE.md). It describes the design;
it is not a claim about anonymity. The measured results from §12 are published
with each release.

```
 I2P sites / Public web via I2P profile (nullpath.exe)
 ┌──────────────────────────────────────────────────────────────────────┐
 │ page, extension, service worker, download, redirect                  │
 │        │                                                             │
 │        ▼                                                             │
 │ Request blocker (§8.4)  ── not allowed ──► about:nullpath-blocked    │
 │        │ allowed                                                     │
 │        ▼                                                             │
 │ Channel filter (§8.3): always the mode's proxy, never direct         │
 │        │                     (locked proxy prefs, DNS off, §8.2)     │
 └────────┼─────────────────────────────────────────────────────────────┘
          ▼ loopback only
   Local HTTP proxy  ─────────────  I2P sites: 127.0.0.1:14444 (managed)
          │                         Public web: 127.0.0.1:14450 (managed)
          ▼                         or the user's own router's proxy
   I2P router (i2pd.exe or the user's router)
          │
          ▼
   I2P network ──────────────► .i2p sites
          │
          ▼ Public web via I2P only
   Outproxy (third party, chosen by the user) ──► public websites

 Router traffic, separate from browser traffic (i2pd.exe, not nullpath.exe):
   i2pd.exe ──► other I2P routers (NTCP2/SSU2 on one port, 20000–40000)
   i2pd.exe ──► I2P reseed servers (to find peers)

 Direct connections from nullpath.exe in I2P profiles:
   Guided setup only: one HTTPS download of the pinned i2pd release from
   github.com (and its asset CDN), plus the DNS lookup for it (§5.3).

 Direct web profile:
   Ordinary internet connections, like any browser. The router state has
   no effect on it.
```

Router checks (port checks, proxy identification, the i2pd web console and
I2PControl) use raw loopback sockets from the parent process. They never
leave the computer, except for a user's own router on the local network when
"Allow a proxy on my local network" is on.
