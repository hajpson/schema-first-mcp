import crypto from 'node:crypto';

const BASE = process.env.BASE || 'https://schema-first-mcp-wu31.onrender.com';
const TEXT = process.argv[2] || '';

async function callTool(name, args) {
  // register
  const regRes = await fetch(`${BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: ['http://localhost/callback'],
      client_name: 'note-saver',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  const reg = await regRes.json();
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const authUrl = `${BASE}/authorize?response_type=code&client_id=${encodeURIComponent(reg.client_id)}&redirect_uri=${encodeURIComponent('http://localhost/callback')}&scope=mcp&code_challenge=${challenge}&code_challenge_method=S256`;
  const aRes = await fetch(authUrl, { redirect: 'manual' });
  const code = new URL(aRes.headers.get('location')).searchParams.get('code');
  const tokBody = {
    grant_type: 'authorization_code', code, redirect_uri: 'http://localhost/callback',
    client_id: reg.client_id, code_verifier: verifier,
  };
  if (reg.client_secret) tokBody.client_secret = reg.client_secret;
  const tRes = await fetch(`${BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(tokBody),
  });
  const tok = await tRes.json();
  const auth = `Bearer ${tok.access_token}`;
  // initialize
  const init = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'notesaver', version: '1' } } }),
  });
  const initText = await init.text();
  const sess = init.headers.get('mcp-session-id');
  // call
  const call = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(sess ? { 'Mcp-Session-Id': sess } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }),
  });
  const callText = await call.text();
  return { callText, sess };
}

const { callText } = await callTool('memo_write', { text: TEXT });
console.log('memo_write result:', callText);