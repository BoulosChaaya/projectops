// EXEC-SEC-034..036: AES-256-GCM Field-Level Encryption & Key Rotation
import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

export class FieldEncryptionKeyring {
  private activeKeyId: string;
  private readonly keys = new Map<string, Buffer>();

  constructor(initialKeyId: string, initialKeyMaterial: Buffer) {
    if (initialKeyMaterial.byteLength !== 32) {
      throw new Error('AES-256-GCM requires a 32-byte key.');
    }
    this.activeKeyId = initialKeyId;
    this.keys.set(initialKeyId, Buffer.from(initialKeyMaterial));
  }

  public addKeyAndActivate(newKeyId: string, newKeyMaterial: Buffer): void {
    if (newKeyMaterial.byteLength !== 32) {
      throw new Error('AES-256-GCM requires a 32-byte key.');
    }
    this.keys.set(newKeyId, Buffer.from(newKeyMaterial));
    this.activeKeyId = newKeyId;
  }

  public encryptField(plaintext: string, aadContext = ''): string {
    const key = this.keys.get(this.activeKeyId)!;
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    if (aadContext) {
      cipher.setAAD(Buffer.from(aadContext, 'utf8'));
    }
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `v1:${this.activeKeyId}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  public decryptField(envelope: string, aadContext = ''): { plaintext: string; keyId: string } {
    const parts = envelope.split(':');
    if (parts.length !== 5 || parts[0] !== 'v1') {
      throw new Error('Invalid encrypted field envelope format.');
    }
    const keyId = parts[1];
    const ivHex = parts[2];
    const tagHex = parts[3];
    const cipherHex = parts[4];
    const key = this.keys.get(keyId);
    if (!key) {
      throw new Error(`Unknown encryption keyId ${keyId}.`);
    }
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    if (aadContext) {
      decipher.setAAD(Buffer.from(aadContext, 'utf8'));
    }
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(cipherHex, 'hex')),
      decipher.final(),
    ]);
    return Object.freeze({ plaintext: decrypted.toString('utf8'), keyId });
  }

  public rotateCiphertext(envelope: string, aadContext = ''): string {
    const dec = this.decryptField(envelope, aadContext);
    return this.encryptField(dec.plaintext, aadContext);
  }
}
