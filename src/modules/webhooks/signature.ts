import { createHmac, timingSafeEqual } from "node:crypto";

const META_SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/;

export function verifyMetaSignature(
  rawBody: string | Uint8Array,
  signature: string | null | undefined,
  appSecret: string,
): boolean {
  if (!signature || !appSecret) {
    return false;
  }

  const match = META_SIGNATURE_PATTERN.exec(signature);

  if (!match) {
    return false;
  }

  const supplied = Buffer.from(match[1]!, "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();

  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function verifyMetaToken(
  suppliedToken: string | null,
  expectedToken: string | undefined,
): boolean {
  if (!suppliedToken || !expectedToken) {
    return false;
  }

  const supplied = Buffer.from(suppliedToken, "utf8");
  const expected = Buffer.from(expectedToken, "utf8");

  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
