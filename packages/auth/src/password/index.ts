// EXEC-SEC-001 & EXEC-SEC-002: Password Credential Verification (node:crypto scrypt)
import crypto from 'node:crypto';

const SALT_BYTES = 16;
const KEY_BYTES = 64;

export function hashPassword(plaintext: string): string {
  if (typeof plaintext !== 'string' || plaintext.length < 8) {
    throw new Error('Password must be a string of at least 8 characters.');
  }
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const derived = crypto.scryptSync(plaintext, salt, KEY_BYTES).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(plaintext: string, encodedHash: string): boolean {
  if (!plaintext || !encodedHash || typeof encodedHash !== 'string') {
    return false;
  }
  const parts = encodedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const salt = parts[1];
  const storedHex = parts[2];
  try {
    const candidateBuf = crypto.scryptSync(plaintext, salt, KEY_BYTES);
    const storedBuf = Buffer.from(storedHex, 'hex');
    if (candidateBuf.length !== storedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(candidateBuf, storedBuf);
  } catch {
    return false;
  }
}
