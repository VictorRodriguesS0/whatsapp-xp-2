import "server-only";

export type MediaStoragePutInput = {
  filename: string;
  bytes: Uint8Array;
  mimeType: string;
};

export type StoredMedia = {
  key: string;
  sizeBytes: bigint;
  sha256: string;
};

export interface MediaStorage {
  put(input: MediaStoragePutInput): Promise<StoredMedia>;
  open(key: string): Promise<ReadableStream<Uint8Array>>;
}
