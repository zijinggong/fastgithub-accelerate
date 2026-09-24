# fastgithub-accelerate

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Make DSH's GitHub traffic accelerate automatically through **either** a local
[FastGithub](https://github.com/FastGithub/FastGithub) install **or** any custom
HTTP(S) proxy you configure — no manual proxy config, no browser extension, no
rebuild.

Once installed, `web_fetch` / `web_search`, `git` / `curl`, and Node-side `fetch`
all accelerate GitHub transparently, and a small badge in the composer shows the
live status and which acceleration source is active.

![status badge](assets/badge.png)

## Why

- **DSH** *rejects* loopback-resolved hosts: `dsh-web-fetch-http` pins public IPs
  and refuses `WEB_BLOCKED_URL` for any host that resolves to a private/loopback
  address — **unless** the URL is routed through an installed proxy policy, where
  the pin is skipped and the proxy does the resolving.
- Any accelerator that hands GitHub traffic to a faster path fixes this the
  moment it is wired into DSH's proxy policy.

This bundle wires an acceleration source into that policy — FastGithub when it is
present, otherwise a custom proxy you configure.

## How it works

1. **Host (`index.js`)** picks the active acceleration source (`status.source`):
   - `fastgithub` — when FastGithub's DNS hijack is up, DSH traffic is routed
     through this plugin's loopback forward proxy (`127.0.0.1:39467`), whose DNS
     resolution lands on FastGithub's interceptors;
   - `custom-proxy` — when `config.proxyUrl` is set (and FastGithub is absent or
     `mode` says so), DSH traffic is routed straight to that upstream HTTP(S)
     proxy (a gh-proxy / Cloudflare-Workers accelerator, corporate proxy, VPN
     node, ...). No local FastGithub, no MITM cert needed.
2. It loads `@deepseek-ai/dsh-http-proxy` from its canonical realpath (the same
   module instance the harness uses) and calls `installProxyFromEnvironment` with
   the active endpoint, so:
   - `web_fetch` / `web_search` tunnel through it — GitHub fetches that were
     previously blocked now work;
   - `git`, `curl` and other children inherit `http(s)_proxy` env;
   - undici's global dispatcher routes Node-side `fetch`.
3. It probes every 60 s (FastGithub hijack + configured proxy) and serves
   `GET /fastgithub/status` for the badge.
4. **Client (`client.js`)** renders a composer badge showing the active source
   (`🚀 FastGithub 加速中` / `🚀 自定义代理加速中` / ⚠ no source). No browser
   request is ever rewritten — a browser speaks origin-form, which no forward
   proxy can serve.

A proxy exported at launch time always wins over the plugin's endpoint (the plugin
never overrides a user's own proxy); the badge then reports the inherited policy.

## Install

In the target DSH:

```
plugin_manager → action: install_bundle → target: <path-to>/fastgithub-accelerate
```

Or from a GitHub repo / npm once published:

```
dsh plugin --profile web add <owner>/<repo>
```

See [INSTALL.md](INSTALL.md) for prerequisites (FastGithub running, DNS hijack
active, MITM root cert trusted) and verification steps.

## Status

| Field | Meaning |
|-------|---------|
| `accelerating` | proxy installed **and** an acceleration source is active |
| `source` | `fastgithub` / `custom-proxy` / `none` |
| `policy` | `proxied` / `none` |
| `proxyUrl` | the configured custom proxy (when `source` is `custom-proxy`) |
| `fastgithub.dnsHijack` | `github.com` resolves to loopback |
| `fastgithub.interceptor443` | FastGithub `:443` interceptor is up |
| `module` | `ok` / `unavailable` (dsh-http-proxy import) |
| `port` / `endpoint` | the plugin's loopback proxy |

## Config

The bundle exports a `Config` with two keys:

| Key | Default | Meaning |
|-----|---------|---------|
| `mode` | `auto` | `auto` \| `fastgithub` \| `custom-proxy`. `auto` uses FastGithub when its DNS hijack is up, else falls back to `proxyUrl` when set. |
| `proxyUrl` | *(empty)* | `http://host:port` of an upstream HTTP(S) proxy to accelerate through when FastGithub is absent — e.g. a gh-proxy accelerator, a corporate proxy, or a VPN node. |

## Requirements

- **Either** FastGithub running (`fastgithub.exe start` / FastGithub UI) with the
  FastGithub README setup (`http.sslverify false`, root `CN=FastGithub` in the
  trusted store) — **or** a reachable custom proxy passed via `config.proxyUrl`.
- With neither, the plugin loads harmlessly but reports `source: "none"` and does
  not accelerate.

## License

[MIT](LICENSE)