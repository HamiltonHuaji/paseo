import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { OfficialReleaseAsset } from "./official-release-service.js";

export async function writeVerifiedOfficialAsset({
  directory,
  asset,
  chunks,
}: {
  directory: string;
  asset: OfficialReleaseAsset;
  chunks: AsyncIterable<Uint8Array>;
}): Promise<string> {
  if (path.basename(asset.name) !== asset.name) {
    throw new Error("The official installer has an unsafe filename.");
  }

  await mkdir(directory, { recursive: true });
  const finalPath = path.join(directory, asset.name);
  const partialPath = `${finalPath}.partial`;
  await rm(partialPath, { force: true });

  const hash = createHash("sha256");
  let bytesWritten = 0;
  const verifier = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytesWritten += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(chunks, verifier, createWriteStream(partialPath, { mode: 0o700 }));
    if (bytesWritten !== asset.size) {
      throw new Error(
        `The official installer size did not match (expected ${asset.size}, got ${bytesWritten}).`,
      );
    }
    const actualSha256 = hash.digest("hex");
    if (actualSha256 !== asset.sha256) {
      throw new Error("The official installer checksum did not match the GitHub release asset.");
    }
    await rm(finalPath, { force: true });
    await rename(partialPath, finalPath);
    return finalPath;
  } catch (error) {
    await rm(partialPath, { force: true });
    throw error;
  }
}
