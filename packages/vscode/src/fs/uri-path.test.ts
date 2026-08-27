import { describe, expect, test } from "vitest";
import { relativePathFromUriPath, workspaceDirectoryToUriRoot } from "./uri-path";

describe("Paseo workspace URI paths", () => {
  test("uses a POSIX workspace's actual absolute path as the URI root", () => {
    const root = workspaceDirectoryToUriRoot("/srv/repos/project/main/");
    expect(root).toEqual({ path: "/srv/repos/project/main", segmentCount: 4 });
    expect(relativePathFromUriPath(`${root.path}/src/index.ts`, String(root.segmentCount))).toBe(
      "src/index.ts",
    );
  });

  test("represents a Windows workspace path with URI separators", () => {
    const root = workspaceDirectoryToUriRoot("C:\\repos\\project\\main\\");
    expect(root).toEqual({ path: "/C:/repos/project/main", segmentCount: 4 });
    expect(relativePathFromUriPath(`${root.path}/src/index.ts`, String(root.segmentCount))).toBe(
      "src/index.ts",
    );
  });

  test("rejects a root segment count outside the URI path", () => {
    expect(() => relativePathFromUriPath("/repo/file.ts", "3")).toThrow(/segment count/);
  });
});
