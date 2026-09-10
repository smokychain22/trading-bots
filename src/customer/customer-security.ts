import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export const randomOpaqueToken = (): string => randomBytes(32).toString("base64url");

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 200) {
    throw new Error("PASSWORD_LENGTH_INVALID");
  }
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt-v1$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [version, saltValue, hashValue] = stored.split("$");
  if (version !== "scrypt-v1" || !saltValue || !hashValue) return false;
  try {
    const salt = Buffer.from(saltValue, "base64url");
    const expected = Buffer.from(hashValue, "base64url");
    const actual = (await scrypt(password, salt, expected.length)) as Buffer;
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export type EncryptedSecret = {
  readonly ciphertext: Buffer;
  readonly iv: Buffer;
  readonly authTag: Buffer;
};

export function parseEncryptionKey(value: string): Buffer {
  const key = /^[a-f0-9]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY_INVALID");
  return key;
}

export function encryptSecret(
  plaintext: string,
  keyValue: string,
  customerId: string,
): EncryptedSecret {
  const key = parseEncryptionKey(keyValue);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(customerId));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

export function decryptSecret(
  secret: EncryptedSecret,
  keyValue: string,
  customerId: string,
): string {
  const key = parseEncryptionKey(keyValue);
  const decipher = createDecipheriv("aes-256-gcm", key, secret.iv);
  decipher.setAAD(Buffer.from(customerId));
  decipher.setAuthTag(secret.authTag);
  return Buffer.concat([
    decipher.update(secret.ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

