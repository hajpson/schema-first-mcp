import crypto from 'node:crypto';

const BASE = process.env.BASE || 'http://localhost:3000';

async function main() {
  // 1. register
  const regRes = await fetch(`${BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: ['http://localhost/callback'],
      client_name: 'e2e',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  const reg = await regRes.json();
  console.log('registered client', reg.client_id);

  // 2. authorize
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const authUrl = `${BASE}/authorize?response_type=code&client_id=${encodeURIComponent(
    reg.client_id
  )}&redirect_uri=${encodeURIComponent('http://localhost/callback')}&scope=mcp&code_challenge=${challenge}&code_challenge_method=S256`;
  const authRes = await fetch(authUrl, { redirect: 'manual' });
  const loc = authRes.headers.get('location') || '';
  const code = new URL(loc).searchParams.get('code');
  console.log('authorize -> code', !!code);

  // 3. token (public client: client_secret only if present)
  const tokBody = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: 'http://localhost/callback',
    client_id: reg.client_id,
    code_verifier: verifier,
  };
  if (reg.client_secret) tokBody.client_secret = reg.client_secret;
  const tokRes = await fetch(`${BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(tokBody),
  });
  const tok = await tokRes.json();
  if (!tok.access_token) throw new Error('no token: ' + JSON.stringify(tok));
  console.log('got token');
  const AUTH = `Bearer ${tok.access_token}`;

  // 4. MCP initialize
  const init = await mcpCall(AUTH, 1, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'e2e', version: '1' },
  });
  if (!init || init.error) throw new Error('init failed: ' + JSON.stringify(init));
  const sess = init._session;
  console.log('initialized, protocol', init.result?.protocolVersion, 'session', !!sess);

  // 5. tools/list
  const list = await mcpCall(AUTH, 2, 'tools/list', {}, sess);
  const tools = list.result?.tools || [];
  console.log('tools:', tools.map((t) => t.name).join(', '));
  for (const t of tools) {
    console.log('  ', t.name, 'in:', !!t.inputSchema, 'out:', !!t.outputSchema);
  }

  // 6. call each tool
  // memo_write
  const w = await mcpCall(AUTH, 3, 'tools/call', { name: 'memo_write', arguments: { text: 'hello world note' } }, sess);
  console.log('memo_write ->', JSON.stringify(w.result));
  // memo_search
  const s = await mcpCall(AUTH, 4, 'tools/call', { name: 'memo_search', arguments: { query: 'hello' } }, sess);
  console.log('memo_search ->', JSON.stringify(s.result));
  // upload
  const fileContent = Buffer.from('hello file').toString('base64');
  const u = await mcpCall(AUTH, 5, 'tools/call', { name: 'upload', arguments: { filename: 'a.txt', content: fileContent } }, sess);
  console.log('upload ->', JSON.stringify(u.result));
  // transcribe (small wav: 1s silence 8kHz mono 16-bit)
  const wav = makeWav(8000, 1);
  const up2 = await mcpCall(AUTH, 6, 'tools/call', { name: 'upload', arguments: { filename: 'a.wav', content: Buffer.from(wav).toString('base64') } }, sess);
  const audioUrl = up2.result?.structuredContent?.url;
  const tr = await mcpCall(AUTH, 7, 'tools/call', { name: 'transcribe', arguments: { url: audioUrl } }, sess);
  console.log('transcribe ->', JSON.stringify(tr.result));
}

async function mcpCall(auth, id, method, params, session) {
  const body = { jsonrpc: '2.0', id, method, params };
  const headers = {
    Authorization: auth,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (session) headers['Mcp-Session-Id'] = session;
  const res = await fetch(`${BASE}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    // maybe SSE
    json = parseSse(text);
  }
  json._session = res.headers.get('mcp-session-id') || session;
  return json;
}

function parseSse(text) {
  // last data line
  const lines = text.split('\n').filter((l) => l.startsWith('data:'));
  if (lines.length === 0) return null;
  try {
    return JSON.parse(lines[lines.length - 1].slice(5).trim());
  } catch {
    return { raw: text };
  }
}

function makeWav(sampleRate, seconds) {
  const numSamples = sampleRate * seconds;
  const buf = Buffer.alloc(44 + numSamples * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + numSamples * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(numSamples * 2, 40);
  return buf;
}

main().catch((e) => {
  console.error('E2E FAILED:', e.message);
  process.exit(1);
});