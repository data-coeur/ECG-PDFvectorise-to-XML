#!/usr/bin/env node

/**
 * ECG Pipeline MCP Server v3.0
 * Security hardened: no shell concatenation, all args as arrays via execFileSync
 */

const express = require('express');
const { execFileSync } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.MCP_PORT || 8385;
const WORKSPACE = '/home/utsb/DEV/ecg-dev';
const COMPOSE_FILE = path.join(WORKSPACE, 'docker-compose.yml');

// ============================================
// CONFIGURATION
// ============================================
const OAUTH_CONFIG = {
  clientId: process.env.OAUTH_CLIENT_ID || 'ecg-pipeline-mcp-client',
  clientSecret: process.env.OAUTH_CLIENT_SECRET || '2ad87b215402b762baca4188ac46cedbcbc0a6555400f1d61798e63d3d5aa44f',
  tokens: new Map(),
  authCodes: new Map(),
};

// ============================================
// HELPERS
// ============================================

function safeExec(command, args, opts = {}) {
  try {
    const output = execFileSync(command, args, {
      cwd: opts.cwd || WORKSPACE,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      stdio: 'pipe',
      timeout: opts.timeout || 120000,
    });
    return { success: true, output };
  } catch (error) {
    return { success: false, error: error.stderr?.toString() || error.message, stdout: error.stdout?.toString() || '' };
  }
}

function sanitizePath(filePath) {
  // Resolve relative to workspace, then verify it stays inside
  const resolved = path.resolve(WORKSPACE, filePath);
  // Must start with WORKSPACE + separator (or be WORKSPACE itself)
  if (resolved !== WORKSPACE && !resolved.startsWith(WORKSPACE + path.sep)) {
    throw new Error('Path outside workspace: ' + filePath);
  }
  return resolved;
}

function generateToken() { return crypto.randomBytes(32).toString('hex'); }
function generateSessionId() { return crypto.randomBytes(16).toString('hex'); }

// Whitelist of valid docker-compose service names
const VALID_SERVICES = ['web', 'database', 'phpmyadmin', 'deepecg-backend', 'deepecg-frontend', 'ai-engine'];
function validateServices(services) {
  if (!Array.isArray(services)) return [];
  return services.filter(s => VALID_SERVICES.includes(s));
}

// ============================================
// MIDDLEWARE
// ============================================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Cache-Control, Mcp-Session-Id');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Expose-Headers', 'Mcp-Session-Id');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ============================================
// OAUTH 2.0
// ============================================
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  const baseUrl = 'https://ecg-dev.data-coeur.com';
  res.json({
    issuer: baseUrl,
    authorization_endpoint: baseUrl + '/oauth/authorize',
    token_endpoint: baseUrl + '/oauth/token',
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
  });
});

app.get('/oauth/authorize', (req, res) => {
  const { client_id, redirect_uri, state } = req.query;
  if (client_id !== OAUTH_CONFIG.clientId) return res.status(400).send('Invalid client_id');
  const authCode = generateToken();
  OAUTH_CONFIG.authCodes.set(authCode, { clientId: client_id, redirectUri: redirect_uri, createdAt: Date.now() });
  const url = new URL(redirect_uri);
  url.searchParams.set('code', authCode);
  if (state) url.searchParams.set('state', state);
  res.redirect(url.toString());
});

app.post('/oauth/token', (req, res) => {
  let { grant_type, code, client_id, client_secret, refresh_token } = req.body;
  // Support Basic auth
  const ah = req.headers.authorization;
  if (ah && ah.startsWith('Basic ')) {
    try { const [i, s] = Buffer.from(ah.slice(6), 'base64').toString().split(':'); client_id = client_id || i; client_secret = client_secret || s; } catch(e) {}
  }
  if (client_secret !== OAUTH_CONFIG.clientSecret) return res.status(401).json({ error: 'invalid_client' });

  if (grant_type === 'authorization_code') {
    if (!OAUTH_CONFIG.authCodes.has(code)) return res.status(400).json({ error: 'invalid_grant' });
    OAUTH_CONFIG.authCodes.delete(code);
  } else if (grant_type === 'refresh_token') {
    const td = OAUTH_CONFIG.tokens.get(refresh_token);
    if (!td || td.type !== 'refresh') return res.status(400).json({ error: 'invalid_grant' });
  } else {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  const at = generateToken(), rt = generateToken();
  OAUTH_CONFIG.tokens.set(at, { type: 'access', createdAt: Date.now(), expiresIn: 30 * 86400 });
  OAUTH_CONFIG.tokens.set(rt, { type: 'refresh', createdAt: Date.now() });
  res.json({ access_token: at, token_type: 'Bearer', expires_in: 30 * 86400, refresh_token: rt });
});

// ============================================
// AUTH MIDDLEWARE
// ============================================
function authenticate(req, res, next) {
  if (req.path === '/health' || req.path.startsWith('/.well-known/') || req.path.startsWith('/oauth/')) return next();
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No authorization header' });
  const [type, token] = authHeader.split(' ');
  if (type !== 'Bearer') return res.status(401).json({ error: 'Invalid auth type' });
  const td = OAUTH_CONFIG.tokens.get(token);
  if (td && td.type === 'access' && (Date.now() - td.createdAt) / 1000 < td.expiresIn) return next();
  res.status(401).json({ error: 'Invalid or expired token' });
}

app.use(authenticate);

// ============================================
// MCP PROTOCOL
// ============================================
const sseClients = new Map();

app.get('/mcp/rpc', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const sessionId = generateSessionId();
  sseClients.set(sessionId, { res, createdAt: Date.now() });
  res.write(`event: endpoint\ndata: ${JSON.stringify({ type: 'endpoint', url: '/mcp/mcp/rpc?sessionId=' + sessionId })}\n\n`);
  const hb = setInterval(() => res.write(': heartbeat\n\n'), 30000);
  req.on('close', () => { clearInterval(hb); sseClients.delete(sessionId); });
});

app.post('/mcp/rpc', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body;
  if (jsonrpc !== '2.0') return res.json({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } });

  try {
    let result;
    switch (method) {
      case 'initialize':
        result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'ecg-pipeline-mcp', version: '3.0.0' } };
        break;
      case 'notifications/initialized':
        result = {};
        break;
      case 'tools/list':
        result = { tools: getToolsList() };
        break;
      case 'tools/call':
        result = await handleToolCall(params.name, params.arguments || {});
        break;
      default:
        return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
    }
    res.json({ jsonrpc: '2.0', id, result });
  } catch (error) {
    res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: error.message } });
  }
});

// ============================================
// TOOLS LIST
// ============================================
function getToolsList() {
  return [
    { name: 'docker_ps', description: 'List running Docker containers for ERCF project', inputSchema: { type: 'object', properties: {} } },
    { name: 'docker_logs', description: 'Get Docker container logs', inputSchema: { type: 'object', properties: {
      services: { type: 'array', items: { type: 'string' }, description: 'Service names (mediawiki, database, cron, phpmyadmin, smtp)' },
      tail: { type: 'number', default: 100, description: 'Number of log lines' },
    } } },
    { name: 'docker_restart', description: 'Restart Docker containers', inputSchema: { type: 'object', required: ['services'], properties: {
      services: { type: 'array', items: { type: 'string' }, description: 'Service names to restart' },
    } } },
    { name: 'docker_up', description: 'Start Docker containers', inputSchema: { type: 'object', properties: {
      services: { type: 'array', items: { type: 'string' } },
      build: { type: 'boolean', default: false },
    } } },
    { name: 'docker_down', description: 'Stop Docker containers', inputSchema: { type: 'object', properties: {
      volumes: { type: 'boolean', default: false },
    } } },
    { name: 'docker_build', description: 'Build Docker images', inputSchema: { type: 'object', properties: {
      services: { type: 'array', items: { type: 'string' }, description: 'Service names to build' },
      noCache: { type: 'boolean', default: false, description: 'Build without using cache' },
    } } },
    { name: 'docker_prune', description: 'Clean up Docker images, containers, and volumes', inputSchema: { type: 'object', properties: {
      images: { type: 'boolean', default: true, description: 'Prune unused images' },
      volumes: { type: 'boolean', default: false, description: 'Prune unused volumes' },
      all: { type: 'boolean', default: false, description: 'Remove all unused images, not just dangling' },
    } } },
    { name: 'mysql_query', description: 'Execute a MySQL query on the ecg-dev database. For SELECT, SHOW, DESCRIBE queries.', inputSchema: { type: 'object', required: ['query'], properties: {
      query: { type: 'string', description: 'SQL query to execute' },
    } } },
    { name: 'shell_exec', description: 'Execute shell command (docker, docker-compose, cat, ls, head, tail, mysql only)', inputSchema: { type: 'object', required: ['command'], properties: {
      command: { type: 'string', description: 'Command to execute' },
      cwd: { type: 'string', default: '.', description: 'Working directory' },
    } } },
    { name: 'file_read', description: 'Read a file from the ERCF project', inputSchema: { type: 'object', required: ['path'], properties: {
      path: { type: 'string', description: 'File path relative to project root' },
    } } },
    { name: 'file_write', description: 'Write content to a file', inputSchema: { type: 'object', required: ['path', 'content'], properties: {
      path: { type: 'string', description: 'File path relative to project root' },
      content: { type: 'string', description: 'File content' },
    } } },
    { name: 'file_list', description: 'List files in a directory', inputSchema: { type: 'object', properties: {
      path: { type: 'string', default: '.', description: 'Directory path' },
      recursive: { type: 'boolean', default: false },
    } } },
    { name: 'file_search', description: 'Search for pattern in files (grep)', inputSchema: { type: 'object', required: ['pattern'], properties: {
      pattern: { type: 'string', description: 'Search pattern' },
      path: { type: 'string', default: '.', description: 'Search path' },
      filePattern: { type: 'string', default: '*', description: 'File glob pattern' },
    } } },
    { name: 'file_patch', description: 'Modify specific lines in a file. Can replace, delete, or view lines by line number.', inputSchema: { type: 'object', required: ['path'], properties: {
      path: { type: 'string', description: 'File path' },
      startLine: { type: 'number', description: 'Start line number (1-indexed)' },
      endLine: { type: 'number', description: 'End line number (inclusive). If omitted, only startLine is affected' },
      content: { type: 'string', description: 'New content to replace the lines. If omitted, lines are deleted' },
      viewOnly: { type: 'boolean', default: false, description: 'If true, just show the lines without modifying' },
    } } },
    { name: 'file_replace', description: 'Find and replace text in a file. The search string must be unique in the file.', inputSchema: { type: 'object', required: ['path', 'search', 'replace'], properties: {
      path: { type: 'string', description: 'File path' },
      search: { type: 'string', description: 'Text to find (must be unique in the file)' },
      replace: { type: 'string', description: 'Text to replace with' },
    } } },
    { name: 'file_insert', description: 'Insert content at a specific line number', inputSchema: { type: 'object', required: ['path', 'line', 'content'], properties: {
      path: { type: 'string', description: 'File path' },
      line: { type: 'number', description: 'Line number to insert at (1-indexed). Content will be inserted BEFORE this line' },
      content: { type: 'string', description: 'Content to insert' },
    } } },
    { name: 'git_status', description: 'Get git status', inputSchema: { type: 'object', properties: {} } },
    { name: 'git_diff', description: 'Get git diff', inputSchema: { type: 'object', properties: {
      staged: { type: 'boolean', default: false },
    } } },
    { name: 'git_commit', description: 'Add all changes and commit', inputSchema: { type: 'object', required: ['message'], properties: {
      message: { type: 'string', description: 'Commit message' },
    } } },
    { name: 'git_push', description: 'Push to remote', inputSchema: { type: 'object', properties: {
      branch: { type: 'string', default: 'main' },
    } } },
    { name: 'vscode_tunnel_code', description: 'Get the VS Code tunnel authentication code for GitHub device login.', inputSchema: { type: 'object', properties: {} } },
    { name: 'batch', description: 'Execute multiple operations at once', inputSchema: { type: 'object', required: ['operations'], properties: {
      operations: { type: 'array', description: 'Array of operations', items: { type: 'object', properties: {
        type: { type: 'string', enum: ['file_write', 'file_delete', 'shell_exec', 'docker_restart'] },
        path: { type: 'string' }, content: { type: 'string' }, command: { type: 'string' },
        services: { type: 'array', items: { type: 'string' } },
      } } },
    } } },
  ];
}

// ============================================
// TOOL HANDLERS — all use execFileSync (no shell)
// ============================================
async function handleToolCall(name, args) {
  console.log('[Tool]', name, JSON.stringify(args).substring(0, 200));
  try {
    switch (name) {

      // ── Docker (all use execFileSync with arrays) ──

      case 'docker_ps':
        return text(safeExec('docker-compose', ['-f', COMPOSE_FILE, 'ps']).output || 'No containers');

      case 'docker_logs': {
        const tail = String(Math.min(Math.max(parseInt(args.tail) || 100, 1), 1000));
        const svcs = validateServices(args.services || []);
        return text(safeExec('docker-compose', ['-f', COMPOSE_FILE, 'logs', '--tail=' + tail, '--no-color', ...svcs]).output || 'No logs');
      }

      case 'docker_restart': {
        const svcs = validateServices(args.services || []);
        if (!svcs.length) return err('No valid services specified');
        const r = safeExec('docker-compose', ['-f', COMPOSE_FILE, 'restart', ...svcs]);
        return text(r.success ? 'Restarted: ' + svcs.join(', ') : r.error);
      }

      case 'docker_up': {
        const a = ['-f', COMPOSE_FILE, 'up', '-d'];
        if (args.build) a.push('--build');
        a.push(...validateServices(args.services || []));
        const r = safeExec('docker-compose', a);
        return text(r.success ? 'Containers started' : r.error);
      }

      case 'docker_down': {
        const a = ['-f', COMPOSE_FILE, 'down'];
        if (args.volumes) a.push('-v');
        const r = safeExec('docker-compose', a);
        return text(r.success ? 'Containers stopped' : r.error);
      }

      case 'docker_build': {
        const a = ['-f', COMPOSE_FILE, 'build'];
        if (args.noCache) a.push('--no-cache');
        a.push(...validateServices(args.services || []));
        const r = safeExec('docker-compose', a);
        return text(r.success ? 'Build completed:\n' + r.output : r.error);
      }

      case 'docker_prune': {
        const results = [];
        if (args.images !== false) {
          const a = ['image', 'prune', '-f'];
          if (args.all) a.push('-a');
          const r = safeExec('docker', a);
          results.push('Images: ' + (r.output || r.error));
        }
        if (args.volumes) {
          const r = safeExec('docker', ['volume', 'prune', '-f']);
          results.push('Volumes: ' + (r.output || r.error));
        }
        return text(results.join('\n') || 'Prune completed');
      }

      // ── MySQL (direct query via docker exec) ──

      case 'mysql_query': {
        const query = args.query;
        if (!query || typeof query !== 'string') return err('Query required');
        // Read credentials from .env
        const envContent = await fs.readFile(path.join(WORKSPACE, '.env'), 'utf-8');
        const envVars = {};
        envContent.split('\n').forEach(line => {
          const m = line.match(/^([A-Z_]+)=(.*)$/);
          if (m) envVars[m[1]] = m[2];
        });
        const r = safeExec('docker', ['exec', '-i', 'ecg-dev-database', 'mysql',
          '-u', envVars.MYSQL_USER || 'ecguser',
          '-p' + (envVars.MYSQL_PASSWORD || ''),
          envVars.MYSQL_DATABASE || 'ecgpipeline',
          '-e', query
        ], { timeout: 30000 });
        return text(r.output || r.error || r.stdout || 'No output');
      }

      // ── Shell exec (whitelist commands, no shell) ──

      case 'shell_exec': {
        const cmdStr = (args.command || '').trim();
        if (!cmdStr) return err('No command');
        const parts = cmdStr.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
        const bin = parts[0];
        const ALLOWED_BINS = ['docker', 'docker-compose', 'cat', 'ls', 'pwd', 'head', 'tail', 'wc', 'echo', 'find', 'rm', 'chmod', 'mkdir', 'cp', 'mv', 'grep', 'touch', 'mysql'];
        if (!ALLOWED_BINS.includes(bin)) return err('Command not allowed: ' + bin + '. Allowed: ' + ALLOWED_BINS.join(', '));
        // For file commands, validate paths are in workspace
        if (['cat', 'ls', 'head', 'tail', 'rm', 'chmod', 'cp', 'mv', 'touch', 'mkdir'].includes(bin)) {
          for (let i = 1; i < parts.length; i++) {
            const arg = parts[i].replace(/^["']|["']$/g, '');
            if (arg.startsWith('-')) continue; // flags
            try { sanitizePath(arg); } catch(e) { return err('Path not allowed: ' + arg); }
          }
        }
        const cwd = args.cwd ? sanitizePath(args.cwd) : WORKSPACE;
        const r = safeExec(bin, parts.slice(1).map(p => p.replace(/^["']|["']$/g, '')), { cwd });
        return text(r.output || r.error || r.stdout || 'No output');
      }

      // ── File operations (all use sanitizePath) ──

      case 'file_read': {
        const content = await fs.readFile(sanitizePath(args.path), 'utf-8');
        return text(content);
      }

      case 'file_write': {
        const fullPath = sanitizePath(args.path);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, args.content, 'utf-8');
        return text('Written: ' + args.path);
      }

      case 'file_list': {
        const dirPath = sanitizePath(args.path || '.');
        if (args.recursive) {
          const r = safeExec('find', [dirPath, '-type', 'f',
            '(', '-name', '*.php', '-o', '-name', '*.js', '-o', '-name', '*.css', '-o', '-name', '*.json',
            '-o', '-name', '*.yml', '-o', '-name', '*.yaml', '-o', '-name', '*.xml', '-o', '-name', '*.py',
            '-o', '-name', '*.html', '-o', '-name', '*.md', '-o', '-name', '*.env', '-o', '-name', '*.sh',
            '-o', '-name', 'Dockerfile*', ')',
            '-not', '-path', '*/.git/*', '-not', '-path', '*/node_modules/*', '-not', '-path', '*/vendor/*',
          ]);
          return text(r.output || 'No files found');
        }
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        return text(entries.map(e => (e.isDirectory() ? '📁 ' : '📄 ') + e.name).join('\n'));
      }

      case 'file_search': {
        const searchPath = sanitizePath(args.path || '.');
        // Use execFileSync with grep — pattern is an argument, not shell-interpolated
        const grepArgs = ['-rn', '--include=' + (args.filePattern || '*.php'), args.pattern, searchPath];
        const r = safeExec('grep', grepArgs);
        const output = (r.output || '').split('\n').slice(0, 100).join('\n');
        return text(output || 'No matches found');
      }

      case 'file_patch': {
        const fullPath = sanitizePath(args.path);
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');
        const startLine = args.startLine || 1;
        const endLine = args.endLine || startLine;
        if (startLine < 1 || endLine < startLine || startLine > lines.length) return err('Invalid line range. File has ' + lines.length + ' lines.');
        if (args.viewOnly) {
          return text(lines.slice(startLine - 1, endLine).map((l, i) => (startLine + i) + ': ' + l).join('\n'));
        }
        const newLines = args.content !== undefined ? args.content.split('\n') : [];
        lines.splice(startLine - 1, endLine - startLine + 1, ...newLines);
        await fs.writeFile(fullPath, lines.join('\n'), 'utf-8');
        return text((args.content === undefined ? 'Deleted' : 'Replaced') + ' lines ' + startLine + '-' + endLine + ' in ' + args.path);
      }

      case 'file_replace': {
        const fullPath = sanitizePath(args.path);
        const content = await fs.readFile(fullPath, 'utf-8');
        const count = content.split(args.search).length - 1;
        if (count === 0) return err('Search string not found in ' + args.path);
        if (count > 1) return err('Search string found ' + count + ' times. Must be unique.');
        await fs.writeFile(fullPath, content.replace(args.search, args.replace), 'utf-8');
        return text('Replaced in ' + args.path);
      }

      case 'file_insert': {
        const fullPath = sanitizePath(args.path);
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');
        if (args.line < 1 || args.line > lines.length + 1) return err('Invalid line number. File has ' + lines.length + ' lines.');
        lines.splice(args.line - 1, 0, ...args.content.split('\n'));
        await fs.writeFile(fullPath, lines.join('\n'), 'utf-8');
        return text('Inserted at line ' + args.line + ' in ' + args.path);
      }

      // ── Git (execFileSync, no shell) ──

      case 'git_status':
        return text(safeExec('git', ['status']).output || 'Clean');

      case 'git_diff':
        return text(safeExec('git', args.staged ? ['diff', '--staged'] : ['diff']).output || 'No changes');

      case 'git_commit': {
        safeExec('git', ['add', '-A']);
        const r = safeExec('git', ['commit', '-m', args.message]); // message as argument, not shell-interpolated
        return text(r.output || r.error);
      }

      case 'git_push': {
        const branch = /^[a-zA-Z0-9._/-]+$/.test(args.branch || 'main') ? (args.branch || 'main') : 'main';
        const r = safeExec('git', ['push', 'origin', branch]);
        return text(r.success ? 'Pushed to ' + branch : r.error);
      }

      // ── VS Code tunnel ──

      case 'vscode_tunnel_code': {
        const r = safeExec('docker', ['logs', 'vscode-tunnel-ecg'], { timeout: 5000 });
        const lines = (r.output || '').split('\n').filter(l => /use code/i.test(l));
        const last = lines[lines.length - 1] || '';
        const match = last.match(/use code ([A-Z0-9-]+)/i);
        if (match) return text('VS Code tunnel auth code: ' + match[1] + '\nGo to https://github.com/login/device and enter this code.');
        return text('No pending auth code found. The tunnel may already be authenticated.');
      }

      // ── Batch ──

      case 'batch': {
        const results = [];
        for (const op of args.operations || []) {
          try {
            if (op.type === 'file_write') {
              const p = sanitizePath(op.path);
              await fs.mkdir(path.dirname(p), { recursive: true });
              await fs.writeFile(p, op.content, 'utf-8');
              results.push('✓ Written: ' + op.path);
            } else if (op.type === 'file_delete') {
              await fs.unlink(sanitizePath(op.path));
              results.push('✓ Deleted: ' + op.path);
            } else if (op.type === 'docker_restart') {
              const svcs = validateServices(op.services || []);
              safeExec('docker-compose', ['-f', COMPOSE_FILE, 'restart', ...svcs]);
              results.push('✓ Restarted: ' + svcs.join(', '));
            } else {
              results.push('✗ Unknown: ' + op.type);
            }
          } catch (e) { results.push('✗ Error: ' + e.message); }
        }
        return text(results.join('\n'));
      }

      default:
        return err('Unknown tool: ' + name);
    }
  } catch (error) {
    console.error('[Tool] Error:', error);
    return err(error.message);
  }
}

function text(t) { return { content: [{ type: 'text', text: t }] }; }
function err(t) { return { content: [{ type: 'text', text: 'Error: ' + t }], isError: true }; }

// ============================================
// HEALTH
// ============================================
app.get('/health', (req, res) => res.json({ status: 'ok', version: '3.0.0' }));

// ============================================
// START
// ============================================
app.listen(PORT, '0.0.0.0', () => {
  console.log('[ECG Pipeline MCP v3.0] port ' + PORT + ' workspace ' + WORKSPACE);
  console.log('  POST /mcp/rpc — JSON-RPC');
  console.log('  GET  /mcp/rpc — SSE');
  console.log('  Auth: OAuth on all routes');
});
