import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password";

async function encodedWithNonUrlBase64(fieldIndex: number): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const fields = (await hashPassword("Senha-Demo-2026!")).split("$");
    const standardBase64 = Buffer.from(fields[fieldIndex]!, "base64url")
      .toString("base64")
      .replace(/=+$/, "");

    if (/[+/]/.test(standardBase64)) {
      fields[fieldIndex] = standardBase64;
      return fields.join("$");
    }
  }

  throw new Error("Could not create a non-base64url test fixture");
}

describe("password storage", () => {
  it("verifies the original password", async () => {
    const encoded = await hashPassword("Senha-Demo-2026!");

    expect(encoded).toMatch(/^scrypt\$v1\$32768\$8\$1\$[^$]+\$[^$]+$/);
    expect(await verifyPassword("Senha-Demo-2026!", encoded)).toBe(true);
  });

  it("rejects a changed password", async () => {
    const encoded = await hashPassword("Senha-Demo-2026!");

    expect(await verifyPassword("outra", encoded)).toBe(false);
  });

  it("rejects passwords shorter than ten characters", async () => {
    await expect(hashPassword("curta")).rejects.toThrow(
      "Password must be at least 10 characters long",
    );
  });

  it("rejects an unsupported stored password format", async () => {
    expect(await verifyPassword("Senha-Demo-2026!", "scrypt$v2$invalid")).toBe(false);
  });

  it("rejects trailing fields in the stored password format", async () => {
    const encoded = await hashPassword("Senha-Demo-2026!");

    expect(await verifyPassword("Senha-Demo-2026!", `${encoded}$extra`)).toBe(
      false,
    );
  });

  it("rejects an invalid stored key length before deriving a key", async () => {
    const encoded = await hashPassword("Senha-Demo-2026!");
    const fields = encoded.split("$");
    fields[6] = Buffer.alloc(1).toString("base64url");

    expect(await verifyPassword("Senha-Demo-2026!", fields.join("$"))).toBe(
      false,
    );
  });

  it.each([
    { field: "salt", index: 5 },
    { field: "key", index: 6 },
  ])("rejects invalid characters in the encoded $field", async ({ index }) => {
    const encoded = await encodedWithNonUrlBase64(index);

    expect(await verifyPassword("Senha-Demo-2026!", encoded)).toBe(false);
  });

  it.each([
    { field: "salt", index: 5 },
    { field: "key", index: 6 },
  ])("rejects padding in the encoded $field", async ({ index }) => {
    const encoded = await hashPassword("Senha-Demo-2026!");
    const fields = encoded.split("$");
    fields[index] = `${fields[index]}=`;

    expect(await verifyPassword("Senha-Demo-2026!", fields.join("$"))).toBe(
      false,
    );
  });
});
