import "server-only";

export type MediaStoragePutInput = {
  filename: string;
  bytes: Uint8Array;
  mimeType: string;
};

export type MediaStorageStreamInput = {
  filename: string;
  stream: ReadableStream<Uint8Array>;
  mimeType: string;
  maximumBytes: number;
};

export type StoredMedia = {
  key: string;
  sizeBytes: bigint;
  sha256: string;
};

export type MediaStorageRange = {
  start: bigint;
  end: bigint;
};

export interface MediaStorage {
  put(input: MediaStoragePutInput): Promise<StoredMedia>;
  putStream(input: MediaStorageStreamInput): Promise<StoredMedia>;
  open(key: string, range?: MediaStorageRange): Promise<ReadableStream<Uint8Array>>;
  remove(key: string): Promise<void>;
}
