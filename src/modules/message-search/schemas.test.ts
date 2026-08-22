import { describe, expect, it } from "vitest";

import { messageSearchSchema } from "./schemas";

describe("messageSearchSchema", () => {
  it("trims valid input and applies the default page size", () => {
    expect(messageSearchSchema.parse({ query: " pix " })).toEqual({
      query: "pix",
      take: 20,
    });
  });

  it("rejects one-character, oversized, and duplicate scalar input", () => {
    expect(() => messageSearchSchema.parse({ query: "/" })).toThrow();
    expect(() => messageSearchSchema.parse({ query: "x".repeat(121) })).toThrow();
    expect(() => messageSearchSchema.parse({ query: ["pix", "endereço"] })).toThrow();
  });

  it("accepts a bounded page size and opaque cursor", () => {
    expect(messageSearchSchema.parse({ query: "produto", take: "30", cursor: "abc" }))
      .toEqual({ query: "produto", take: 30, cursor: "abc" });
    expect(() => messageSearchSchema.parse({ query: "produto", take: "51" })).toThrow();
  });
});
