#!/usr/bin/env node
/**
 * Playwright MCP OAuth Proxy
 * Thin proxy that adds OAuth to the official Playwright MCP image.
 * Handles: OAuth discovery/authorize/token
 * Proxies: all /mcp/* requests to the Playwright container
 */
const express = require("express");
const crypto = require("crypto");
const http = require("http");

const app = express();
const PORT = process.env.MCP_PORT || 3000;
const PLAYWRIGHT_URL = process.env.PLAYWRIGHT_URL || "http://ecg-dev-playwright:8931";
const parsed = new URL(PLAYWRIGHT_URL);

const OAUTH = {
  clientId: "playwright-mcp-client",
  clientSecret: "a31361ed76a2ef363135e4d71161421975450e8fb85c5dddf69751d0c88445d8",
  tokens: new Map(),
  authCodes: new Map(),
};

function token() { return crypto.randomBytes(32).toString("hex"); }

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, Cache-Control, Mcp-Session-Id");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header("Access-Control-Expose-Headers", "Mcp-Session-Id");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// === OAuth ===

app.get("/.well-known/oauth-authorization-server", (req, res) => {
  const base = "https://playwright-mcp.data-coeur.com";
  res.json({
    issuer: base,
    authorization_endpoint: base + "/oauth/authorize",
    token_endpoint: base + "/oauth/token",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
  });
});

app.get("/oauth/authorize", (req, res) => {
  const { client_id, redirect_uri, state } = req.query;
  if (client_id !== OAUTH.clientId) return res.status(403).json({ error: "invalid_client" });
  const code = token();
  OAUTH.authCodes.set(code, Date.now());
  const url = new URL(redirect_uri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  res.redirect(url.toString());
});

app.post("/oauth/token", (req, res) => {
  let { grant_type, code, client_id, client_secret } = req.body;
  const ah = req.headers.authorization;
  if (ah && ah.startsWith("Basic ")) {
    try { const [i, s] = Buffer.from(ah.slice(6), "base64").toString().split(":"); client_id = client_id || i; client_secret = client_secret || s; } catch(e) {}
  }
  if (client_secret !== OAUTH.clientSecret) return res.status(401).json({ error: "invalid_client" });
  if (grant_type === "authorization_code") {
    if (!OAUTH.authCodes.has(code)) return res.status(400).json({ error: "invalid_grant" });
    OAUTH.authCodes.delete(code);
  }
  const at = token(), rt = token();
  OAUTH.tokens.set(at, { type: "access", ts: Date.now(), exp: 30 * 86400 });
  OAUTH.tokens.set(rt, { type: "refresh", ts: Date.now() });
  res.json({ access_token: at, token_type: "Bearer", expires_in: 30 * 86400, refresh_token: rt });
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

// === Auth middleware for /mcp/* ===

function auth(req, res, next) {
  const ah = req.headers.authorization;
  if (!ah) return res.status(401).json({ error: "unauthorized" });
  const [, t] = ah.split(" ");
  const td = OAUTH.tokens.get(t);
  if (td && td.type === "access" && (Date.now() - td.ts) / 1000 < td.exp) return next();
  res.status(401).json({ error: "invalid_token" });
}

// === Proxy /mcp/* to Playwright ===

app.all(["/mcp", "/mcp/*"], auth, (req, res) => {
  const headers = {
    "content-type": req.headers["content-type"] || "application/json",
    "accept": req.headers["accept"] || "application/json, text/event-stream",
  };
  if (req.headers["mcp-session-id"]) headers["mcp-session-id"] = req.headers["mcp-session-id"];

  const proxyReq = http.request({
    hostname: parsed.hostname,
    port: parsed.port,
    path: req.url,
    method: req.method,
    headers: headers,
  }, (proxyRes) => {
    // Forward all headers
    for (const [k, v] of Object.entries(proxyRes.headers)) {
      res.setHeader(k, v);
    }
    res.status(proxyRes.statusCode);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (e) => {
    console.error("[Proxy] Error:", e.message);
    if (!res.headersSent) res.status(502).json({ error: "Playwright unavailable" });
  });

  if (req.method === "POST" || req.method === "PUT") {
    const body = JSON.stringify(req.body);
    proxyReq.setHeader("content-length", Buffer.byteLength(body));
    proxyReq.write(body);
  }
  proxyReq.end();
});

// Also proxy /sse for legacy SSE transport
app.all(["/sse", "/sse/*"], auth, (req, res) => {
  const proxyReq = http.request({
    hostname: parsed.hostname,
    port: parsed.port,
    path: req.url,
    method: req.method,
    headers: { "accept": "text/event-stream" },
  }, (proxyRes) => {
    for (const [k, v] of Object.entries(proxyRes.headers)) res.setHeader(k, v);
    res.status(proxyRes.statusCode);
    proxyRes.pipe(res);
  });
  proxyReq.on("error", (e) => {
    if (!res.headersSent) res.status(502).json({ error: "Playwright unavailable" });
  });
  proxyReq.end();
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("[OAuth Proxy] port " + PORT + " -> " + PLAYWRIGHT_URL);
});
