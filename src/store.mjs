// Storage layer: Netlify Blobs when running on Netlify, local JSON file otherwise.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const STORE_NAME = 'pocket-fortress';
const FILE_DIR = process.env.LEDGER_DATA_DIR || path.join(process.cwd(), '.data');
const FILE_PATH = path.join(FILE_DIR, 'ledger.json');
const onNetlify = process.env.NETLIFY === 'true';

let blobs = null;
let mode = null; // 'blobs' | 'file'
let initError = null;

// Local (non-Netlify) file cache
let cache = null;

async function init() {
  if (mode) return mode;
  try {
    if (onNetlify) {
      const { getStore } = await import('@netlify/blobs');
      blobs = getStore(STORE_NAME);
      mode = 'blobs';
    } else {
      mode = 'file';
    }
  } catch (err) {
    initError = err;
    mode = 'file';
    if (onNetlify) {
      // Never silently fall back to disk on Netlify: the filesystem there is
      // ephemeral, so writes would be lost between invocations.
      console.error('[pocket-fortress] Netlify Blobs unavailable:', err.message);
    }
  }
  return mode;
}

function assertUsable() {
  if (onNetlify && initError) {
    throw new Error(`Storage unavailable: ${initError.message}`);
  }
}

async function fileLoad() {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(FILE_PATH, 'utf8'));
  } catch {
    cache = {};
  }
  return cache;
}

async function fileSave() {
  await mkdir(FILE_DIR, { recursive: true });
  const tmp = `${FILE_PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(cache), 'utf8');
  await rename(tmp, FILE_PATH);
}

export async function dbGet(key) {
  await init();
  assertUsable();
  if (mode === 'blobs') {
    const value = await blobs.get(key, { type: 'json' });
    return value ?? null;
  }
  const data = await fileLoad();
  return key in data ? data[key] : null;
}

export async function dbSet(key, value) {
  await init();
  assertUsable();
  if (mode === 'blobs') {
    await blobs.setJSON(key, value);
    return;
  }
  const data = await fileLoad();
  data[key] = value;
  await fileSave();
}

export async function dbDel(key) {
  await init();
  assertUsable();
  if (mode === 'blobs') {
    await blobs.delete(key);
    return;
  }
  const data = await fileLoad();
  if (key in data) {
    delete data[key];
    await fileSave();
  }
}

export async function dbList(prefix = '') {
  await init();
  assertUsable();
  if (mode === 'blobs') {
    const keys = [];
    for await (const page of blobs.list({ prefix, paginate: true })) {
      for (const blob of page.blobs) keys.push(blob.key);
    }
    return keys;
  }
  const data = await fileLoad();
  return Object.keys(data).filter((k) => k.startsWith(prefix));
}

export function storageMode() {
  return mode || 'unknown';
}
