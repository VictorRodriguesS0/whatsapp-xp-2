import "server-only";

import { parseMultipartFileRequest } from "@/modules/media/multipart";
import type { StagedMediaFile } from "@/modules/media/temp-file";

import { RAW_RECORDING_MAX_BYTES } from "./converter";

const RECORDING_MULTIPART_OVERHEAD_MAX_BYTES = 64 * 1024;

export function parseRecordingMultipartRequest(request: Request, root: string): Promise<{
  fields: Record<string, string>;
  file: StagedMediaFile;
}> {
  return parseMultipartFileRequest({
    request,
    root,
    maximumFileBytes: RAW_RECORDING_MAX_BYTES,
    maximumRequestBytes: RAW_RECORDING_MAX_BYTES + RECORDING_MULTIPART_OVERHEAD_MAX_BYTES,
    allowedFields: ["clientRequestId"],
  });
}
