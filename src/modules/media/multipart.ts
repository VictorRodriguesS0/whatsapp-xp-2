import "server-only";

import Busboy from "@fastify/busboy";
import type { BusboyFileStream, BusboyInstance } from "@fastify/busboy";
import { Readable, Transform } from "node:stream";

import { HttpError } from "@/lib/http";
import { DOCUMENT_MAX_BYTES } from "./validation";
import { stageMediaStream, type StagedMediaFile } from "./temp-file";

const MULTIPART_OVERHEAD_MAX_BYTES = 1024 * 1024;
export const MULTIPART_REQUEST_MAX_BYTES = DOCUMENT_MAX_BYTES + MULTIPART_OVERHEAD_MAX_BYTES;

type StagingOutcome =
  | { status: "fulfilled"; file: StagedMediaFile }
  | { status: "rejected"; error: unknown };

export type MultipartFileRequestInput = {
  request: Request;
  root: string;
  maximumFileBytes: number;
  maximumRequestBytes: number;
  allowedFields: readonly string[];
};

export async function parseMultipartFileRequest(input: MultipartFileRequestInput): Promise<{
  fields: Record<string, string>;
  file: StagedMediaFile;
}> {
  const { request, root, maximumFileBytes, maximumRequestBytes, allowedFields } = input;
  const contentType = request.headers.get("content-type") ?? "";
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || BigInt(contentLength) > BigInt(maximumRequestBytes))) {
    throw new HttpError(413, "Arquivo muito grande");
  }
  if (!request.body) throw new HttpError(400, "Arquivo inválido");

  let busboy: BusboyInstance;
  try {
    busboy = new Busboy({
      headers: { "content-type": contentType },
      preservePath: true,
      limits: {
        fieldNameSize: 64,
        fieldSize: 4096,
        fields: allowedFields.length,
        files: 1,
        parts: allowedFields.length + 1,
        fileSize: maximumFileBytes,
        headerPairs: 32,
        headerSize: 8192,
      },
    });
  } catch {
    throw new HttpError(400, "Multipart inválido");
  }

  const source = Readable.fromWeb(request.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>);
  let parserError: unknown;
  let filePromise: Promise<StagingOutcome> | undefined;
  let activeFileStream: BusboyFileStream | undefined;
  let fileTruncated = false;
  let fileCount = 0;
  const fields: Record<string, string> = {};
  let seenBytes = 0;

  const abort = (error: unknown, options: { skipBusboy?: boolean } = {}) => {
    parserError ??= error;
    const reason = error instanceof Error ? error : new Error("Multipart inválido");
    if (activeFileStream && !activeFileStream.destroyed) activeFileStream.destroy(reason);
    if (!source.destroyed) source.destroy(reason);
    if (!boundedSource.destroyed) boundedSource.destroy(reason);
    if (!options.skipBusboy && !busboy.destroyed) busboy.destroy(reason);
  };
  const boundedSource = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seenBytes += chunk.byteLength;
      if (seenBytes > maximumRequestBytes) {
        const error = new HttpError(413, "Arquivo muito grande");
        abort(error);
        callback(error);
        return;
      }
      callback(null, chunk);
    },
  });

  busboy.on("field", (name: string, value: string, nameTruncated: boolean, valueTruncated: boolean) => {
    if (nameTruncated || valueTruncated || !allowedFields.includes(name) || Object.hasOwn(fields, name)) {
      abort(new HttpError(400, "Campos multipart inválidos"));
      return;
    }
    fields[name] = value;
  });
  busboy.on("file", (name: string, stream: BusboyFileStream, filename: string, _encoding: string, mimeType: string) => {
    fileCount += 1;
    if (name !== "file" || fileCount !== 1 || !filename || !mimeType) {
      stream.resume();
      abort(new HttpError(400, "Arquivo inválido"));
      return;
    }
    activeFileStream = stream;
    stream.once("limit", () => { fileTruncated = true; });
    filePromise = stageMediaStream({
      root,
      filename,
      mimeType,
      maximumBytes: maximumFileBytes,
      stream: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
    }).then(
      (file): StagingOutcome => ({ status: "fulfilled", file }),
      (error): StagingOutcome => {
        abort(error);
        return { status: "rejected", error };
      },
    ).finally(() => {
      if (activeFileStream === stream) activeFileStream = undefined;
    });
  });
  busboy.on("partsLimit", () => abort(new HttpError(400, "Multipart inválido")));
  busboy.on("filesLimit", () => abort(new HttpError(400, "Multipart inválido")));
  busboy.on("fieldsLimit", () => abort(new HttpError(400, "Multipart inválido")));

  const finished = new Promise<void>((resolve, reject) => {
    busboy.once("finish", resolve);
    busboy.once("error", (error) => { abort(error, { skipBusboy: true }); reject(error); });
    source.once("error", (error) => { abort(error); reject(error); });
    boundedSource.once("error", (error) => { abort(error); reject(error); });
  });
  source.pipe(boundedSource).pipe(busboy);

  let file: StagedMediaFile | undefined;
  try {
    await finished;
    const stagingOutcome = filePromise ? await filePromise : undefined;
    if (stagingOutcome?.status === "fulfilled") file = stagingOutcome.file;
    if (stagingOutcome?.status === "rejected") throw stagingOutcome.error;
    if (parserError) throw parserError;
    if (!file || fileTruncated || file.sizeBytes === 0n) {
      throw new HttpError(fileTruncated ? 413 : 400, fileTruncated ? "Arquivo muito grande" : "Arquivo inválido");
    }
    return { fields, file };
  } catch (error) {
    if (!source.destroyed) source.destroy();
    if (!boundedSource.destroyed) boundedSource.destroy();
    if (!busboy.destroyed) busboy.destroy();
    const stagingOutcome = filePromise ? await filePromise : undefined;
    if (stagingOutcome?.status === "fulfilled") await stagingOutcome.file.cleanup().catch(() => undefined);
    if (parserError instanceof HttpError) throw parserError;
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Multipart inválido");
  }
}

export async function parseMediaMultipartRequest(request: Request, root: string): Promise<{
  fields: Record<string, string>;
  file: StagedMediaFile;
}> {
  return parseMultipartFileRequest({
    request,
    root,
    maximumFileBytes: DOCUMENT_MAX_BYTES,
    maximumRequestBytes: MULTIPART_REQUEST_MAX_BYTES,
    allowedFields: ["type", "clientRequestId", "body"],
  });
}
