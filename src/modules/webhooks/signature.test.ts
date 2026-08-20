// @vitest-environment node

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyMetaSignature } from "./signature";

const body = JSON.stringify({ object: "whatsapp_business_account" });

function sign(rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

describe("Meta webhook signature", () => {
  it("accepts the HMAC SHA-256 of the exact raw body", () => {
    expect(verifyMetaSignature(body, sign(body, "correct"), "correct")).toBe(true);
    expect(verifyMetaSignature(`${body} `, sign(body, "correct"), "correct")).toBe(
      false,
    );
  });

  it("rejects a signature created with another secret", () => {
    expect(verifyMetaSignature(body, sign(body, "wrong"), "correct")).toBe(false);
  });

  it.each([
    undefined,
    "",
    "md5=0123456789abcdef",
    "SHA256=0123456789abcdef",
    "sha256=abc",
    `sha256=${"g".repeat(64)}`,
    `sha256=${"0".repeat(66)}`,
  ])("rejects a missing or malformed signature without throwing: %s", (signature) => {
    expect(() => verifyMetaSignature(body, signature, "correct")).not.toThrow();
    expect(verifyMetaSignature(body, signature, "correct")).toBe(false);
  });
});
