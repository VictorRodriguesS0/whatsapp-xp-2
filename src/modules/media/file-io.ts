import "server-only";

type WritableHandle = {
  write(buffer: Uint8Array, offset: number, length: number, position: number | null): Promise<{ bytesWritten: number }>;
};

type ReadableHandle = {
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
};

export async function writeAll(handle: WritableHandle, bytes: Uint8Array, position: number | null = null): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.byteLength - offset,
      position === null ? null : position + offset,
    );
    if (!Number.isInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > bytes.byteLength - offset) {
      throw new Error("Escrita de arquivo sem progresso");
    }
    offset += bytesWritten;
  }
}

export async function readExact(handle: ReadableHandle, buffer: Uint8Array, position: number): Promise<void> {
  let offset = 0;
  while (offset < buffer.byteLength) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, position + offset);
    if (!Number.isInteger(bytesRead) || bytesRead <= 0 || bytesRead > buffer.byteLength - offset) {
      throw new Error("Leitura de arquivo truncada");
    }
    offset += bytesRead;
  }
}
