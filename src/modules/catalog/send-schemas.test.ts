import { describe, expect, it } from "vitest";

import { catalogSendInputSchema } from "./send-schemas";

const requestId = "50000000-0000-4000-8000-000000000001";

describe("catalog send input schema", () => {
  it.each([
    { clientRequestId: requestId, kind: "PRODUCT", retailerIds: ["XP-1"] },
    { clientRequestId: requestId, kind: "PRODUCT_LIST", retailerIds: ["XP-1", "XP-2"] },
    { clientRequestId: requestId, kind: "CATALOG" },
  ])("accepts the minimal browser contract %#", (input) => {
    expect(catalogSendInputSchema.parse(input)).toEqual(input);
  });

  it.each([
    { clientRequestId: "not-a-uuid", kind: "CATALOG" },
    { clientRequestId: requestId, kind: "PRODUCT" },
    { clientRequestId: requestId, kind: "PRODUCT", retailerIds: ["XP-1", "XP-2"] },
    { clientRequestId: requestId, kind: "PRODUCT_LIST", retailerIds: [] },
    { clientRequestId: requestId, kind: "PRODUCT_LIST", retailerIds: ["XP-1", "XP-1"] },
    { clientRequestId: requestId, kind: "PRODUCT_LIST", retailerIds: Array.from({ length: 31 }, (_, index) => `XP-${index}`) },
    { clientRequestId: requestId, kind: "CATALOG", retailerIds: [] },
    { clientRequestId: requestId, kind: "PRODUCT", retailerIds: ["unsafe id"] },
    { clientRequestId: requestId, kind: "PRODUCT", retailerIds: ["XP-1"], catalogId: "123" },
    { clientRequestId: requestId, kind: "PRODUCT", retailerIds: ["XP-1"], price: "R$ 1" },
    { clientRequestId: requestId, kind: "PRODUCT", retailerIds: ["XP-1"], imageUrl: "https://evil.test/x" },
    { clientRequestId: requestId, kind: "PRODUCT", retailerIds: ["XP-1"], interactive: {} },
  ])("rejects forged or invalid browser input %#", (input) => {
    expect(catalogSendInputSchema.safeParse(input).success).toBe(false);
  });
});
