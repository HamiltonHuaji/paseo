import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { writeVerifiedOfficialAsset } from "./official-release-download";

const directories = new Set<string>();

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-official-download-test-"));
  directories.add(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) => rm(directory, { recursive: true, force: true })),
  );
  directories.clear();
});

describe("writeVerifiedOfficialAsset", () => {
  it("streams a verified asset into the download directory", async () => {
    const directory = await createTempDirectory();
    const contents = Buffer.from("official paseo installer");
    const sha256 = createHash("sha256").update(contents).digest("hex");

    const filePath = await writeVerifiedOfficialAsset({
      directory,
      asset: {
        name: "Paseo-Setup-0.1.109-x64.exe",
        downloadUrl: "https://github.com/getpaseo/paseo/releases/download/v0.1.109/test.exe",
        size: contents.length,
        sha256,
      },
      chunks: Readable.from([contents.subarray(0, 7), contents.subarray(7)]),
    });

    expect(filePath).toBe(path.join(directory, "Paseo-Setup-0.1.109-x64.exe"));
    await expect(readFile(filePath)).resolves.toEqual(contents);
    await expect(readdir(directory)).resolves.toEqual(["Paseo-Setup-0.1.109-x64.exe"]);
  });

  it("rejects a checksum mismatch and removes the partial file", async () => {
    const directory = await createTempDirectory();
    const contents = Buffer.from("tampered installer");

    await expect(
      writeVerifiedOfficialAsset({
        directory,
        asset: {
          name: "Paseo-0.1.109-amd64.deb",
          downloadUrl: "https://github.com/getpaseo/paseo/releases/download/v0.1.109/test.deb",
          size: contents.length,
          sha256: "0".repeat(64),
        },
        chunks: Readable.from([contents]),
      }),
    ).rejects.toThrow("checksum did not match");

    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it("rejects a size mismatch before accepting the installer", async () => {
    const directory = await createTempDirectory();
    const contents = Buffer.from("short");
    const sha256 = createHash("sha256").update(contents).digest("hex");

    await expect(
      writeVerifiedOfficialAsset({
        directory,
        asset: {
          name: "Paseo-0.1.109-amd64.deb",
          downloadUrl: "https://github.com/getpaseo/paseo/releases/download/v0.1.109/test.deb",
          size: contents.length + 1,
          sha256,
        },
        chunks: Readable.from([contents]),
      }),
    ).rejects.toThrow("size did not match");

    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it("rejects asset names that could escape the download directory", async () => {
    const directory = await createTempDirectory();

    await expect(
      writeVerifiedOfficialAsset({
        directory,
        asset: {
          name: "../Paseo.deb",
          downloadUrl: "https://github.com/getpaseo/paseo/releases/download/v0.1.109/test.deb",
          size: 1,
          sha256: "0".repeat(64),
        },
        chunks: Readable.from([Buffer.from("x")]),
      }),
    ).rejects.toThrow("unsafe filename");
  });
});
