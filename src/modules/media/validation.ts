import "server-only";

import { createReadStream } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { fileTypeFromFile } from "file-type";

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const AUDIO_MAX_BYTES = 16 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 16 * 1024 * 1024;
export const DOCUMENT_MAX_BYTES = 100 * 1024 * 1024;

type MediaKind = "image" | "audio" | "video" | "document";

type MediaRule = {
  kind: MediaKind;
  maximumBytes: number;
  extensions: readonly string[];
  signature(bytes: Uint8Array): boolean;
};

const detectedMimeAliases: Readonly<Record<string, readonly string[]>> = {
  "image/jpeg": ["image/jpeg"],
  "image/png": ["image/png"],
  "audio/aac": ["audio/aac"],
  "audio/mpeg": ["audio/mpeg"],
  "audio/amr": ["audio/amr"],
  "audio/ogg": ["audio/opus", "audio/ogg"],
  "audio/opus": ["audio/opus", "audio/ogg"],
  "application/pdf": ["application/pdf"],
  "application/msword": ["application/msword"],
  "application/vnd.ms-excel": ["application/vnd.ms-excel"],
  "application/vnd.ms-powerpoint": ["application/vnd.ms-powerpoint"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
};

const prefix = (expected: readonly number[]) => (bytes: Uint8Array) =>
  expected.every((value, index) => bytes[index] === value);
const asciiPrefix = (expected: string) => (bytes: Uint8Array) =>
  prefix([...Buffer.from(expected, "ascii")])(bytes);
const containsAscii = (expected: string, maximum = 64) => (bytes: Uint8Array) =>
  Buffer.from(bytes.subarray(0, maximum)).includes(Buffer.from(expected, "ascii"));
const isIsoBaseMedia = (bytes: Uint8Array) =>
  bytes.byteLength >= 12 && Buffer.from(bytes.subarray(4, 8)).toString("ascii") === "ftyp";
const isUtf8Text = (bytes: Uint8Array) => {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
};
const isOle = prefix([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const isZip = prefix([0x50, 0x4b, 0x03, 0x04]);

const rules: Readonly<Record<string, MediaRule>> = {
  "image/jpeg": { kind: "image", maximumBytes: IMAGE_MAX_BYTES, extensions: [".jpg", ".jpeg"], signature: prefix([0xff, 0xd8, 0xff]) },
  "image/png": { kind: "image", maximumBytes: IMAGE_MAX_BYTES, extensions: [".png"], signature: prefix([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  "audio/aac": { kind: "audio", maximumBytes: AUDIO_MAX_BYTES, extensions: [".aac"], signature: (bytes) => bytes[0] === 0xff && (bytes[1]! & 0xf6) === 0xf0 },
  "audio/mp4": { kind: "audio", maximumBytes: AUDIO_MAX_BYTES, extensions: [".m4a", ".mp4"], signature: isIsoBaseMedia },
  "audio/mpeg": { kind: "audio", maximumBytes: AUDIO_MAX_BYTES, extensions: [".mp3"], signature: (bytes) => asciiPrefix("ID3")(bytes) || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) },
  "audio/amr": { kind: "audio", maximumBytes: AUDIO_MAX_BYTES, extensions: [".amr"], signature: (bytes) => asciiPrefix("#!AMR\n")(bytes) || asciiPrefix("#!AMR-WB\n")(bytes) },
  "audio/ogg": { kind: "audio", maximumBytes: AUDIO_MAX_BYTES, extensions: [".ogg", ".opus"], signature: (bytes) => asciiPrefix("OggS")(bytes) && containsAscii("OpusHead")(bytes) },
  "audio/opus": { kind: "audio", maximumBytes: AUDIO_MAX_BYTES, extensions: [".opus", ".ogg"], signature: (bytes) => asciiPrefix("OggS")(bytes) && containsAscii("OpusHead")(bytes) },
  "video/mp4": { kind: "video", maximumBytes: VIDEO_MAX_BYTES, extensions: [".mp4"], signature: isIsoBaseMedia },
  "video/3gpp": { kind: "video", maximumBytes: VIDEO_MAX_BYTES, extensions: [".3gp", ".3gpp"], signature: (bytes) => isIsoBaseMedia(bytes) && containsAscii("3gp", 16)(bytes) },
  "application/pdf": { kind: "document", maximumBytes: DOCUMENT_MAX_BYTES, extensions: [".pdf"], signature: asciiPrefix("%PDF-") },
  "text/plain": { kind: "document", maximumBytes: DOCUMENT_MAX_BYTES, extensions: [".txt"], signature: isUtf8Text },
  "application/msword": { kind: "document", maximumBytes: DOCUMENT_MAX_BYTES, extensions: [".doc"], signature: isOle },
  "application/vnd.ms-excel": { kind: "document", maximumBytes: DOCUMENT_MAX_BYTES, extensions: [".xls"], signature: isOle },
  "application/vnd.ms-powerpoint": { kind: "document", maximumBytes: DOCUMENT_MAX_BYTES, extensions: [".ppt"], signature: isOle },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { kind: "document", maximumBytes: DOCUMENT_MAX_BYTES, extensions: [".docx"], signature: isZip },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { kind: "document", maximumBytes: DOCUMENT_MAX_BYTES, extensions: [".xlsx"], signature: isZip },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { kind: "document", maximumBytes: DOCUMENT_MAX_BYTES, extensions: [".pptx"], signature: isZip },
};

export class MediaValidationError extends Error {
  constructor(message = "Mídia inválida") {
    super(message);
    this.name = "MediaValidationError";
  }
}

export type ValidatedMedia = {
  mimeType: string;
  kind: MediaKind;
  maximumBytes: number;
  sizeBytes: bigint;
};

export function mediaRuleForMime(mimeType: string): Omit<ValidatedMedia, "sizeBytes"> {
  const normalized = mimeType.trim().toLowerCase();
  const rule = rules[normalized];
  if (!rule) throw new MediaValidationError("Tipo de mídia não permitido");
  return { mimeType: normalized, kind: rule.kind, maximumBytes: rule.maximumBytes };
}

export function validateMedia(input: {
  mimeType: string;
  filename?: string | null;
  bytes: Uint8Array;
}): ValidatedMedia {
  const normalized = input.mimeType.trim().toLowerCase();
  const rule = rules[normalized];
  if (!rule) throw new MediaValidationError("Tipo de mídia não permitido");
  if (input.bytes.byteLength === 0) throw new MediaValidationError("Arquivo vazio");
  if (input.bytes.byteLength > rule.maximumBytes) throw new MediaValidationError("Arquivo muito grande");
  if (input.filename) {
    const extension = extname(input.filename).toLowerCase();
    if (!rule.extensions.includes(extension)) throw new MediaValidationError("Extensão incompatível");
  }
  const requiresFileStructure = normalized in openXmlEntryByMime || normalized in oleStreamByMime;
  if (requiresFileStructure) throw new MediaValidationError("Validação estrutural de arquivo obrigatória");
  const contentMatches = normalized === "audio/mp4" || normalized === "video/mp4" || normalized === "video/3gpp"
    ? hasCompatibleMp4Brand(input.bytes, normalized) && mp4BoxPayload(input.bytes, normalized === "audio/mp4" ? "soun" : "vide")
    : rule.signature(input.bytes);
  if (!contentMatches) throw new MediaValidationError("Conteúdo incompatível com o tipo declarado");
  return {
    mimeType: normalized,
    kind: rule.kind,
    maximumBytes: rule.maximumBytes,
    sizeBytes: BigInt(input.bytes.byteLength),
  };
}

function mp4BoxPayload(bytes: Uint8Array, expectedHandler: "soun" | "vide"): boolean {
  const containers = new Set(["moov", "trak", "mdia"]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  function walk(start: number, end: number): boolean {
    let offset = start;
    while (offset + 8 <= end) {
      let size = view.getUint32(offset);
      const type = Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString("ascii");
      let headerSize = 8;
      if (size === 1) {
        if (offset + 16 > end) return false;
        const large = view.getBigUint64(offset + 8);
        if (large > BigInt(Number.MAX_SAFE_INTEGER)) return false;
        size = Number(large);
        headerSize = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < headerSize || offset + size > end) return false;
      const payloadStart = offset + headerSize;
      const boxEnd = offset + size;
      if (type === "hdlr" && payloadStart + 12 <= boxEnd) {
        const handler = Buffer.from(bytes.subarray(payloadStart + 8, payloadStart + 12)).toString("ascii");
        if (handler === expectedHandler) return true;
      }
      if (containers.has(type) && walk(payloadStart, boxEnd)) return true;
      offset = boxEnd;
    }
    return false;
  }

  return walk(0, bytes.byteLength);
}

function hasCompatibleMp4Brand(bytes: Uint8Array, mimeType: string): boolean {
  if (bytes.byteLength < 16 || Buffer.from(bytes.subarray(4, 8)).toString("ascii") !== "ftyp") return false;
  const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (boxSize < 16 || boxSize > bytes.byteLength) return false;
  const brands: string[] = [];
  brands.push(Buffer.from(bytes.subarray(8, 12)).toString("ascii"));
  for (let offset = 16; offset + 4 <= boxSize; offset += 4) {
    brands.push(Buffer.from(bytes.subarray(offset, offset + 4)).toString("ascii"));
  }
  if (mimeType === "audio/mp4") return brands.some((brand) => ["M4A ", "M4B ", "mp41", "mp42", "isom"].includes(brand));
  if (mimeType === "video/3gpp") return brands.some((brand) => brand.toLowerCase().startsWith("3gp"));
  return brands.some((brand) => ["isom", "iso2", "avc1", "mp41", "mp42"].includes(brand));
}

async function isValidUtf8TextFile(path: string): Promise<boolean> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024 })) {
      const bytes = chunk as Buffer;
      if (bytes.includes(0)) return false;
      decoder.decode(bytes, { stream: true });
    }
    decoder.decode();
    return true;
  } catch {
    return false;
  }
}

const openXmlEntryByMime: Readonly<Record<string, string>> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "word/document.xml",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xl/workbook.xml",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "ppt/presentation.xml",
};

async function hasOpenXmlEntries(path: string, size: number, requiredEntry: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const tailSize = Math.min(size, 65_557);
    const tail = new Uint8Array(tailSize);
    await handle.read(tail, 0, tailSize, size - tailSize);
    const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let endOffset = -1;
    for (let offset = tailSize - 22; offset >= 0; offset -= 1) {
      if (tailView.getUint32(offset, true) === 0x06054b50) { endOffset = offset; break; }
    }
    if (endOffset < 0) return false;
    const entryCount = tailView.getUint16(endOffset + 10, true);
    const centralSize = tailView.getUint32(endOffset + 12, true);
    const centralOffset = tailView.getUint32(endOffset + 16, true);
    if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff || entryCount > 10_000 || centralSize > 8 * 1024 * 1024 || centralOffset + centralSize > size) return false;
    const central = new Uint8Array(centralSize);
    await handle.read(central, 0, centralSize, centralOffset);
    const view = new DataView(central.buffer, central.byteOffset, central.byteLength);
    const names = new Set<string>();
    let offset = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > central.length || view.getUint32(offset, true) !== 0x02014b50) return false;
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const next = offset + 46 + nameLength + extraLength + commentLength;
      if (next > central.length) return false;
      names.add(new TextDecoder("utf-8", { fatal: true }).decode(central.subarray(offset + 46, offset + 46 + nameLength)).replaceAll("\\", "/"));
      offset = next;
    }
    return names.has("[Content_Types].xml") && names.has(requiredEntry);
  } catch {
    return false;
  } finally {
    await handle.close();
  }
}

const oleStreamByMime: Readonly<Record<string, readonly string[]>> = {
  "application/msword": ["WordDocument"],
  "application/vnd.ms-excel": ["Workbook", "Book"],
  "application/vnd.ms-powerpoint": ["PowerPoint Document"],
};

async function hasOleStream(path: string, size: number, expectedNames: readonly string[]): Promise<boolean> {
  if (size < 1024) return false;
  const handle = await open(path, "r");
  try {
    const header = new Uint8Array(512);
    await handle.read(header, 0, 512, 0);
    if (!isOle(header)) return false;
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    if (view.getUint16(28, true) !== 0xfffe) return false;
    const sectorShift = view.getUint16(30, true);
    if (sectorShift !== 9 && sectorShift !== 12) return false;
    const sectorSize = 2 ** sectorShift;
    const directorySector = view.getUint32(48, true);
    const directoryOffset = (directorySector + 1) * sectorSize;
    if (directorySector >= 0xfffffffa || directoryOffset + sectorSize > size) return false;
    const directory = new Uint8Array(sectorSize);
    await handle.read(directory, 0, sectorSize, directoryOffset);
    const directoryView = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
    for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
      const nameLength = directoryView.getUint16(offset + 64, true);
      const type = directory[offset + 66];
      if ((type !== 1 && type !== 2 && type !== 5) || nameLength < 2 || nameLength > 64 || nameLength % 2 !== 0) continue;
      const name = Buffer.from(directory.subarray(offset, offset + nameLength - 2)).toString("utf16le");
      if (expectedNames.includes(name)) return true;
    }
    return false;
  } finally {
    await handle.close();
  }
}

export async function validateMediaFile(input: {
  path: string;
  mimeType: string;
  filename?: string | null;
}): Promise<ValidatedMedia> {
  const normalized = input.mimeType.trim().toLowerCase();
  const rule = rules[normalized];
  if (!rule) throw new MediaValidationError("Tipo de mídia não permitido");
  const fileStat = await stat(input.path);
  if (!fileStat.isFile() || fileStat.size === 0) throw new MediaValidationError("Arquivo vazio");
  if (fileStat.size > rule.maximumBytes) throw new MediaValidationError("Arquivo muito grande");
  if (input.filename) {
    const extension = extname(input.filename).toLowerCase();
    if (!rule.extensions.includes(extension)) throw new MediaValidationError("Extensão incompatível");
  }

  let contentMatches = false;
  if (normalized === "text/plain") {
    contentMatches = await isValidUtf8TextFile(input.path);
  } else if (normalized === "audio/mp4" || normalized === "video/mp4" || normalized === "video/3gpp") {
    const bytes = new Uint8Array(await readFile(input.path));
    contentMatches = hasCompatibleMp4Brand(bytes, normalized) && mp4BoxPayload(bytes, normalized === "audio/mp4" ? "soun" : "vide");
  } else if (openXmlEntryByMime[normalized]) {
    contentMatches = await hasOpenXmlEntries(input.path, fileStat.size, openXmlEntryByMime[normalized]);
  } else if (oleStreamByMime[normalized]) {
    contentMatches = await hasOleStream(input.path, fileStat.size, oleStreamByMime[normalized]);
  } else {
    const detected = await fileTypeFromFile(input.path);
    contentMatches = Boolean(detected && detectedMimeAliases[normalized]?.includes(detected.mime));
  }
  if (!contentMatches) throw new MediaValidationError("Conteúdo incompatível com o tipo declarado");
  return { mimeType: normalized, kind: rule.kind, maximumBytes: rule.maximumBytes, sizeBytes: BigInt(fileStat.size) };
}
