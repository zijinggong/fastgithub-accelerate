import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const name = "fastgithub-accelerate";
const inject = ["webServer"];

// Two acceleration sources are supported:
//   1. FastGithub (default): a local DNS hijack (github.com -> 127.0.0.1) plus
//      interceptors on 127.0.0.1:80/443/22/9418. This plugin owns its own loopback
//      forwarding port and lets FastGithub accelerate underneath. Requires the
//      FastGithub service + trusted MITM root cert on the machine.
//   2. Custom proxy (config.proxyUrl): any HTTPS HTTP(S) proxy (a corporate proxy,
//      a gh-proxy / Cloudflare-Workers accelerator, a VPN node, ...). No local
//      FastGithub, no DNS hijack, no MITM cert needed — DSH's traffic is simply
//      routed through the configured upstream.
//
// On Windows FastGithub's own HTTP proxy port is documented linux/osx-only
// ("HttpProxyPort": 38457 // http代理端口，linux/osx平台使用), so this plugin owns its
// own loopback forwarding port.
const DEFAULTS = { port: 39467, probeIntervalMs: 60000, mode: "auto", proxyUrl: "" };

const GITHUB_HOST_SUFFIXES = [
  ".github.com", ".github.io", ".githubapp.com", ".githubassets.com",
  ".githubusercontent.com", ".githubstatus.com",
];

function isGitHubHost(hostname) {
  const h = String(hostname).toLowerCase();
  return h === "github.com" || GITHUB_HOST_SUFFIXES.some((s) => h.endsWith(s));
}

// Load @deepseek-ai/dsh-http-proxy from ITS canonical location so this import is
// the same module instance dsh-subprocess/web-fetch-http already use: the policy
// and undici dispatcher are module-local, sharing state requires a realpath match.
async function loadHttpProxy() {
  const candidates = [];
  const argv1 = process.argv[1];
  if (argv1) {
    let dir = path.dirname(path.resolve(argv1));
    for (let i = 0; i < 8; i++) {
      candidates.push(path.join(dir, "node_modules", "@deepseek-ai", "dsh-http-proxy", "lib", "index.js"));
      candidates.push(path.join(dir, "dsh-http-proxy", "lib", "index.js"));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const canonical = fs.realpathSync(file);
      const mod = await import(pathToFileURL(canonical).href);
      if (typeof mod?.installProxyFromEnvironment === "function") return mod;
    } catch { /* try next candidate */ }
  }
  return null;
}

// EnvLookup over the real launch environment. When config.proxyUrl is set that is
// the only source we publish; otherwise we offer our loopback proxy for both
// schemes (a real user-exported proxy always wins).
function makeEnvLookup(proxyUrl) {
  return {
    get(variable) {
      const value = process.env[variable];
      if (value !== undefined && value !== "") return { value };
      if (["http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY"].includes(variable)) {
        return { value: proxyUrl };
      }
      return undefined;
    },
  };
}

async function probePort(port, host = "127.0.0.1", timeoutMs = 1200) {
  return await new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (result) => { socket.removeAllListeners(); socket.destroy(); resolve(result); };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function probeFastGithub() {
  let dnsHijack = false;
  try {
    const dns = await import("node:dns");
    const records = await dns.promises.lookup("github.com", { all: true });
    dnsHijack = records.some((r) => r.address === "127.0.0.1" || r.address === "::1");
  } catch { dnsHijack = false; }
  const interceptor443 = await probePort(443);
  const selfProxy = await probePort(PORT).catch(() => false);
  return { dnsHijack, interceptor443, selfProxy };
}

let PORT = DEFAULTS.port;

// Minimal HTTP forward proxy: CONNECT tunnels for https (byte-pipe; DNS resolution
// happens here, so GitHub names land on FastGithub's hijacked loopback and are
// accelerated by its interceptor — or are forwarded by whatever the custom proxy
// resolves), absolute-form forwarding for plain http.
function startProxyServer(state) {
  return new Promise((resolve) => {
    const sockets = new Set();
    const server = http.createServer((request, response) => {
      if (!request.url || !request.url.startsWith("http://")) {
        response.writeHead(400, { "content-type": "text/plain" });
        response.end("fastgithub-accelerate: absolute-form request required\n");
        return;
      }
      let target;
      try { target = new URL(request.url); } catch { response.writeHead(400); response.end("bad url"); return; }
      const upstream = http.request({
        hostname: target.hostname, port: target.port || 80,
        path: target.pathname + target.search, method: request.method,
        headers: { ...request.headers, host: target.host }, agent: false,
      }, (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      });
      upstream.on("error", (error) => {
        if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain" });
        response.end(`fastgithub-accelerate: upstream ${error.code || error.message}\n`);
      });
      request.pipe(upstream);
    });
    server.on("connect", (request, clientSocket, head) => {
      const [host, portText] = String(request.url || "").split(":");
      const port = Number(portText) || 443;
      const upstream = net.connect(port, host, () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head && head.length) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      const fail = () => {
        if (!clientSocket.destroyed) clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        upstream.destroy();
      };
      upstream.once("error", fail);
      clientSocket.once("error", () => upstream.destroy());
      sockets.add(upstream); sockets.add(clientSocket);
      upstream.once("close", () => sockets.delete(upstream));
      clientSocket.once("close", () => sockets.delete(clientSocket));
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    server.on("clientError", (_error, socket) => socket.destroy());

    const attempt = (candidate, tried) => {
      if (tried >= 20) { resolve({ error: "no free port in range" }); return; }
      const onError = (error) => {
        server.removeListener("listening", onListening);
        if (error && error.code === "EADDRINUSE") { PORT = candidate + 1; attempt(PORT, tried + 1); }
        else resolve({ error: error ? String(error.message) : "listen failed" });
      };
      const onListening = () => {
        server.removeListener("error", onError);
        state.close = () => new Promise((res) => {
          for (const socket of sockets) socket.destroy();
          sockets.clear();
          server.close(() => res());
        });
        resolve({ server });
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(candidate, "127.0.0.1");
    };
    attempt(PORT, 0);
  });
}

function snapshot(state) {
  // "accelerating" means the DSH proxy policy is installed AND an actual
  // acceleration source is active: FastGithub's DNS hijack, or a configured
  // custom proxy. With neither, the loopback proxy is inert (no benefit).
  const sourceActive = state.source === "fastgithub"
    ? Boolean(state.fastgithub?.dnsHijack)
    : state.source === "custom-proxy"
      ? Boolean(state.proxyUrl)
      : false;
  return {
    accelerating: Boolean(state.listening && state.policy === "proxied" && sourceActive),
    source: state.source || "none",
    endpoint: `http://127.0.0.1:${PORT}`,
    port: PORT,
    listening: Boolean(state.listening),
    policy: state.policy || "none",
    proxyUrl: state.proxyUrl || null,
    fastgithub: state.fastgithub || null,
    module: state.module || "unknown",
    launchProxyInherited: Boolean(state.launchProxyInherited),
    lastError: state.lastError || null,
    checkedAt: new Date().toISOString(),
  };
}

// --- Config export -----------------------------------------------------------
//   mode:      "auto" | "fastgithub" | "custom-proxy"
//              auto = FastGithub when its DNS hijack is up, else fall back to
//                     proxyUrl when set; never an error.
//   proxyUrl:  "http://host:port" of any upstream HTTP(S) proxy to accelerate
//              through when FastGithub is absent (gh-proxy, corporate proxy,
//              VPN node, ...). Overrides the FastGithub path when mode is
//              "custom-proxy"; with mode "auto" it is the fallback source.
function resolveSource(settings, fastgithub) {
  const cfgUrl = String(settings.proxyUrl || "").trim();
  const fgUp = Boolean(fastgithub?.dnsHijack);
  switch (settings.mode) {
    case "fastgithub":
      return { source: "fastgithub", proxyUrl: "" };
    case "custom-proxy":
      return { source: cfgUrl ? "custom-proxy" : "none", proxyUrl: cfgUrl };
    case "auto":
    default:
      if (fgUp) return { source: "fastgithub", proxyUrl: "" };
      if (cfgUrl) return { source: "custom-proxy", proxyUrl: cfgUrl };
      return { source: "none", proxyUrl: "" };
  }
}

async function apply(ctx, config = {}) {
  const settings = { ...DEFAULTS, ...(config || {}) };
  PORT = settings.port || DEFAULTS.port;
  const state = {};

  // Register the status route FIRST so diagnostics are always reachable.
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/fastgithub/status",
    handler: (_request, response) => {
      const body = JSON.stringify(snapshot(state));
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(body);
    },
  }), "fastgithub-accelerate:status-route");

  const listen = await startProxyServer(state);
  if (listen.error) state.lastError = `proxy listen: ${listen.error}`;
  else state.listening = true;

  state.fastgithub = await probeFastGithub();
  const resolved = resolveSource(settings, state.fastgithub);
  state.source = resolved.source;
  state.proxyUrl = resolved.proxyUrl;

  if (state.source === "none") {
    state.lastError = "no acceleration source: start FastGithub (DNS hijack) or set proxyUrl";
  } else if (state.source === "fastgithub" && !state.fastgithub.dnsHijack) {
    // mode forced "fastgithub" but hijack is down — inform the user.
    state.lastError = "FastGithub DNS hijack inactive (start FastGithub service/UI)";
  }

  // The URL DSH traffic is routed through. With FastGithub it is our loopback
  // forward proxy (which resolves via the hijack); with a custom proxy it is the
  // configured upstream directly.
  const proxyUrl = state.source === "custom-proxy"
    ? state.proxyUrl
    : `http://127.0.0.1:${PORT}`;
  let policyDisposer = null;
  const module = await loadHttpProxy();
  if (!module) {
    state.module = "unavailable";
    state.lastError = "@deepseek-ai/dsh-http-proxy could not be loaded; web_fetch will stay pinned";
  } else if (state.listening || state.source === "custom-proxy") {
    try {
      const inherited = ["http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"]
        .some((n) => process.env[n]);
      state.launchProxyInherited = inherited;
      policyDisposer = await module.installProxyFromEnvironment(makeEnvLookup(proxyUrl), (message) => {
        state.lastError = message;
      });
      state.policy = "proxied";
      state.module = "ok";
    } catch (error) {
      state.module = "install-failed";
      state.lastError = `installProxyFromEnvironment: ${error && error.message ? error.message : error}`;
    }
  }

  ctx.effect(() => () => {
    if (typeof policyDisposer === "function") { try { policyDisposer(); } catch { /* best effort */ } }
    if (state.close) { try { state.close(); } catch { /* best effort */ } }
    if (state.probeTimer) { clearInterval(state.probeTimer); state.probeTimer = null; }
  }, "fastgithub-accelerate:teardown");

  const probe = async () => {
    try {
      state.fastgithub = await probeFastGithub();
      const next = resolveSource(settings, state.fastgithub);
      state.source = next.source;
      state.proxyUrl = next.proxyUrl;
      if (state.source !== "none") state.lastError = null;
    } catch { /* keep previous */ }
  };
  probe();
  state.probeTimer = setInterval(probe, settings.probeIntervalMs);
}

// Config so users can pin a custom proxy / mode per machine. Cordis expects the
// exported Config to be a Standard Schema object exposing `["~standard"].validate`
// (it never imports a separate schema library, so we implement the interface
// directly with no dependency). validate(value) must return { value } on success
// or { issues: [...] } on failure.
const MODES = ["auto", "fastgithub", "custom-proxy"];

const Config = {
  ["~standard"]: {
    version: 1,
    vendor: "schemastery",
    validate(value) {
      const issues = [];
      const input = value && typeof value === "object" ? value : {};
      let mode = DEFAULTS.mode;
      if (input.mode !== undefined) {
        if (typeof input.mode !== "string" || !MODES.includes(input.mode)) {
          issues.push({ path: ["mode"], message: `mode must be one of: ${MODES.join(", ")}` });
        } else {
          mode = input.mode;
        }
      }
      let proxyUrl = DEFAULTS.proxyUrl;
      if (input.proxyUrl !== undefined) {
        if (typeof input.proxyUrl !== "string") {
          issues.push({ path: ["proxyUrl"], message: "proxyUrl must be a string like http://host:port" });
        } else {
          proxyUrl = input.proxyUrl.trim();
        }
      }
      if (issues.length) return { issues };
      return { value: { ...DEFAULTS, mode, proxyUrl } };
    },
  },
};

export { apply, inject, name, Config };