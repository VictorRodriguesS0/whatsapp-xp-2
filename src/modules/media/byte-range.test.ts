// @vitest-environment node

import { describe, expect, it } from "vitest";

import { parseSingleByteRange, UnsatisfiableByteRangeError } from "./byte-range";

describe("single HTTP byte range", () => {
  it("returns null when no Range header was sent", () => {
    expect(parseSingleByteRange(null, 10n)).toBeNull();
  });

  it.each([
    ["bytes=0-3", 10n, { start: 0n, end: 3n, length: 4n }],
    ["bytes=4-", 10n, { start: 4n, end: 9n, length: 6n }],
    ["bytes=-4", 10n, { start: 6n, end: 9n, length: 4n }],
    ["bytes=7-99", 10n, { start: 7n, end: 9n, length: 3n }],
    ["bytes=-99", 10n, { start: 0n, end: 9n, length: 10n }],
    ["BYTES=1-1", 10n, { start: 1n, end: 1n, length: 1n }],
  ])("parses %s against a %s-byte representation", (value, size, expected) => {
    expect(parseSingleByteRange(value, size)).toEqual(expected);
  });

  it.each([
    ["bytes=0-1,4-5", 10n],
    ["bytes=5-4", 10n],
    ["bytes=10-", 10n],
    ["bytes=-0", 10n],
    ["bytes=-", 10n],
    ["items=0-1", 10n],
    [" bytes=0-1", 10n],
    ["bytes=0 - 1", 10n],
    ["bytes=0-1 ", 10n],
    ["bytes=0-0", 0n],
  ])("rejects unsatisfiable or malformed range %s", (value, size) => {
    expect(() => parseSingleByteRange(value, size)).toThrow(UnsatisfiableByteRangeError);
  });
});
