import "server-only";

import { extname } from "node:path";

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
  if (!rule.signature(input.bytes)) throw new MediaValidationError("Conteúdo incompatível com o tipo declarado");
  return {
    mimeType: normalized,
    kind: rule.kind,
    maximumBytes: rule.maximumBytes,
    sizeBytes: BigInt(input.bytes.byteLength),
  };
}
