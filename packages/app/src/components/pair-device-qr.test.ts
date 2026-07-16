import { describe, expect, it } from "vitest";
import { createPairingQrModel } from "./pair-device-qr";

describe("createPairingQrModel", () => {
  it("creates a deterministic SVG path with a quiet zone", () => {
    const url = "https://app.paseo.sh/#offer=test-offer";
    const first = createPairingQrModel(url);
    const second = createPairingQrModel(url);

    expect(first).toEqual(second);
    expect(first?.size).toBeGreaterThan(20);
    expect(first?.path.startsWith("M")).toBe(true);
    expect(first?.path).toContain("h1v1h-1z");
  });
});
