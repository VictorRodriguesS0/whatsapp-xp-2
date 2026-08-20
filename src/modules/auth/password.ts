import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
const VERSION = "v1";
const N = 32768;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;
const MINIMUM_PASSWORD_LENGTH = 10;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keyLength,
      { N, r: R, p: P, maxmem: MAX_MEMORY },
      (error, key) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(key);
      },
    );
  });
}

function decodeCanonicalBase64Url(
  encoded: string,
  expectedLength: number,
): Buffer | undefined {
  if (!BASE64URL_PATTERN.test(encoded)) {
    return undefined;
  }

  const decoded = Buffer.from(encoded, "base64url");

  if (
    decoded.length !== expectedLength ||
    decoded.toString("base64url") !== encoded
  ) {
    return undefined;
  }

  return decoded;
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    throw new Error("Password must be at least 10 characters long");
  }

  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, KEY_LENGTH);

  return [
    "scrypt",
    VERSION,
    N,
    R,
    P,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const fields = encoded.split("$");

  if (fields.length !== 7) {
    return false;
  }

  const [algorithm, version, rawN, rawR, rawP, encodedSalt, encodedKey] = fields;

  if (
    algorithm !== "scrypt" ||
    version !== VERSION ||
    rawN !== String(N) ||
    rawR !== String(R) ||
    rawP !== String(P) ||
    !encodedSalt ||
    !encodedKey
  ) {
    return false;
  }

  try {
    const salt = decodeCanonicalBase64Url(encodedSalt, 16);
    const expectedKey = decodeCanonicalBase64Url(encodedKey, KEY_LENGTH);

    if (!salt || !expectedKey) {
      return false;
    }

    const actualKey = await deriveKey(password, salt, expectedKey.length);

    return (
      actualKey.length === expectedKey.length &&
      timingSafeEqual(actualKey, expectedKey)
    );
  } catch {
    return false;
  }
}
