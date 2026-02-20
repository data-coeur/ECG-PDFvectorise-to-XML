#!/usr/bin/env node
/**
 * Playwright MCP Bridge v2 — stdio-to-HTTP/SSE proxy (SECURED)
 * Wraps @playwright/mcp as child process, exposes JSON-RPC over SSE for claude.ai
 * All /mcp/ endpoints require OAuth token
 */
const { spawn } = require("child_process");
const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.MCP_PORT || 3000;

const OAUTH_CONFIG = {
  clientId: "playwright-mcp-client",
  clientSecret: process.env.OAUTH_CLIENT_SECRET || crypto.randomBytes(32).toString("hex"),
  tokens: new Map(),
  authCodes: new Map(),
};

const sseClients = new Map();
const mcpProcesses = new Map();

app.use(express.json({ limit: "10mb" }));
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Authorization, Content-Type, Cache-Control");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

function generateToken() { return crypto.randomBytes(32).toString("hex"); }

// ============================================
// AUTH MIDDLEWARE — /mcp/ requires valid OAuth token
// ============================================
function authenticate(req, res, next) {
  if (req.path === "/health" ||
      req.path.startsWith("/.well-known/") ||
      req.path.startsWith("/oauth/")) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    console.log("[Auth] No authorization header for", req.method, req.path);
    return res.status(401).json({ error: "No authorization header" });
  }

  const [type, token] = authHeader.split(" ");
  if (type !== "Bearer") {
    return res.status(401).json({ error: "Invalid auth type" });
  }

  const tokenData = OAUTH_CONFIG.tokens.get(token);
  if (tokenData && tokenData.type === "access") {
    const age = (Date.now() - tokenData.createdAt) / 1000;
    if (age < tokenData.expiresIn) {
      return next();
    }
    OAUTH_CONFIG.tokens.delete(token);
  }

  console.log("[Auth] Invalid or expired token for", req.method, req.path);
  res.status(401).json({ error: "Invalid or expired token" });
}

app.use(authenticate);

// ============================================
// OAUTH 2.0
// ============================================
app.get("/.well-known/oauth-authorization-server", (req, res) => {
  const baseUrl = "https://playwright-mcp.data-coeur.com";
  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
  });
});

app.get("/oauth/authorize", (req, res) => {
  const { redirect_uri, state } = req.query;
  const authCode = generateToken();
  OAUTH_CONFIG.authCodes.set(authCode, { createdAt: Date.now() });
  const url = new URL(redirect_uri);
  url.searchParams.set("code", authCode);
  if (state) url.searchParams.set("state", state);
  res.redirect(url.toString());
});

app.post("/oauth/token", (req, res) => {
  const { grant_type, code } = req.body;
  if (grant_type === "authorization_code") {
    if (!OAUTH_CONFIG.authCodes.has(code)) return res.status(400).json({ error: "invalid_grant" });
    OAUTH_CONFIG.authCodes.delete(code);
  }
  const accessToken = generateToken();
  const newRefresh = generateToken();
  OAUTH_CONFIG.tokens.set(accessToken, { type: "access", createdAt: Date.now(), expiresIn: 3600 * 24 * 30 });
  OAUTH_CONFIG.tokens.set(newRefresh, { type: "refresh", createdAt: Date.now() });
  res.json({ access_token: accessToken, token_type: "Bearer", expires_in: 3600 * 24 * 30, refresh_token: newRefresh });
});

// Health (no auth)
app.get("/health", (req, res) => res.json({ status: "ok", service: "playwright-mcp-bridge" }));

// ============================================
// PLAYWRIGHT MCP PROCESS MANAGEMENT
// ============================================
function spawnPlaywrightMCP(sessionId) {
  const npxPath = process.env.NPX_PATH || "npx";
  const child = spawn(npxPath, ["@playwright/mcp@latest", "--headless"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium" },
  });

  let stdioBuf = Buffer.alloc(0);
  child.stdout.on("data", (chunk) => {
    stdioBuf = Buffer.concat([stdioBuf, chunk]);
    while (true) {
      const headerEnd = stdioBuf.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const header = stdioBuf.slice(0, headerEnd).toString();
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) { stdioBuf = stdioBuf.slice(headerEnd + 4); continue; }
      const len = parseInt(match[1]);
      const bodyStart = headerEnd + 4;
      if (stdioBuf.length < bodyStart + len) break;
      const body = stdioBuf.slice(bodyStart, bodyStart + len).toString();
      stdioBuf = stdioBuf.slice(bodyStart + len);
      try {
        const msg = JSON.parse(body);
        const client = sseClients.get(sessionId);
        if (client) {
          client.res.write(`event: message\ndata: ${JSON.stringify(msg)}\n\n`);
        }
      } catch (e) { console.error("[Bridge] Parse error:", e.message); }
    }
  });

  child.stderr.on("data", (d) => console.error("[Playwright]", d.toString()));
  child.on("exit", (code) => {
    console.log(`[Bridge] Playwright exited: ${code} session ${sessionId}`);
    mcpProcesses.delete(sessionId);
  });

  mcpProcesses.set(sessionId, child);
  return child;
}

function sendToChild(sessionId, message) {
  const child = mcpProcesses.get(sessionId);
  if (!child) throw new Error("No MCP process for session");
  const body = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
  child.stdin.write(header + body);
}

// ============================================
// MCP ENDPOINTS (auth required via middleware)
// ============================================
app.get("/mcp/rpc", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sessionId = crypto.randomBytes(16).toString("hex");
  sseClients.set(sessionId, { res, createdAt: Date.now() });
  spawnPlaywrightMCP(sessionId);

  const endpointEvent = { type: "endpoint", url: `/mcp/rpc?sessionId=${sessionId}` };
  res.write(`event: endpoint\ndata: ${JSON.stringify(endpointEvent)}\n\n`);

  const heartbeat = setInterval(() => res.write(`: heartbeat\n\n`), 30000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(sessionId);
    const child = mcpProcesses.get(sessionId);
    if (child) { child.kill(); mcpProcesses.delete(sessionId); }
    console.log("[Bridge] Session closed:", sessionId);
  });
});

app.post("/mcp/rpc", (req, res) => {
  const sessionId = req.query.sessionId;
  if (!sessionId || !mcpProcesses.has(sessionId)) {
    return res.status(400).json({ error: "Invalid session" });
  }
  try {
    sendToChild(sessionId, req.body);
    res.json({ status: "sent" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[Playwright MCP Bridge v2] Running on port ${PORT}`);
  console.log(`  Auth: OAuth required on /mcp/*`);
  console.log(`  SSE:  GET  /mcp/rpc`);
  console.log(`  RPC:  POST /mcp/rpc?sessionId=...`);
});
