# fastgithub-accelerate

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Make DSH's GitHub traffic ride [FastGithub](https://github.com/FastGithub/FastGithub)
automatically — no manual proxy config, no browser extension, no rebuild.

Once installed, `web_fetch` / `web_search`, `git` / `curl`, and Node-side `fetch`
all accelerate GitHub transparently, and a small badge in the composer shows the
live status.

![status badge](assets/badge.png)

## Why

- **FastGithub on Windows** accelerates via a **DNS hijack** (`github.com` →
  `127.0.0.1`) plus local interceptors on `127.0.0.1:80/443/22/9418`; its HTTP
  proxy port (`HttpProxyPort: 38457`) is documented **linux/osx-only**.
- **DSH** by contrast *rejects* loopback-resolved hosts: `dsh-web-fetch-http`
  pins public IPs and refuses `WEB_BLOCKED_URL` for FastGithub's hijacked
  addresses — **unless** the URL is routed through an installed proxy policy,
  where the pin is skipped and the proxy does the resolving.

This bundle bridges the two.

## How it works

1. **Host (`index.js`)** starts a loopback HTTP forward proxy (CONNECT tunnels +
   absolute-form forwarding). Plain DNS resolves GitHub through FastGithub's
   interceptors; every other host passes through untouched.
2. It loads `@deepseek-ai/dsh-http-proxy` from its canonical realpath (the same
   module instance the harness uses) and calls `installProxyFromEnvironment` with
   its own endpoint, so:
   - `web_fetch` / `web_search` tunnel through it — GitHub fetches that were
     previously blocked now work;
   - `git`, `curl` and other children inherit `http(s)_proxy` env;
   - undici's global dispatcher routes Node-side `fetch`.
3. It probes FastGithub every 60 s (DNS hijack + interceptor ports) and serves
   `GET /fastgithub/status` for the badge.
4. **Client (`client.js`)** renders a composer badge (`🚀 FastGithub 加速中`) from
   that status route. No browser request is ever rewritten — a browser speaks
   origin-form, which no forward proxy can serve.

A proxy exported at launch time wins over the plugin's endpoint (the plugin never
overrides a user's own proxy); the badge then reports the inherited policy.

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
| `accelerating` | proxy installed **and** DNS hijack detected |
| `policy` | `proxied` / `none` |
| `fastgithub.dnsHijack` | `github.com` resolves to loopback |
| `fastgithub.interceptor443` | FastGithub `:443` interceptor is up |
| `module` | `ok` / `unavailable` (dsh-http-proxy import) |
| `port` / `endpoint` | the plugin's loopback proxy |

## Config

No `Config` export — defaults: port `39467` (auto-advances when busy),
probe interval `60000` ms.

## Requirements

- FastGithub service running (`fastgithub.exe start` / FastGithub UI).
- The FastGithub README setup: `http.sslverify false`, root `CN=FastGithub` in
  the trusted store.

## License

[MIT](LICENSE)