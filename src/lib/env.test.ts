import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseServerEnv } from "./env";

const validBase = {
  DATABASE_URL: "postgresql://xp:password@localhost:5432/xp_atendimento",
  AUTH_SECRET: "a-very-long-secret-used-only-for-test",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};

describe("parseServerEnv", () => {
  it("accepts demo mode without Meta credentials", () => {
    expect(parseServerEnv(validBase)).toMatchObject({
      WHATSAPP_PROVIDER: "demo",
      META_HTTP_TIMEOUT_MS: 15_000,
    });
  });

  it("accepts a bounded configurable total Meta timeout", () => {
    expect(parseServerEnv({ ...validBase, META_HTTP_TIMEOUT_MS: "2500" }).META_HTTP_TIMEOUT_MS).toBe(2500);
    expect(() => parseServerEnv({ ...validBase, META_HTTP_TIMEOUT_MS: "50" })).toThrow();
    expect(() => parseServerEnv({ ...validBase, META_HTTP_TIMEOUT_MS: "60001" })).toThrow();
  });

  it.each([
    "META_APP_ID",
    "META_APP_SECRET",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_BUSINESS_ACCOUNT_ID",
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_VERIFY_TOKEN",
  ])("requires %s in meta mode", (field) => {
    expect(() =>
      parseServerEnv({ ...validBase, WHATSAPP_PROVIDER: "meta" }),
    ).toThrow(new RegExp(field));
  });

  it("accepts meta mode when every Meta credential is configured", () => {
    expect(
      parseServerEnv({
        ...validBase,
        WHATSAPP_PROVIDER: "meta",
        META_APP_ID: "app-id",
        META_APP_SECRET: "app-secret",
        WHATSAPP_PHONE_NUMBER_ID: "phone-number-id",
        WHATSAPP_BUSINESS_ACCOUNT_ID: "business-account-id",
        WHATSAPP_ACCESS_TOKEN: "access-token",
        WHATSAPP_VERIFY_TOKEN: "verify-token",
      }),
    ).toMatchObject({ WHATSAPP_PROVIDER: "meta" });
  });

  it("keeps the catalog optional when the Meta provider is enabled", () => {
    expect(
      parseServerEnv({
        ...validBase,
        WHATSAPP_PROVIDER: "meta",
        META_APP_ID: "app-id",
        META_APP_SECRET: "app-secret",
        WHATSAPP_PHONE_NUMBER_ID: "phone-number-id",
        WHATSAPP_BUSINESS_ACCOUNT_ID: "business-account-id",
        WHATSAPP_ACCESS_TOKEN: "access-token",
        WHATSAPP_VERIFY_TOKEN: "verify-token",
      }).WHATSAPP_CATALOG_ID,
    ).toBeUndefined();
  });

  it.each(["", "   "])(
    "normalizes an empty catalog value emitted by Compose as unconfigured",
    (catalogId) => {
      expect(
        parseServerEnv({
          ...validBase,
          WHATSAPP_CATALOG_ID: catalogId,
        }).WHATSAPP_CATALOG_ID,
      ).toBeUndefined();
    },
  );

  it("accepts a bounded numeric server-only catalog id", () => {
    expect(
      parseServerEnv({
        ...validBase,
        WHATSAPP_CATALOG_ID: " 123456789012345 ",
      }).WHATSAPP_CATALOG_ID,
    ).toBe("123456789012345");
  });

  it.each(["catalog-xp", "123\u0000", "1".repeat(65)])(
    "rejects an invalid catalog id %#",
    (catalogId) => {
      expect(() =>
        parseServerEnv({
          ...validBase,
          WHATSAPP_CATALOG_ID: catalogId,
        }),
      ).toThrow();
    },
  );

  it("does not expose a public catalog environment field", () => {
    const parsed = parseServerEnv({
      ...validBase,
      NEXT_PUBLIC_WHATSAPP_CATALOG_ID: "123456789012345",
    });

    expect(parsed).not.toHaveProperty("NEXT_PUBLIC_WHATSAPP_CATALOG_ID");
  });
});
