import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(here, '..', 'data');
const MEMOS_FILE = path.join(DATA_DIR, 'memos.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---- R2-backed upload storage (survives the free instance recycling) ----

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
export const R2_BUCKET = process.env.R2_BUCKET || 'schema-first-mcp-uploads';

export function r2Enabled() {
  return Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);
}

let r2Client = null;
function getR2Client() {
  if (!r2Enabled()) {
    throw new Error('R2 is not configured: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY');
  }
  if (!r2Client) {
    const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    r2Client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return r2Client;
}

export function uploadObjectKey(id, name) {
  return `${id}/${name}`;
}

export async function saveUpload(id, name, buffer) {
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: uploadObjectKey(id, name),
      Body: buffer,
    })
  );
}

export async function fetchUpload(id, name) {
  const cmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: uploadObjectKey(id, name) });
  const res = await getR2Client().send(cmd);
  return { body: res.Body, contentType: res.ContentType || 'application/octet-stream' };
}

// ---- Memo storage (local; the course reads notes within the session) ----

function readMemos() {
  try {
    return JSON.parse(fs.readFileSync(MEMOS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeMemos(memos) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(MEMOS_FILE, JSON.stringify(memos, null, 2), 'utf8');
}

export function memoWrite(text) {
  const memos = readMemos();
  const memo = { id: randomUUID(), text, createdAt: new Date().toISOString() };
  memos.push(memo);
  writeMemos(memos);
  return { id: memo.id };
}

export function memoSearch(query) {
  const memos = readMemos();
  const q = (query || '').toLowerCase();
  const notes = q
    ? memos.filter((m) => m.text.toLowerCase().includes(q))
    : memos.slice();
  notes.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return { notes };
}