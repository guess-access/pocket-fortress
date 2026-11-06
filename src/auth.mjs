// Password hashing (scrypt) and session token helpers.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

const PARAMS = { N: 16384, r: 8, p: 1 };

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, KEYLEN, { ...PARAMS, maxmem: MAXMEM });
  return {
    salt,
    hash: derived.toString('hex'),
    params: `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}`,
  };
}

export async function verifyPassword(password, record) {
  if (!record || !record.salt || !record.hash) return false;
  const [, n, r, p] = String(record.params || `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}`).split('$');
  let derived;
  try {
    derived = await scryptAsync(password, record.salt, KEYLEN, {
      N: Number(n) || PARAMS.N,
      r: Number(r) || PARAMS.r,
      p: Number(p) || PARAMS.p,
      maxmem: MAXMEM,
    });
  } catch {
    return false;
  }
  const a = Buffer.from(record.hash, 'hex');
  const b = Buffer.from(derived, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// A throwaway hash so login timing does not reveal whether a username exists.
export const DUMMY_PASSWORD_RECORD = {
  salt: randomBytes(16).toString('hex'),
  hash: randomBytes(64).toString('hex'),
  params: `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}`,
};

export const newToken = () => randomBytes(32).toString('hex');
export const newId = () => randomBytes(12).toString('hex');
