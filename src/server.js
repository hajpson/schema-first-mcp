import express from 'express';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter, mcpAuthMetadataRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { TOOLS, runTool, setPublicBase } from './tools.js';
import { authProvider, tokenVerifier } from './auth-provider.js';
import { listUploads, UPLOAD_DIR } from './store.js';

const PORT = process.env.PORT || 3000;
const PUBLIC_URL =
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  `http://localhost:${PORT}`;
const ISSUER_URL = new URL(PUBLIC_URL);
const MCP_URL = new URL('/mcp', ISSUER_URL);
const RESOURCE_METADATA_URL = getOAuthProtectedResourceMetadataUrl(MCP_URL);

const app = express();
app.use(express.json({ limit: '25mb' }));
setPublicBase(PUBLIC_URL);

// ---- Plan page (resource_documentation) and human-facing pages ----
const planHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>schema-first MCP server</title></head><body><h1>schema-first MCP server</h1>
<p>A remote MCP server exposing four tools: <code>memo_write</code>, <code>memo_search</code>,
<code>upload</code>, and <code>transcribe</code>.</p>
<h2>How sign-in works</h2>
<p>Clients connect over OAuth 2.1. The authorization flow runs here; the owner approves each
client before it can call the tools. Requests to the <code>/mcp</code> endpoint must carry a
Bearer access token from this server.</p>
<h2>What data it keeps</h2>
<p>Memos are stored as plain text on the server with an id and a timestamp. Uploads are stored
as files and served back from <code>/files/...</code>. Nothing is shared with third parties.</p>
</body></html>`;

app.get(['/plan', '/'], (_req, res) => {
  res.type('html').send(planHtml);
});

// ---- OAuth authorization server + metadata ----
app.use(
  mcpAuthRouter({
    provider: authProvider,
    issuerUrl: ISSUER_URL,
    baseUrl: ISSUER_URL,
    resourceServerUrl: MCP_URL,
    resourceName: 'schema-first MCP server',
    serviceDocumentationUrl: new URL('/plan', ISSUER_URL),
    scopesSupported: ['mcp'],
  })
);

app.use(
  mcpAuthMetadataRouter({
    oauthMetadata: {
      issuer: ISSUER_URL.toString(),
      authorization_endpoint: new URL('/authorize', ISSUER_URL).toString(),
      token_endpoint: new URL('/token', ISSUER_URL).toString(),
      registration_endpoint: new URL('/register', ISSUER_URL).toString(),
      scopes_supported: ['mcp'],
    },
    resourceServerUrl: MCP_URL,
    serviceDocumentationUrl: new URL('/plan', ISSUER_URL),
    resourceName: 'schema-first MCP server',
    scopesSupported: ['mcp'],
  })
);

// ---- Uploaded files served publicly ----
app.get('/files/:id/:name', (req, res) => {
  const uploads = listUploads();
  const match = uploads.find((f) => f.startsWith(req.params.id));
  if (!match) {
    return res.status(404).send('not found');
  }
  res.sendFile(match, { root: UPLOAD_DIR });
});

// ---- Low-level MCP Server factory: one instance per connection ----
function makeMcpServer() {
  const server = new Server(
    { name: 'schema-first-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments ?? {};
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) {
      return { isError: true, content: [{ type: 'text', text: `unknown tool: ${name}` }] };
    }
    try {
      return await runTool(tool, args);
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: err.message || String(err) }] };
    }
  });

  return server;
}

const protectedRes = requireBearerAuth({
  verifier: tokenVerifier,
  requiredScopes: ['mcp'],
  resourceMetadataUrl: RESOURCE_METADATA_URL,
});

// Streamable HTTP keeps one Server per session. Key sessions by their id.
const sessions = new Map();

async function handleMcp(req, res) {
  const sessionId = req.headers['mcp-session-id'];
  let session = sessions.get(sessionId);

  if (!session) {
    const server = makeMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    session = { server, transport };
    if (sessionId) sessions.set(sessionId, session);
    await server.connect(transport);
  }

  const originalSetHeader = res.setHeader.bind(res);
  res.setHeader = (name, value) => {
    originalSetHeader(name, value);
    if (String(name).toLowerCase() === 'mcp-session-id') {
      sessions.set(String(value), session);
    }
  };

  try {
    await session.transport.handleRequest(req, res, req.body);
  } finally {
    res.setHeader = originalSetHeader;
  }
}

app.get('/mcp', protectedRes, handleMcp);
app.post('/mcp', protectedRes, handleMcp);

app.listen(PORT, () => {
  console.log(`schema-first MCP server listening on ${PORT}`);
  console.log(`mcp endpoint: ${MCP_URL}`);
  console.log(`protected resource metadata: ${RESOURCE_METADATA_URL}`);
});