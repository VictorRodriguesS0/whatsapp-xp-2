import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { parseMessageContent } from "./content";
import { messageContentForPrisma } from "./content.server";

describe("parseMessageContent", () => {
  it("accepts a bounded location", () => {
    expect(
      parseMessageContent({
        kind: "location",
        latitude: -15.793889,
        longitude: -47.882778,
        name: "XP Eletrônicos",
        address: "Brasília - DF",
      }),
    ).toEqual({
      kind: "location",
      latitude: -15.793889,
      longitude: -47.882778,
      name: "XP Eletrônicos",
      address: "Brasília - DF",
    });
  });

  it.each([
    { kind: "location", latitude: 91, longitude: 0, name: null, address: null },
    { kind: "location", latitude: 0, longitude: -181, name: null, address: null },
    { kind: "contacts", contacts: [] },
    { kind: "interactive", interaction: "button", id: "", title: "Escolher" },
    { kind: "unknown", rawType: "token\\u0000leak" },
  ])("rejects invalid persisted content %#", (value) => {
    expect(parseMessageContent(value)).toBeNull();
  });

  it("maps absent content to the Prisma database null sentinel", () => {
    expect(messageContentForPrisma(null)).toBe(Prisma.DbNull);
  });
});
