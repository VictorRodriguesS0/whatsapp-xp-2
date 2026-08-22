import { describe, expect, it } from "vitest";

import { isSingleEmoji } from "./emoji";

describe("isSingleEmoji", () => {
  it.each(["👍", "👨🏽‍💻", "❤️", "🇧🇷", "1️⃣"])(
    "accepts one emoji grapheme: %s",
    (emoji) => {
      expect(isSingleEmoji(emoji)).toBe(true);
    },
  );

  it.each(["", " ", "👍👍", "ok", "1", "a", "👍 ok", "\u0000"])(
    "rejects invalid reaction content: %j",
    (value) => {
      expect(isSingleEmoji(value)).toBe(false);
    },
  );

  it("rejects an oversized grapheme", () => {
    expect(isSingleEmoji(`👨${"\u200d👨".repeat(40)}`)).toBe(false);
  });
});
