// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { fileTypeFromFileMock } = vi.hoisted(() => ({
  fileTypeFromFileMock: vi.fn(),
}));

vi.mock("file-type", () => ({
  fileTypeFromFile: fileTypeFromFileMock,
}));

import { MediaValidationError, validateMediaFile } from "./validation";

const tempRoots: string[] = [];

async function temporaryFile(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "xp-detected-mime-"));
  tempRoots.push(root);
  const path = join(root, "gravacao.ogg");
  await writeFile(path, Buffer.from("opaque-test-content"));
  return path;
}

afterEach(async () => {
  fileTypeFromFileMock.mockReset();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("detected media MIME canonicalization", () => {
  it("accepts an allowlisted detected MIME with codec parameters", async () => {
    fileTypeFromFileMock.mockResolvedValue({ ext: "ogg", mime: "audio/ogg; codecs=opus" });

    await expect(validateMediaFile({
      path: await temporaryFile(),
      filename: "gravacao.ogg",
      mimeType: "audio/ogg",
    })).resolves.toMatchObject({ mimeType: "audio/ogg", kind: "audio" });
  });

  it("still rejects a different detected MIME after canonicalization", async () => {
    fileTypeFromFileMock.mockResolvedValue({ ext: "mp3", mime: "audio/mpeg; codecs=mp3" });

    await expect(validateMediaFile({
      path: await temporaryFile(),
      filename: "gravacao.ogg",
      mimeType: "audio/ogg",
    })).rejects.toBeInstanceOf(MediaValidationError);
  });
});
