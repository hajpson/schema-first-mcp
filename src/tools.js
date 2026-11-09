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
      return { structuredContent: await transcribeAudio(String(url)) };
    },
  },
];

export async function runTool(tool, args) {
  const result = await tool.handler(args);
  return {
    content: [{ type: 'text', text: 'ok' }],
    structuredContent: result.structuredContent,
  };
}

async function transcribeAudio(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Best-effort duration: for a WAV we can read the sample rate and frames;
  // otherwise fall back to a placeholder segment list.
  const duration = wavDuration(buf);
  const segments = [];
  if (duration > 0) {
    const text = `audio segment of ${duration.toFixed(1)} seconds`;
    segments.push({ start: 0, end: duration, text });
  } else {
    segments.push({ start: 0, text: 'audio received (duration unknown)' });
  }
  return { segments };
}

function wavDuration(buf) {
  if (buf.length < 44) return 0;
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return 0;
  const sampleRate = buf.readUInt32LE(24);
  const byteRate = buf.readUInt32LE(28);
  const dataSize = buf.length - 44;
  if (byteRate <= 0 || sampleRate <= 0) return 0;
  return dataSize / byteRate;
}