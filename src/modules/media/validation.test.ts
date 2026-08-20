// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  IMAGE_MAX_BYTES,
  DOCUMENT_MAX_BYTES,
  MediaValidationError,
  validateMedia,
} from "./validation";

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pdf = new TextEncoder().encode("%PDF-1.7\n");

describe("media validation", () => {
  it.each([
    ["image/jpeg", "foto.jpg", jpeg],
    ["image/png", "foto.png", png],
    ["audio/aac", "som.aac", Uint8Array.from([0xff, 0xf1, 0x50, 0x80])],
    ["audio/mpeg", "som.mp3", new TextEncoder().encode("ID3\u0004")],
    ["audio/amr", "som.amr", new TextEncoder().encode("#!AMR\n")],
    ["audio/ogg", "som.ogg", new TextEncoder().encode("OggSxxxxOpusHead")],
    ["audio/mp4", "som.m4a", new TextEncoder().encode("....ftypM4A ")],
    ["video/mp4", "video.mp4", new TextEncoder().encode("....ftypisom")],
    ["video/3gpp", "video.3gp", new TextEncoder().encode("....ftyp3gp5")],
    ["application/pdf", "nota.pdf", pdf],
    ["text/plain", "nota.txt", new TextEncoder().encode("texto UTF-8")],
    [
      "application/msword",
      "arquivo.doc",
      Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    ],
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "arquivo.docx",
      Uint8Array.from([0x50, 0x4b, 0x03, 0x04]),
    ],
  ])("accepts allowlisted %s content", (mimeType, filename, bytes) => {
    expect(validateMedia({ mimeType, filename, bytes })).toMatchObject({ mimeType });
  });

  it("accepts an image at the exact byte limit", () => {
    const bytes = new Uint8Array(IMAGE_MAX_BYTES);
    bytes.set(jpeg);
    expect(validateMedia({ mimeType: "image/jpeg", filename: "foto.jpeg", bytes }).sizeBytes)
      .toBe(BigInt(IMAGE_MAX_BYTES));
  });

  it("rejects a document one byte above its exact limit", () => {
    const bytes = new Uint8Array(DOCUMENT_MAX_BYTES + 1);
    bytes.set(pdf);
    expect(() => validateMedia({ mimeType: "application/pdf", filename: "x.pdf", bytes }))
      .toThrow(MediaValidationError);
  });

  it.each([
    { mimeType: "image/jpeg", filename: "x.jpg", bytes: new Uint8Array() },
    { mimeType: "image/gif", filename: "x.gif", bytes: new TextEncoder().encode("GIF89a") },
    { mimeType: "image/jpeg", filename: "x.jpg", bytes: png },
    { mimeType: "application/pdf", filename: "x.pdf", bytes: jpeg },
    { mimeType: "application/pdf", filename: "x.exe", bytes: pdf },
  ])("rejects empty, disallowed or mismatched media %#", (input) => {
    expect(() => validateMedia(input)).toThrow(MediaValidationError);
  });
});
