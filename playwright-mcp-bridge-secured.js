#!/usr/bin/env node
/**
 * Playwright MCP Bridge v3 — stdio-to-HTTP proxy (SECURED)
 * Supports both SSE transport and Streamable HTTP transport
 * All /mcp/ endpoints require OAuth token
 */
const { spawn } = require("child_process");
const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.MCP_PORT || 3000;

const OAUTH_CONFIG = {
  clientId: "playwright-mcp-client",
  clientSecret: process.env.OAUTH_CLIENT_SECRET || "a31361ed76a2ef363135e4d71161421975450e8fb85c5dddf69751d0c88445d8",
  tokens: new Map(),
  authCodes: new Map(),
};

const sessions = new Map();

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Authorization, Content-Type, Cache-Control, Mcp-Session-Id");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header("Access-Control-Expose-Headers", "Mcp-Session-Id");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

function generateToken() { return crypto.randomBytes(32).toString("hex"); }
function generateSessionId() { return crypto.randomBytes(16).toString("hex"); }

// AUTH MIDDLEWARE
function authenticate(req, res, next) {
  if (req.path === "/health" || req.path.startsWith("/.well-known/") || req.path.startsWith("/oauth/")) return next();
  const authHeader = req.headers.authorization;
  if (!authHeader) { console.log("[Auth] No auth for", req.method, req.path); return res.status(401).json({ error: "unauthorized" }); }
  const [type, token] = authHeader.split(" ");
  if (type !== "Bearer") return res.status(401).json({ error: "invalid_auth_type" });
  const tokenData = OAUTH_CONFIG.tokens.get(token);
  if (tokenData && tokenData.type === "access") {
    if ((Date.now() - tokenData.createdAt) / 1000 < tokenData.expiresIn) return next();
    OAUTH_CONFIG.tokens.delete(token);
  }
  res.status(401).json({ error: "invalid_token" });
}
app.use(authenticate);

// OAUTH 2.0
app.get("/.well-known/oauth-authorization-server", (req, res) => {
  console.log("[Discovery] Hit from", req.ip);
  const baseUrl = "https://playwright-mcp.data-coeur.com";
  res.json({
    issuer: baseUrl,
    authorization_endpoint: baseUrl + "/oauth/authorize",
    token_endpoint: baseUrl + "/oauth/token",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
  });
});

app.get("/oauth/authorize", (req, res) => {
  console.log("[OAuth] Authorize:", req.query.client_id);
  const { client_id, redirect_uri, state } = req.query;
  if (client_id !== OAUTH_CONFIG.clientId) return res.status(403).json({ error: "invalid_client" });
  const authCode = generateToken();
  OAUTH_CONFIG.authCodes.set(authCode, { createdAt: Date.now() });
  const url = new URL(redirect_uri);
  url.searchParams.set("code", authCode);
  if (state) url.searchParams.set("state", state);
  res.redirect(url.toString());
});

app.post("/oauth/token", (req, res) => {
  let { grant_type, code, client_id, client_secret } = req.body;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
      const parts = decoded.split(":");
      if (!client_id) client_id = parts[0];
      if (!client_secret) client_secret = parts[1];
    } catch (e) {}
  }
  if (!client_secret || client_secret !== OAUTH_CONFIG.clientSecret) {
    console.log("[OAuth] Invalid secret");
    return res.status(401).json({ error: "invalid_client" });
  }
  if (grant_type === "authorization_code") {
    if (!OAUTH_CONFIG.authCodes.has(code)) return res.status(400).json({ error: "invalid_grant" });
    OAUTH_CONFIG.authCodes.delete(code);
  }
  const accessToken = generateToken();
  const newRefresh = generateToken();
  OAUTH_CONFIG.tokens.set(accessToken, { type: "access", createdAt: Date.now(), expiresIn: 3600 * 24 * 30 });
  OAUTH_CONFIG.tokens.set(newRefresh, { type: "refresh", createdAt: Date.now() });
  console.log("[OAuth] Token issued");
  res.json({ access_token: accessToken, token_type: "Bearer", expires_in: 3600 * 24 * 30, refresh_token: newRefresh });
});

app.get("/health", (req, res) => res.json({ status: "ok", service: "playwright-mcp-bridge-v3" }));

// PLAYWRIGHT PROCESS MANAGEMENT
function spawnPlaywright(sessionId) {
  const child = spawn("playwright-mcp", ["--headless", "--no-sandbox", "--executable-path", "/usr/bin/chromium"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: Object.assign({}, process.env, {
      PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium"
    }),
  });

  let lineBuf = "";

  child.stdout.on("data", function(chunk) {
    lineBuf += chunk.toString();
    var lines = lineBuf.split("\n");
    lineBuf = lines.pop();
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      try {
        var msg = JSON.parse(line);
        var sess = sessions.get(sessionId);
        if (!sess) continue;
        if (msg.id !== undefined && sess.pendingRequests.has(msg.id)) {
          sess.pendingRequests.get(msg.id).resolve(msg);
          sess.pendingRequests.delete(msg.id);
        }
        if (sess.sseRes) {
          sess.sseRes.write("event: message\ndata: " + JSON.stringify(msg) + "\n\n");
        }
      } catch (e) { /* skip non-JSON lines */ }
    }
  });

  child.stderr.on("data", function(d) { console.error("[Playwright]", d.toString().trim()); });
  child.on("exit", function(code) {
    console.log("[Bridge] Playwright exited:", code, "session", sessionId);
    const sess = sessions.get(sessionId);
    if (sess) {
      for (const entry of sess.pendingRequests.values()) { entry.reject(new Error("Process exited")); }
      sessions.delete(sessionId);
    }
  });

  return child;
}

function sendAndWait(sessionId, message, timeoutMs) {
  return new Promise(function(resolve, reject) {
    const sess = sessions.get(sessionId);
    if (!sess || !sess.child) return reject(new Error("No session"));
    const id = message.id;
    if (id !== undefined) {
      sess.pendingRequests.set(id, { resolve: resolve, reject: reject });
    }
    var bodyStr = JSON.stringify(message) + "\n";
    sess.child.stdin.write(bodyStr);
    if (id === undefined) return resolve(null);
    setTimeout(function() {
      if (sess.pendingRequests.has(id)) {
        sess.pendingRequests.delete(id);
        reject(new Error("Timeout"));
      }
    }, timeoutMs || 30000);
  });
}

// MCP ENDPOINTS

// POST /mcp/rpc — Streamable HTTP
app.post("/mcp/rpc", async function(req, res) {
  const message = req.body;
  let sessionId = req.headers["mcp-session-id"] || req.query.sessionId;

  console.log("[MCP POST]", JSON.stringify({ sid: sessionId || "none", method: message.method, id: message.id }));

  // New session via initialize
  if (!sessionId && message.method === "initialize") {
    sessionId = generateSessionId();
    sessions.set(sessionId, { child: null, sseRes: null, pendingRequests: new Map(), createdAt: Date.now() });
    sessions.get(sessionId).child = spawnPlaywright(sessionId);
    await new Promise(function(r) { setTimeout(r, 500); });
    try {
      const response = await sendAndWait(sessionId, message, 15000);
      res.setHeader("Mcp-Session-Id", sessionId);
      console.log("[MCP] Session created:", sessionId);
      return res.json(response);
    } catch (e) {
      console.error("[MCP] Init failed:", e.message);
      sessions.delete(sessionId);
      return res.status(500).json({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: e.message } });
    }
  }

  if (!sessionId || !sessions.has(sessionId)) {
    return res.status(400).json({ error: "Invalid session" });
  }

  // Notification
  if (message.id === undefined) {
    try {
      const sess = sessions.get(sessionId);
      var bodyStr = JSON.stringify(message) + "\n";
      sess.child.stdin.write(bodyStr);
      return res.status(202).end();
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // Request
  try {
    const response = await sendAndWait(sessionId, message, 60000);
    res.setHeader("Mcp-Session-Id", sessionId);
    return res.json(response);
  } catch (e) {
    console.error("[MCP] Failed:", e.message);
    return res.status(500).json({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: e.message } });
  }
});

// GET /mcp/rpc — SSE transport
app.get("/mcp/rpc", function(req, res) {
  const sessionId = req.query.sessionId || req.headers["mcp-session-id"];
  console.log("[MCP SSE]", sessionId || "new");
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  if (sessionId && sessions.has(sessionId)) {
    sessions.get(sessionId).sseRes = res;
  } else {
    const newId = generateSessionId();
    sessions.set(newId, { child: null, sseRes: res, pendingRequests: new Map(), createdAt: Date.now() });
    sessions.get(newId).child = spawnPlaywright(newId);
    res.write("event: endpoint\ndata: " + JSON.stringify({ type: "endpoint", url: "/mcp/rpc?sessionId=" + newId }) + "\n\n");
  }

  const hb = setInterval(function() { res.write(": heartbeat\n\n"); }, 30000);
  req.on("close", function() {
    clearInterval(hb);
    if (sessionId && sessions.has(sessionId)) sessions.get(sessionId).sseRes = null;
    console.log("[MCP SSE] Closed");
  });
});

// DELETE /mcp/rpc — Close session
app.delete("/mcp/rpc", function(req, res) {
  const sessionId = req.headers["mcp-session-id"];
  if (sessionId && sessions.has(sessionId)) {
    const sess = sessions.get(sessionId);
    if (sess.child) sess.child.kill();
    sessions.delete(sessionId);
  }
  res.status(200).end();
});

// Cleanup stale sessions
setInterval(function() {
  const now = Date.now();
  for (const [id, sess] of sessions) {
    if (now - sess.createdAt > 30 * 60 * 1000) {
      if (sess.child) sess.child.kill();
      sessions.delete(id);
      console.log("[Cleanup] Stale:", id);
    }
  }
}, 5 * 60 * 1000);

app.listen(PORT, "0.0.0.0", function() {
  console.log("[Playwright MCP Bridge v3] port " + PORT);
  console.log("  POST /mcp/rpc — Streamable HTTP");
  console.log("  GET  /mcp/rpc — SSE fallback");
  console.log("  Auth: OAuth on /mcp/*");
});
