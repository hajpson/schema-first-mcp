import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(here, '..', 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const MEMOS_FILE = path.join(DATA_DIR, 'memos.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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
  // newest first
  notes.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return { notes };
}

export function saveUpload(filename, buffer) {
  const id = randomUUID();
  const safe = path.basename(filename || 'file').replace(/[^A-Za-z0-9._-]/g, '_');
  fs.writeFileSync(path.join(UPLOAD_DIR, `${id}-${safe}`), buffer);
  return { id, name: safe };
}

export function listUploads() {
  try {
    return fs.readdirSync(UPLOAD_DIR);
  } catch {
    return [];
  }
}