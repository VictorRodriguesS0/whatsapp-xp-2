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
    });
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
});
