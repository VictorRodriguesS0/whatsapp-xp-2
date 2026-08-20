// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  IMAGE_MAX_BYTES,
  DOCUMENT_MAX_BYTES,
  MediaValidationError,
  validateMedia,
  validateMediaFile,
} from "./validation";

const tempRoots: string[] = [];

function box(type: string, ...payloads: Uint8Array[]): Uint8Array {
  const size = 8 + payloads.reduce((total, payload) => total + payload.byteLength, 0);
  const result = new Uint8Array(size);
  new DataView(result.buffer).setUint32(0, size);
  result.set(new TextEncoder().encode(type), 4);
  let offset = 8;
  for (const payload of payloads) { result.set(payload, offset); offset += payload.byteLength; }
  return result;
}

function minimalMp4(handler: "soun" | "vide", brand: "M4A " | "isom" | "3gp5" = "isom"): Uint8Array {
  const ftyp = box("ftyp", new TextEncoder().encode(`${brand}\0\0\0\0${brand}`));
  const hdlrPayload = new Uint8Array(12);
  hdlrPayload.set(new TextEncoder().encode(handler), 8);
  const moov = box("moov", box("trak", box("mdia", box("hdlr", hdlrPayload))));
  const result = new Uint8Array(ftyp.byteLength + moov.byteLength);
  result.set(ftyp); result.set(moov, ftyp.byteLength);
  return result;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function minimalZip(entries: Record<string, string>): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const nameBytes = new TextEncoder().encode(name);
    const data = new TextEncoder().encode(value);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint32(14, crc32(data), true);
    lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30); local.set(data, 30 + nameBytes.length); locals.push(local);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint32(16, crc32(data), true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true); cv.setUint32(42, offset, true); central.set(nameBytes, 46); centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, centrals.length, true); ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  const all = [...locals, ...centrals, end];
  const result = new Uint8Array(all.reduce((sum, item) => sum + item.length, 0));
  let cursor = 0; for (const item of all) { result.set(item, cursor); cursor += item.length; }
  return result;
}

function minimalOle(streamName: string): Uint8Array {
  const bytes = new Uint8Array(1024).fill(0xff);
  bytes.set(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  const view = new DataView(bytes.buffer);
  view.setUint16(24, 0x003e, true); view.setUint16(26, 0x0003, true); view.setUint16(28, 0xfffe, true);
  view.setUint16(30, 9, true); view.setUint16(32, 6, true); view.setUint32(44, 1, true); view.setUint32(48, 0, true);
  function directoryEntry(offset: number, name: string, type: number) {
    const encoded = Buffer.from(`${name}\0`, "utf16le");
    bytes.set(encoded, offset); view.setUint16(offset + 64, encoded.length, true); bytes[offset + 66] = type;
  }
  directoryEntry(512, "Root Entry", 5);
  directoryEntry(640, streamName, 2);
  return bytes;
}

async function tempFile(name: string, bytes: Uint8Array): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xp-validate-"));
  tempRoots.push(root);
  const path = join(root, name);
  await writeFile(path, bytes);
  return path;
}

afterEach(async () => Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

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
    ["application/pdf", "nota.pdf", pdf],
    ["text/plain", "nota.txt", new TextEncoder().encode("texto UTF-8")],
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

  it.each([
    ["audio/mp4", "x.m4a", new TextEncoder().encode("....ftypM4A ")],
    ["video/mp4", "x.mp4", new TextEncoder().encode("....ftypisom")],
    ["application/msword", "x.doc", Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "x.docx", Uint8Array.from([0x50, 0x4b, 0x03, 0x04])],
  ])("does not accept a generic container as declared %s in the byte compatibility API", (mimeType, filename, bytes) => {
    expect(() => validateMedia({ mimeType, filename, bytes })).toThrow(MediaValidationError);
  });

  it("distinguishes MP4 audio and video using a real track handler instead of generic ftyp", async () => {
    const audioPath = await tempFile("audio.m4a", minimalMp4("soun", "M4A "));
    const videoPath = await tempFile("video.mp4", minimalMp4("vide"));

    await expect(validateMediaFile({ path: audioPath, mimeType: "audio/mp4", filename: "audio.m4a" }))
      .resolves.toMatchObject({ kind: "audio" });
    await expect(validateMediaFile({ path: videoPath, mimeType: "video/mp4", filename: "video.mp4" }))
      .resolves.toMatchObject({ kind: "video" });
    await expect(validateMediaFile({ path: audioPath, mimeType: "video/mp4", filename: "audio.mp4" }))
      .rejects.toBeInstanceOf(MediaValidationError);
    await expect(validateMediaFile({ path: videoPath, mimeType: "audio/mp4", filename: "video.m4a" }))
      .rejects.toBeInstanceOf(MediaValidationError);
  });

  it("rejects a generic ISO-BMFF file with no matching media track", async () => {
    const path = await tempFile("generic.mp4", box("ftyp", new TextEncoder().encode("isom\0\0\0\0isom")));
    await expect(validateMediaFile({ path, mimeType: "video/mp4", filename: "generic.mp4" }))
      .rejects.toBeInstanceOf(MediaValidationError);
  });

  it("requires the declared OpenXML package entries instead of accepting a generic ZIP", async () => {
    const docx = await tempFile("real.docx", minimalZip({
      "[Content_Types].xml": "<Types/>",
      "_rels/.rels": "<Relationships/>",
      "word/document.xml": "<w:document/>",
    }));
    const generic = await tempFile("generic.docx", minimalZip({ "payload.bin": "not office" }));
    await expect(validateMediaFile({ path: docx, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", filename: "real.docx" }))
      .resolves.toMatchObject({ kind: "document" });
    await expect(validateMediaFile({ path: docx, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename: "real.xlsx" }))
      .rejects.toBeInstanceOf(MediaValidationError);
    await expect(validateMediaFile({ path: generic, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", filename: "generic.docx" }))
      .rejects.toBeInstanceOf(MediaValidationError);
  });

  it.each([
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "word/document.xml", "docx"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xl/workbook.xml", "xlsx"],
    ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "ppt/presentation.xml", "pptx"],
  ])("accepts a minimal structurally matching OpenXML package for %s", async (mimeType, entry, extension) => {
    const path = await tempFile(`real.${extension}`, minimalZip({ "[Content_Types].xml": "<Types/>", [entry]: "<root/>" }));
    await expect(validateMediaFile({ path, mimeType, filename: `real.${extension}` })).resolves.toMatchObject({ kind: "document" });
  });

  it("requires the matching legacy Office stream instead of accepting any OLE container", async () => {
    const doc = await tempFile("real.doc", minimalOle("WordDocument"));
    await expect(validateMediaFile({ path: doc, mimeType: "application/msword", filename: "real.doc" }))
      .resolves.toMatchObject({ kind: "document" });
    await expect(validateMediaFile({ path: doc, mimeType: "application/vnd.ms-excel", filename: "real.xls" }))
      .rejects.toBeInstanceOf(MediaValidationError);
  });

  it.each([
    ["application/msword", "WordDocument", "doc"],
    ["application/vnd.ms-excel", "Workbook", "xls"],
    ["application/vnd.ms-powerpoint", "PowerPoint Document", "ppt"],
  ])("accepts a minimal structurally matching legacy Office container for %s", async (mimeType, streamName, extension) => {
    const path = await tempFile(`real.${extension}`, minimalOle(streamName));
    await expect(validateMediaFile({ path, mimeType, filename: `real.${extension}` })).resolves.toMatchObject({ kind: "document" });
  });

  it("accepts 3GPP only with its brand and a video track", async () => {
    const path = await tempFile("real.3gp", minimalMp4("vide", "3gp5"));
    await expect(validateMediaFile({ path, mimeType: "video/3gpp", filename: "real.3gp" })).resolves.toMatchObject({ kind: "video" });
  });
});
