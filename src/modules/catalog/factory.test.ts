import { describe, expect, it, vi } from "vitest";

import { parseServerEnv } from "@/lib/env";

import { createCatalogServiceFromEnv } from "./factory";

const validBase = {
  DATABASE_URL: "postgresql://xp:password@localhost:5432/xp_atendimento",
  AUTH_SECRET: "a-very-long-secret-used-only-for-test",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};

describe("catalog service factory", () => {
  it("does not construct a Graph client when the catalog is absent", async () => {
    const clientFactory = vi.fn();
    const service = createCatalogServiceFromEnv(parseServerEnv(validBase), {
      clientFactory,
    });

    expect(clientFactory).not.toHaveBeenCalled();
    await expect(
      service.getStatus({
        id: "00000000-0000-4000-8000-000000000001",
        name: "Victor",
        email: "victor@example.test",
        role: "ADMIN",
      }),
    ).resolves.toMatchObject({ configured: false });
  });

  it("constructs the client only with complete server-side Meta config", () => {
    const graphClient = {
      getCatalogSummary: vi.fn(),
      listProducts: vi.fn(),
      getProductsByRetailerIds: vi.fn(),
      getCommerceSettings: vi.fn(),
    };
    const clientFactory = vi.fn().mockReturnValue(graphClient);
    createCatalogServiceFromEnv(
      parseServerEnv({
        ...validBase,
        WHATSAPP_PROVIDER: "meta",
        META_APP_ID: "app-id",
        META_APP_SECRET: "app-secret",
        WHATSAPP_PHONE_NUMBER_ID: "987654321098765",
        WHATSAPP_BUSINESS_ACCOUNT_ID: "111111111111111",
        WHATSAPP_CATALOG_ID: "123456789012345",
        WHATSAPP_ACCESS_TOKEN: "private-token",
        WHATSAPP_VERIFY_TOKEN: "verify-token",
      }),
      { clientFactory },
    );

    expect(clientFactory).toHaveBeenCalledWith({
      graphVersion: "v23.0",
      catalogId: "123456789012345",
      phoneNumberId: "987654321098765",
      accessToken: "private-token",
      timeoutMs: 15_000,
    });
  });
});
