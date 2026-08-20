// @vitest-environment node

import { describe, expect, it } from "vitest";

import { readExact, writeAll } from "./file-io";

describe("exact file I/O", () => {
  it("loops until a partial-writing handle confirms every byte", async () => {
    const written: number[] = [];
    const handle = {
      async write(buffer: Uint8Array, offset: number, length: number) {
        const bytesWritten = Math.min(2, length);
        written.push(...buffer.subarray(offset, offset + bytesWritten));
        return { bytesWritten };
      },
    };

    await writeAll(handle, new Uint8Array([1, 2, 3, 4, 5]));

    expect(written).toEqual([1, 2, 3, 4, 5]);
  });

  it("fails closed when a write makes no progress", async () => {
    await expect(writeAll({ async write() { return { bytesWritten: 0 }; } }, new Uint8Array([1])))
      .rejects.toThrow(/progresso/i);
  });

  it("loops until a partial-reading handle fills the requested range", async () => {
    const source = new Uint8Array([9, 8, 7, 6]);
    const handle = {
      async read(buffer: Uint8Array, offset: number, length: number, position: number) {
        const bytesRead = Math.min(2, length, source.length - position);
        buffer.set(source.subarray(position, position + bytesRead), offset);
        return { bytesRead };
      },
    };
    const target = new Uint8Array(4);

    await readExact(handle, target, 0);

    expect(target).toEqual(source);
  });

  it("rejects a truncated exact read", async () => {
    const handle = { async read() { return { bytesRead: 0 }; } };
    await expect(readExact(handle, new Uint8Array(1), 0)).rejects.toThrow(/truncada/i);
  });
});
