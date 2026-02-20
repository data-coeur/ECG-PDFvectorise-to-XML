#!/usr/bin/env node

/**
 * ECG Pipeline MCP Server v2.1
 *
 * Supporte :
 * - Claude Desktop MCP (SSE + JSON-RPC)
 * - API REST classique (Bearer Token)
 */

const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.MCP_PORT || 8385;
const WORKSPACE = process.env.WORKSPACE || '/home/utsb/DEV/ecg-dev';

// ============================================
// CONFIGURATION
// ============================================
const OAUTH_CONFIG = {
  clientId: process.env.OAUTH_CLIENT_ID || 'ecg-pipeline-mcp-client',
  clientSecret: process.env.OAUTH_CLIENT_SECRET || '2ad87b215402b762baca4188ac46cedbcbc0a6555400f1d61798e63d3d5aa44f',
  tokens: new Map(),
  authCodes: new Map(),
};

const BEARER_TOKEN = process.env.MCP_AUTH_TOKEN || '13be2d9a2776ba1e1ffee309031a7839c450043d3d8caa73284542e632d70a8f';

// SSE Clients pour MCP
const sseClients = new Map();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Cache-Control');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ============================================
// HELPERS
// ============================================
function execCommand(command, cwd = WORKSPACE) {
  try {
    const output = execSync(command, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      stdio: 'pipe',
      timeout: 120000,
    });
    return { success: true, output };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stderr: error.stderr?.toString() || '',
      stdout: error.stdout?.toString() || '',
    };
  }
}

function sanitizePath(filePath) {
  const resolved = path.resolve(WORKSPACE, filePath);
  if (!resolved.startsWith(WORKSPACE)) {
    throw new Error('Path outside workspace');
  }
  return resolved;
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

// No Gemini support for ECG Pipeline

// Container scoping - only allow docker commands targeting ecg-dev containers
const ALLOWED_CONTAINER_PREFIX = "ecg-dev-";
function validateDockerCommand(cmd) {
  if (cmd.startsWith("docker-compose") || cmd.startsWith("docker compose")) return true;
  if (cmd.startsWith("docker ")) {
    const parts = cmd.split(/\s+/);
    const subCmd = parts[1];
    if (["image","images","network","volume","system","info","version"].includes(subCmd)) return true;
    if (["exec","logs","inspect","stop","start","restart","top","stats"].includes(subCmd)) {
      return parts.some(p => p.startsWith(ALLOWED_CONTAINER_PREFIX));
    }
    if (subCmd === "ps") return true;
    return false;
  }
  return true;
}

// ============================================
// OAUTH 2.0 DISCOVERY
// ============================================
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  const baseUrl = 'https://ecg-dev.data-coeur.com/mcp';
  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
  });
});

// ============================================
// OAUTH 2.0 ENDPOINTS
// ============================================
app.get('/oauth/authorize', (req, res) => {
  const { client_id, redirect_uri, response_type, state, scope } = req.query;
  
  console.log('[OAuth] Authorize request:', { client_id, redirect_uri, state });
  
  if (client_id !== OAUTH_CONFIG.clientId) {
    return res.status(400).send('Invalid client_id');
  }
  
  const authCode = generateToken();
  OAUTH_CONFIG.authCodes.set(authCode, {
    clientId: client_id,
    redirectUri: redirect_uri,
    scope: scope,
    createdAt: Date.now(),
  });
  
  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set('code', authCode);
  if (state) redirectUrl.searchParams.set('state', state);
  
  console.log('[OAuth] Redirecting to:', redirectUrl.toString());
  res.redirect(redirectUrl.toString());
});

app.post('/oauth/token', (req, res) => {
  const { grant_type, code, client_id, client_secret, refresh_token } = req.body;
  
  console.log('[OAuth] Token request:', { grant_type, client_id });
  
  if (client_id !== OAUTH_CONFIG.clientId || client_secret !== OAUTH_CONFIG.clientSecret) {
    console.log('[OAuth] Invalid credentials');
    return res.status(401).json({ error: 'invalid_client' });
  }
  
  if (grant_type === 'authorization_code') {
    const authData = OAUTH_CONFIG.authCodes.get(code);
    if (!authData) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
    
    OAUTH_CONFIG.authCodes.delete(code);
    
    const accessToken = generateToken();
    const newRefreshToken = generateToken();
    
    OAUTH_CONFIG.tokens.set(accessToken, {
      type: 'access',
      createdAt: Date.now(),
      expiresIn: 3600 * 24 * 30, // 30 days
    });
    
    OAUTH_CONFIG.tokens.set(newRefreshToken, {
      type: 'refresh',
      createdAt: Date.now(),
    });
    
    console.log('[OAuth] Token issued successfully');
    
    return res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600 * 24 * 30,
      refresh_token: newRefreshToken,
    });
  }
  
  if (grant_type === 'refresh_token') {
    const tokenData = OAUTH_CONFIG.tokens.get(refresh_token);
    if (!tokenData || tokenData.type !== 'refresh') {
      return res.status(400).json({ error: 'invalid_grant' });
    }
    
    const accessToken = generateToken();
    OAUTH_CONFIG.tokens.set(accessToken, {
      type: 'access',
      createdAt: Date.now(),
      expiresIn: 3600 * 24 * 30,
    });
    
    return res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600 * 24 * 30,
    });
  }
  
  res.status(400).json({ error: 'unsupported_grant_type' });
});

// ============================================
// AUTH MIDDLEWARE
// ============================================
function authenticate(req, res, next) {
  // Routes sans auth
  if (req.path === '/health' ||
      req.path.startsWith('/.well-known/') ||
      req.path.startsWith('/oauth/') ||
      req.path.startsWith('/mcp/')) {
    return next();
  }
  
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    console.log('[Auth] No authorization header');
    return res.status(401).json({ error: 'No authorization header' });
  }
  
  const [type, token] = authHeader.split(' ');
  
  if (type !== 'Bearer') {
    return res.status(401).json({ error: 'Invalid auth type' });
  }
  
  // Token Bearer simple
  if (token === BEARER_TOKEN) {
    return next();
  }
  
  // Token OAuth
  const tokenData = OAUTH_CONFIG.tokens.get(token);
  if (tokenData && tokenData.type === 'access') {
    const age = (Date.now() - tokenData.createdAt) / 1000;
    if (age < tokenData.expiresIn) {
      return next();
    }
    OAUTH_CONFIG.tokens.delete(token);
  }
  
  console.log('[Auth] Invalid or expired token');
  res.status(401).json({ error: 'Invalid or expired token' });
}

app.use(authenticate);

// ============================================
// MCP PROTOCOL - SSE ENDPOINT (GET)
// ============================================
app.get('/mcp/rpc', (req, res) => {
  console.log('[MCP-SSE] New SSE connection');
  
  // Setup SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Pour nginx
  res.flushHeaders();
  
  const sessionId = generateSessionId();
  
  // Stocker le client SSE
  sseClients.set(sessionId, {
    res,
    createdAt: Date.now(),
  });
  
  // Envoyer l'endpoint pour les messages
  const endpointEvent = {
    type: 'endpoint',
    url: `/mcp/rpc?sessionId=${sessionId}`,
  };
  res.write(`event: endpoint\ndata: ${JSON.stringify(endpointEvent)}\n\n`);
  
  // Heartbeat pour garder la connexion
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 30000);
  
  // Cleanup on close
  req.on('close', () => {
    console.log('[MCP-SSE] Connection closed:', sessionId);
    clearInterval(heartbeat);
    sseClients.delete(sessionId);
  });
});

// ============================================
// MCP PROTOCOL - MESSAGE ENDPOINT (POST)
// ============================================
app.post('/mcp/rpc', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body;
  const sessionId = req.query.sessionId;
  
  console.log('[MCP-RPC] Request:', { method, id, sessionId });
  
  if (jsonrpc !== '2.0') {
    return res.json({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } });
  }
  
  try {
    let result;
    
    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'ecg-pipeline-mcp-server',
            version: '2.1.0',
          },
        };
        break;
        
      case 'notifications/initialized':
        result = {};
        break;
        
      case 'tools/list':
        result = {
          tools: [
            {
              name: 'docker_ps',
              description: 'List running Docker containers for ECG Pipeline project',
              inputSchema: { type: 'object', properties: {} },
            },
            {
              name: 'docker_logs',
              description: 'Get Docker container logs',
              inputSchema: {
                type: 'object',
                properties: {
                  services: { type: 'array', items: { type: 'string' }, description: 'Service names (web, database, phpmyadmin, deepecg-backend)' },
                  tail: { type: 'number', default: 100, description: 'Number of log lines' },
                },
              },
            },
            {
              name: 'docker_restart',
              description: 'Restart Docker containers',
              inputSchema: {
                type: 'object',
                required: ['services'],
                properties: {
                  services: { type: 'array', items: { type: 'string' }, description: 'Service names to restart' },
                },
              },
            },
            {
              name: 'docker_up',
              description: 'Start Docker containers',
              inputSchema: {
                type: 'object',
                properties: {
                  services: { type: 'array', items: { type: 'string' } },
                  build: { type: 'boolean', default: false },
                },
              },
            },
            {
              name: 'docker_down',
              description: 'Stop Docker containers',
              inputSchema: {
                type: 'object',
                properties: {
                  volumes: { type: 'boolean', default: false },
                },
              },
            },
            {
              name: 'docker_build',
              description: 'Build Docker images',
              inputSchema: {
                type: 'object',
                properties: {
                  services: { type: 'array', items: { type: 'string' }, description: 'Service names to build' },
                  noCache: { type: 'boolean', default: false, description: 'Build without using cache' },
                },
              },
            },
            {
              name: 'docker_prune',
              description: 'Clean up Docker images, containers, and volumes',
              inputSchema: {
                type: 'object',
                properties: {
                  images: { type: 'boolean', default: true, description: 'Prune unused images' },
                  volumes: { type: 'boolean', default: false, description: 'Prune unused volumes' },
                  all: { type: 'boolean', default: false, description: 'Remove all unused images, not just dangling' },
                },
              },
            },
            {
              name: 'file_read',
              description: 'Read a file from the ECG Pipeline project',
              inputSchema: {
                type: 'object',
                required: ['path'],
                properties: {
                  path: { type: 'string', description: 'File path relative to project root' },
                },
              },
            },
            {
              name: 'file_write',
              description: 'Write content to a file',
              inputSchema: {
                type: 'object',
                required: ['path', 'content'],
                properties: {
                  path: { type: 'string', description: 'File path relative to project root' },
                  content: { type: 'string', description: 'File content' },
                },
              },
            },
            {
              name: 'file_list',
              description: 'List files in a directory',
              inputSchema: {
                type: 'object',
                properties: {
                  path: { type: 'string', default: '.', description: 'Directory path' },
                  recursive: { type: 'boolean', default: false },
                },
              },
            },
            {
              name: 'file_search',
              description: 'Search for pattern in files (grep)',
              inputSchema: {
                type: 'object',
                required: ['pattern'],
                properties: {
                  pattern: { type: 'string', description: 'Search pattern' },
                  path: { type: 'string', default: '.', description: 'Search path' },
                  filePattern: { type: 'string', default: '*', description: 'File glob pattern' },
                },
              },
            },
            {
              name: 'file_patch',
              description: 'Modify specific lines in a file. Can replace, delete, or view lines by line number.',
              inputSchema: {
                type: 'object',
                required: ['path'],
                properties: {
                  path: { type: 'string', description: 'File path' },
                  startLine: { type: 'number', description: 'Start line number (1-indexed)' },
                  endLine: { type: 'number', description: 'End line number (inclusive). If omitted, only startLine is affected' },
                  content: { type: 'string', description: 'New content to replace the lines. If omitted, lines are deleted' },
                  viewOnly: { type: 'boolean', default: false, description: 'If true, just show the lines without modifying' },
                },
              },
            },
            {
              name: 'file_replace',
              description: 'Find and replace text in a file. The search string must be unique in the file.',
              inputSchema: {
                type: 'object',
                required: ['path', 'search', 'replace'],
                properties: {
                  path: { type: 'string', description: 'File path' },
                  search: { type: 'string', description: 'Text to find (must be unique in the file)' },
                  replace: { type: 'string', description: 'Text to replace with' },
                },
              },
            },
            {
              name: 'file_insert',
              description: 'Insert content at a specific line number',
              inputSchema: {
                type: 'object',
                required: ['path', 'line', 'content'],
                properties: {
                  path: { type: 'string', description: 'File path' },
                  line: { type: 'number', description: 'Line number to insert at (1-indexed). Content will be inserted BEFORE this line' },
                  content: { type: 'string', description: 'Content to insert' },
                },
              },
            },
            {
              name: 'git_status',
              description: 'Get git status',
              inputSchema: { type: 'object', properties: {} },
            },
            {
              name: 'git_diff',
              description: 'Get git diff',
              inputSchema: {
                type: 'object',
                properties: {
                  staged: { type: 'boolean', default: false },
                },
              },
            },
            {
              name: 'git_commit',
              description: 'Add all changes and commit',
              inputSchema: {
                type: 'object',
                required: ['message'],
                properties: {
                  message: { type: 'string', description: 'Commit message' },
                },
              },
            },
            {
              name: 'git_push',
              description: 'Push to remote',
              inputSchema: {
                type: 'object',
                properties: {
                  branch: { type: 'string', default: 'main' },
                },
              },
            },
            {
              name: 'shell_exec',
              description: 'Execute shell command (docker, docker-compose, cat, ls, head, tail, mysql only)',
              inputSchema: {
                type: 'object',
                required: ['command'],
                properties: {
                  command: { type: 'string', description: 'Command to execute' },
                  cwd: { type: 'string', default: '.', description: 'Working directory' },
                },
              },
            },
            {
              name: 'batch',
              description: 'Execute multiple operations at once',
              inputSchema: {
                type: 'object',
                required: ['operations'],
                properties: {
                  operations: {
                    type: 'array',
                    description: 'Array of operations',
                    items: {
                      type: 'object',
                      properties: {
                        type: { type: 'string', enum: ['file_write', 'file_delete', 'shell_exec', 'docker_restart'] },
                        path: { type: 'string' },
                        content: { type: 'string' },
                        command: { type: 'string' },
                        services: { type: 'array', items: { type: 'string' } },
                      },
                    },
                  },
                },
              },
            },
          ],
        };
        break;
        
      case 'tools/call':
        result = await handleToolCall(params.name, params.arguments || {});
        break;
        
      default:
        console.log('[MCP-RPC] Unknown method:', method);
        return res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
    
    console.log('[MCP-RPC] Response sent for:', method);
    res.json({ jsonrpc: '2.0', id, result });
    
  } catch (error) {
    console.error('[MCP-RPC] Error:', error);
    res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: error.message } });
  }
});

// ============================================
// TOOL HANDLERS (partagé entre MCP et Gemini)
// ============================================
async function handleToolCall(name, args) {
  console.log('[Tool] Calling:', name, args);
  
  try {
    switch (name) {
      case 'docker_ps':
        return { content: [{ type: 'text', text: execCommand('docker-compose ps').output || 'No containers' }] };
        
      case 'docker_logs': {
        const tail = args.tail || 100;
        const services = (args.services || []).join(' ');
        const cmd = `docker-compose logs --tail=${tail} --no-color ${services}`.trim();
        const result = execCommand(cmd);
        return { content: [{ type: 'text', text: result.output || result.stderr || 'No logs' }] };
      }
        
      case 'docker_restart': {
        const services = (args.services || []).join(' ');
        const result = execCommand(`docker-compose restart ${services}`);
        return { content: [{ type: 'text', text: result.success ? `Restarted: ${services}` : result.error }] };
      }
        
      case 'docker_up': {
        let cmd = 'docker-compose up -d';
        if (args.build) cmd += ' --build';
        if (args.services?.length) cmd += ` ${args.services.join(' ')}`;
        const result = execCommand(cmd);
        return { content: [{ type: 'text', text: result.success ? 'Containers started' : result.error }] };
      }
        
      case 'docker_down': {
        let cmd = 'docker-compose down';
        if (args.volumes) cmd += ' -v';
        const result = execCommand(cmd);
        return { content: [{ type: 'text', text: result.success ? 'Containers stopped' : result.error }] };
      }
      
      case 'docker_build': {
        let cmd = 'docker-compose build';
        if (args.noCache) cmd += ' --no-cache';
        if (args.services?.length) cmd += ` ${args.services.join(' ')}`;
        const result = execCommand(cmd);
        return { content: [{ type: 'text', text: result.success ? `Build completed:\n${result.output}` : result.error }] };
      }
      
      case 'docker_prune': {
        const results = [];
        if (args.images !== false) {
          let cmd = 'docker image prune -f';
          if (args.all) cmd += ' -a';
          const r = execCommand(cmd);
          results.push(`Images: ${r.success ? r.output : r.error}`);
        }
        if (args.volumes) {
          const r = execCommand('docker volume prune -f');
          results.push(`Volumes: ${r.success ? r.output : r.error}`);
        }
        return { content: [{ type: 'text', text: results.join('\n') || 'Prune completed' }] };
      }
        
      case 'file_read': {
        const content = await fs.readFile(sanitizePath(args.path), 'utf-8');
        return { content: [{ type: 'text', text: content }] };
      }
        
      case 'file_write': {
        const fullPath = sanitizePath(args.path);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, args.content, 'utf-8');
        return { content: [{ type: 'text', text: `Written: ${args.path}` }] };
      }
        
      case 'file_list': {
        const dirPath = sanitizePath(args.path || '.');
        if (args.recursive) {
          const result = execCommand(
            `find . -type f \\( -name "*.php" -o -name "*.js" -o -name "*.css" -o -name "*.json" -o -name "*.yml" -o -name "*.yaml" -o -name "*.xml" \\) | grep -v vendor | grep -v .git | grep -v node_modules | head -300`,
            dirPath
          );
          return { content: [{ type: 'text', text: result.output || 'No files found' }] };
        } else {
          const entries = await fs.readdir(dirPath, { withFileTypes: true });
          const list = entries.map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n');
          return { content: [{ type: 'text', text: list }] };
        }
      }
        
      case 'file_search': {
        const searchPath = sanitizePath(args.path || '.');
        const filePattern = args.filePattern || '*.php,*.js,*.css';
        const patterns = filePattern.split(',').map(p => `--include="${p.trim()}"`).join(' ');
        const result = execCommand(
          `grep -rn ${patterns} "${args.pattern}" . | grep -v vendor | grep -v node_modules | head -100`,
          searchPath
        );
        return { content: [{ type: 'text', text: result.output || 'No matches found' }] };
      }
      
      case 'file_patch': {
        const fullPath = sanitizePath(args.path);
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');
        
        const startLine = args.startLine || 1;
        const endLine = args.endLine || startLine;
        
        if (startLine < 1 || endLine < startLine || startLine > lines.length) {
          return { content: [{ type: 'text', text: `Invalid line range. File has ${lines.length} lines.` }], isError: true };
        }
        
        if (args.viewOnly) {
          const selectedLines = lines.slice(startLine - 1, endLine);
          const output = selectedLines.map((line, i) => `${startLine + i}: ${line}`).join('\n');
          return { content: [{ type: 'text', text: output }] };
        }
        
        const newLines = args.content !== undefined ? args.content.split('\n') : [];
        lines.splice(startLine - 1, endLine - startLine + 1, ...newLines);
        
        await fs.writeFile(fullPath, lines.join('\n'), 'utf-8');
        
        const action = args.content === undefined ? 'Deleted' : 'Replaced';
        return { content: [{ type: 'text', text: `${action} lines ${startLine}-${endLine} in ${args.path}` }] };
      }
      
      case 'file_replace': {
        const fullPath = sanitizePath(args.path);
        const content = await fs.readFile(fullPath, 'utf-8');
        
        const occurrences = content.split(args.search).length - 1;
        
        if (occurrences === 0) {
          return { content: [{ type: 'text', text: `Search string not found in ${args.path}` }], isError: true };
        }
        
        if (occurrences > 1) {
          return { content: [{ type: 'text', text: `Search string found ${occurrences} times. Must be unique. Use file_patch with line numbers instead.` }], isError: true };
        }
        
        const newContent = content.replace(args.search, args.replace);
        await fs.writeFile(fullPath, newContent, 'utf-8');
        
        return { content: [{ type: 'text', text: `Replaced in ${args.path}` }] };
      }
      
      case 'file_insert': {
        const fullPath = sanitizePath(args.path);
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');
        
        const line = args.line || 1;
        
        if (line < 1 || line > lines.length + 1) {
          return { content: [{ type: 'text', text: `Invalid line number. File has ${lines.length} lines.` }], isError: true };
        }
        
        const newLines = args.content.split('\n');
        lines.splice(line - 1, 0, ...newLines);
        
        await fs.writeFile(fullPath, lines.join('\n'), 'utf-8');
        
        return { content: [{ type: 'text', text: `Inserted ${newLines.length} line(s) at line ${line} in ${args.path}` }] };
      }
        
      case 'git_status': {
        const result = execCommand('git status');
        return { content: [{ type: 'text', text: result.output || result.error }] };
      }
        
      case 'git_diff': {
        const cmd = args.staged ? 'git diff --staged' : 'git diff';
        const result = execCommand(cmd);
        return { content: [{ type: 'text', text: result.output || 'No changes' }] };
      }
        
      case 'git_commit': {
        execCommand('git add -A');
        const result = execCommand(`git commit -m "${args.message.replace(/"/g, '\\"')}"`);
        return { content: [{ type: 'text', text: result.output || result.error }] };
      }
        
      case 'git_push': {
        const branch = args.branch || 'main';
        const result = execCommand(`git push origin ${branch}`);
        return { content: [{ type: 'text', text: result.success ? `Pushed to ${branch}` : result.error }] };
      }
        
      case 'shell_exec': {
        const allowed = ['docker', 'docker-compose', 'cat', 'ls', 'pwd', 'head', 'tail', 'wc', 'echo', 'find', 'rm', 'chmod', 'mkdir', 'cp', 'mv', 'grep', 'touch', 'mysql'];
        const cmdBase = args.command.split(' ')[0];
        if (!allowed.includes(cmdBase)) {
          return { content: [{ type: 'text', text: `Command not allowed: ${cmdBase}. Allowed: ${allowed.join(', ')}` }], isError: true };
        }
        if (!validateDockerCommand(args.command)) {
          return { content: [{ type: "text", text: "Docker command must target ecg-dev containers only" }], isError: true };
        }
        const result = execCommand(args.command, sanitizePath(args.cwd || '.'));
        return { content: [{ type: 'text', text: result.output || result.error || 'No output' }] };
      }
        
      case 'batch': {
        const results = [];
        for (const op of args.operations || []) {
          try {
            let opResult;
            switch (op.type) {
              case 'file_write':
                const writePath = sanitizePath(op.path);
                await fs.mkdir(path.dirname(writePath), { recursive: true });
                await fs.writeFile(writePath, op.content, 'utf-8');
                opResult = `✓ Written: ${op.path}`;
                break;
              case 'file_delete':
                await fs.unlink(sanitizePath(op.path));
                opResult = `✓ Deleted: ${op.path}`;
                break;
              case 'shell_exec':
                const shellResult = execCommand(op.command, sanitizePath(op.cwd || '.'));
                opResult = `✓ Exec: ${shellResult.output || shellResult.error}`;
                break;
              case 'docker_restart':
                execCommand(`docker-compose restart ${(op.services || []).join(' ')}`);
                opResult = `✓ Restarted: ${op.services?.join(', ')}`;
                break;
              default:
                opResult = `✗ Unknown operation: ${op.type}`;
            }
            results.push(opResult);
          } catch (e) {
            results.push(`✗ Error in ${op.type}: ${e.message}`);
          }
        }
        return { content: [{ type: 'text', text: results.join('\n') }] };
      }
        
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (error) {
    console.error('[Tool] Error:', error);
    return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
  }
}

// ============================================
// REST API ENDPOINTS
// ============================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ecg-pipeline-mcp-server', version: '2.1.0', workspace: WORKSPACE, time: new Date().toISOString() });
});

app.get('/.well-known/openapi.json', (req, res) => {
  res.json({
    openapi: '3.0.0',
    info: { title: 'ECG Pipeline MCP Server', version: '2.1.0' },
    servers: [{ url: 'https://ecg-dev.data-coeur.com/mcp' }],
  });
});

// Docker endpoints REST
app.get('/docker/compose/ps', (req, res) => res.json(execCommand('docker-compose ps')));
app.post('/docker/compose/up', (req, res) => {
  let cmd = 'docker-compose up -d';
  if (req.body.build) cmd += ' --build';
  if (req.body.services?.length) cmd += ` ${req.body.services.join(' ')}`;
  res.json(execCommand(cmd));
});
app.post('/docker/compose/down', (req, res) => {
  let cmd = 'docker-compose down';
  if (req.body.volumes) cmd += ' -v';
  res.json(execCommand(cmd));
});
app.post('/docker/compose/restart', (req, res) => {
  const services = (req.body.services || []).join(' ');
  res.json(execCommand(`docker-compose restart ${services}`));
});
app.post('/docker/compose/logs', (req, res) => {
  const tail = req.body.tail || 100;
  const services = (req.body.services || []).join(' ');
  res.json(execCommand(`docker-compose logs --tail=${tail} --no-color ${services}`));
});

// File endpoints REST
app.post('/file/read', async (req, res) => {
  try {
    const content = await fs.readFile(sanitizePath(req.body.path), 'utf-8');
    res.json({ success: true, content });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});
app.post('/file/write', async (req, res) => {
  try {
    const fullPath = sanitizePath(req.body.path);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, req.body.content, 'utf-8');
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});
app.post('/file/list', async (req, res) => {
  try {
    const entries = await fs.readdir(sanitizePath(req.body.path || '.'), { withFileTypes: true });
    res.json({ success: true, files: entries.map(e => ({ name: e.name, isDirectory: e.isDirectory() })) });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});
app.post('/file/search', (req, res) => {
  const result = execCommand(`grep -rn "${req.body.pattern}" . | head -100`, sanitizePath(req.body.path || '.'));
  res.json(result);
});

// Git endpoints REST
app.get('/git/status', (req, res) => res.json(execCommand('git status --porcelain')));
app.get('/git/log', (req, res) => res.json(execCommand(`git log --oneline -${req.query.count || 10}`)));
app.post('/git/commit', (req, res) => {
  execCommand('git add -A');
  res.json(execCommand(`git commit -m "${req.body.message}"`));
});
app.post('/git/push', (req, res) => res.json(execCommand(`git push origin ${req.body.branch || 'main'}`)));

// Shell endpoint REST
app.post('/shell/exec', (req, res) => {
  const allowed = ['docker', 'docker-compose', 'cat', 'ls', 'pwd', 'head', 'tail', 'wc', 'mysql'];
  const cmdBase = req.body.command.split(' ')[0];
  if (!allowed.includes(cmdBase)) {
    return res.status(403).json({ error: `Command not allowed` });
  }
  res.json(execCommand(req.body.command, sanitizePath(req.body.cwd || '.')));
});

// Batch endpoint REST
app.post('/batch', async (req, res) => {
  const results = [];
  for (const op of req.body.operations || []) {
    try {
      switch (op.type) {
        case 'file/write':
          await fs.writeFile(sanitizePath(op.path), op.content, 'utf-8');
          results.push({ success: true, type: op.type, path: op.path });
          break;
        default:
          results.push({ success: false, error: 'Unknown operation' });
      }
    } catch (e) {
      results.push({ success: false, error: e.message });
    }
  }
  res.json({ results });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, '0.0.0.0', () => {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║     ECG Pipeline MCP Server v2.1.0           ║');
  console.log('╠═══════════════════════════════════════════════════╣');
  console.log(`║ Port:         ${PORT}                                 ║`);
  console.log(`║ Workspace:    ${WORKSPACE.substring(0, 35).padEnd(35)}║`);
  console.log('╠═══════════════════════════════════════════════════╣');
  console.log('║ MCP Protocol (Claude):                            ║');
  console.log('║   GET  /mcp/rpc (SSE stream)                      ║');
  console.log('║   POST /mcp/rpc (JSON-RPC messages)               ║');
  console.log('╠═══════════════════════════════════════════════════╣');
  console.log('║ OAuth 2.0:                                        ║');
  console.log('║   GET  /oauth/authorize                           ║');
  console.log('║   POST /oauth/token                               ║');
  console.log('╠═══════════════════════════════════════════════════╣');
  console.log('║ REST API: /docker/* /file/* /git/* /shell/*       ║');
  console.log('╚═══════════════════════════════════════════════════╝');
});
