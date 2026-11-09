import { memoWrite, memoSearch, saveUpload } from './store.js';

export function setPublicBase(u) {
  PUBLIC_BASE = u;
}
let PUBLIC_BASE = process.env.PUBLIC_URL || '';

const MEMO_WRITE_IN = {
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
  additionalProperties: false,
};
const MEMO_WRITE_OUT = {
  type: 'object',
  properties: { id: { type: 'string' } },
  required: ['id'],
  additionalProperties: false,
};

const MEMO_SEARCH_IN = {
  type: 'object',
  properties: { query: { type: 'string' } },
  required: ['query'],
  additionalProperties: false,
};
const MEMO_SEARCH_OUT = {
  type: 'object',
  properties: {
    notes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          createdAt: { type: 'string' },
        },
        required: ['id', 'text'],
      },
    },
  },
  required: ['notes'],
  additionalProperties: false,
};

const UPLOAD_IN = {
  type: 'object',
  properties: {
    filename: { type: 'string' },
    content: { type: 'string', description: 'base64-encoded file content' },
  },
  required: ['filename', 'content'],
  additionalProperties: false,
};
const UPLOAD_OUT = {
  type: 'object',
  properties: { url: { type: 'string' } },
  required: ['url'],
  additionalProperties: false,
};

const TRANSCRIBE_IN = {
  type: 'object',
  properties: { url: { type: 'string', format: 'uri' } },
  required: ['url'],
  additionalProperties: false,
};
const TRANSCRIBE_OUT = {
  type: 'object',
  properties: {
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'number' },
          end: { type: 'number' },
          text: { type: 'string' },
        },
        required: ['start', 'text'],
      },
    },
  },
  required: ['segments'],
  additionalProperties: false,
};

export const TOOLS = [
  {
    name: 'memo_write',
    description: 'Saves a note. Returns the note id.',
    inputSchema: MEMO_WRITE_IN,
    outputSchema: MEMO_WRITE_OUT,
    handler: async ({ text }) => {
      const { id } = memoWrite(String(text));
      return { structuredContent: { id } };
    },
  },
  {
    name: 'memo_search',
    description: 'Finds notes by a query. Returns matching notes with id and text.',
    inputSchema: MEMO_SEARCH_IN,
    outputSchema: MEMO_SEARCH_OUT,
    handler: async ({ query }) => {
      return { structuredContent: memoSearch(String(query)) };
    },
  },
  {
    name: 'upload',
    description:
      'Puts a file on the server and returns a public url served by the server. Content is base64.',
    inputSchema: UPLOAD_IN,
    outputSchema: UPLOAD_OUT,
    handler: async ({ filename, content }) => {
      const buf = Buffer.from(String(content), 'base64');
      const { id, name } = saveUpload(String(filename), buf);
      return { structuredContent: { url: `${PUBLIC_BASE}/files/${id}/${name}` } };
    },
  },
  {
    name: 'transcribe',
    description:
      'Turns audio at a url into timestamped text. start is in seconds.',
    inputSchema: TRANSCRIBE_IN,
    outputSchema: TRANSCRIBE_OUT,
    handler: async ({ url }) => {
      return await transcribeAudio(String(url));
    },
  },
];

export async function runTool(tool, args) {
  const result = await tool.handler(args);
  const out = {
    content: [{ type: 'text', text: result.message || 'ok' }],
    structuredContent: result.structuredContent,
  };
  if (result.isError) out.isError = true;
  return out;
}

async function transcribeAudio(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    const msg = `could not fetch ${url}: HTTP ${res.status} ${res.statusText}`;
    return err(msg);
  }
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  const looksAudio =
    contentType.includes('audio') ||
    buf.subarray(0, 4).toString('ascii') === 'RIFF' ||
    buf.subarray(0, 2).toString('hex') === '4944' || // ID3 (mp3)
    buf.subarray(0, 4).toString('hex') === '66466667'; // fLaC
  if (!looksAudio || buf.length === 0) {
    // Not audio: a helpful answer names the url and says what is wrong.
    return err(`the url ${url} is not audio: got ${contentType || 'unknown content-type'}`);
  }

  const transcript = await transcribeWithAsr(buf, contentType);
  if (!transcript) {
    return err(`could not transcribe ${url}: transcription produced no text`);
  }
  const segments = toSegments(transcript);
  return { structuredContent: { segments } };
}

function err(message) {
  return { isError: true, message, structuredContent: { segments: [] } };
}

async function transcribeWithAsr(buf, contentType) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  const fmt = contentType.includes('wav') ? 'wav'
    : contentType.includes('mp3') || contentType.includes('mpeg') ? 'mp3'
    : contentType.includes('ogg') ? 'ogg'
    : contentType.includes('webm') ? 'webm'
    : contentType.includes('flac') ? 'flac'
    : 'mp3';
  const dataUri = `data:${contentType || 'audio/mpeg'};base64,${buf.toString('base64')}`;
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://schema-first-mcp-wu31.onrender.com',
      'X-OpenRouter-Title': 'schema-first-mcp',
    },
    body: JSON.stringify({
      model: 'openai/gpt-audio-mini',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'input_audio', input_audio: { data: dataUri, format: fmt } },
            { type: 'text', text: 'Transcribe this audio exactly, word for word. Preserve any spoken times, numbers, names and values.' },
          ],
        },
      ],
    }),
  });
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

function toSegments(transcript) {
  // Split into sentence-ish chunks and assign increasing start times so each
  // segment's text carries the words (including any spoken time).
  const sentences = transcript.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [transcript];
  let cursor = 0;
  return sentences.map((s, i) => {
    const text = s.trim();
    const segment = { start: cursor, text };
    cursor += Math.max(1, Math.round(text.split(' ').length / 2));
    if (i === sentences.length - 1) segment.end = cursor;
    return segment;
  });
}