import "server-only";

import Busboy from "@fastify/busboy";
import type { BusboyFileStream, BusboyInstance } from "@fastify/busboy";
import { Readable } from "node:stream";

import { HttpError } from "@/lib/http";
import { DOCUMENT_MAX_BYTES } from "./validation";
import { stageMediaStream, type StagedMediaFile } from "./temp-file";

const MULTIPART_OVERHEAD_MAX_BYTES = 1024 * 1024;
export const MULTIPART_REQUEST_MAX_BYTES = DOCUMENT_MAX_BYTES + MULTIPART_OVERHEAD_MAX_BYTES;

export async function parseMediaMultipartRequest(request: Request, root: string): Promise<{
  fields: Record<string, string>;
  file: StagedMediaFile;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || BigInt(contentLength) > BigInt(MULTIPART_REQUEST_MAX_BYTES))) {
    throw new HttpError(413, "Arquivo muito grande");
  }
  if (!request.body) throw new HttpError(400, "Arquivo inválido");

  const fields: Record<string, string> = {};
  let filePromise: Promise<StagedMediaFile> | undefined;
  let parserError: unknown;
  let fileTruncated = false;
  let fileCount = 0;
  let busboy: BusboyInstance;
  try {
    busboy = new Busboy({
      headers: { "content-type": contentType },
      preservePath: true,
      limits: {
        fieldNameSize: 64,
        fieldSize: 4096,
        fields: 3,
        files: 1,
        parts: 4,
        fileSize: DOCUMENT_MAX_BYTES,
        headerPairs: 32,
        headerSize: 8192,
      },
    });
  } catch {
    throw new HttpError(400, "Multipart inválido");
  }

  busboy.on("field", (name: string, value: string, nameTruncated: boolean, valueTruncated: boolean) => {
    if (nameTruncated || valueTruncated || !["type", "clientRequestId", "body"].includes(name)) {
      parserError = new HttpError(400, "Campos multipart inválidos");
      return;
    }
    fields[name] = value;
  });
  busboy.on("file", (name: string, stream: BusboyFileStream, filename: string, _encoding: string, mimeType: string) => {
    fileCount += 1;
    if (name !== "file" || fileCount !== 1 || !filename || !mimeType) {
      parserError = new HttpError(400, "Arquivo inválido");
      stream.resume();
      return;
    }
    stream.once("limit", () => { fileTruncated = true; });
    filePromise = stageMediaStream({
      root,
      filename,
      mimeType,
      maximumBytes: DOCUMENT_MAX_BYTES,
      stream: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
    });
  });
  busboy.on("partsLimit", () => { parserError = new HttpError(400, "Multipart inválido"); });
  busboy.on("filesLimit", () => { parserError = new HttpError(400, "Multipart inválido"); });
  busboy.on("fieldsLimit", () => { parserError = new HttpError(400, "Multipart inválido"); });

  const source = Readable.fromWeb(request.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>);
  const finished = new Promise<void>((resolve, reject) => {
    busboy.once("finish", resolve);
    busboy.once("error", reject);
    source.once("error", reject);
  });
  source.pipe(busboy);

  let file: StagedMediaFile | undefined;
  try {
    await finished;
    if (filePromise) file = await filePromise;
    if (parserError) throw parserError;
    if (!file || fileTruncated || file.sizeBytes === 0n) throw new HttpError(fileTruncated ? 413 : 400, fileTruncated ? "Arquivo muito grande" : "Arquivo inválido");
    return { fields, file };
  } catch (error) {
    source.destroy();
    if (filePromise) await filePromise.then((staged) => staged.cleanup()).catch(() => undefined);
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Multipart inválido");
  }
}
