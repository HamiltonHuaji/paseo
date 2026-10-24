import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readValidatedJson, readValidatedString } from "./validated-storage";

class MemoryStorage {
  readonly values = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }
}

describe("validated storage reads", () => {
  it.each([
    ["malformed JSON", "{"],
    ["wrong field type", JSON.stringify({ enabled: "yes" })],
    ["unknown field", JSON.stringify({ enabled: true, surprise: true })],
  ])("retains saved JSON payloads: %s", async (label, raw) => {
    const storage = new MemoryStorage();
    storage.values.set("settings", raw);

    const read = readValidatedJson(storage, "settings", z.strictObject({ enabled: z.boolean() }));
    if (label === "unknown field") await expect(read).resolves.toEqual({ enabled: true });
    else await expect(read).rejects.toThrow("original data was retained");
    expect(storage.values.get("settings")).toBe(raw);
  });

  it("retains invalid scalar values", async () => {
    const storage = new MemoryStorage();
    storage.values.set("channel", "nightly");

    await expect(
      readValidatedString(storage, "channel", z.enum(["stable", "beta"])),
    ).rejects.toThrow("original data was retained");
    expect(storage.values.get("channel")).toBe("nightly");
  });

  it("returns only schema-validated values", async () => {
    const storage = new MemoryStorage();
    storage.values.set("settings", JSON.stringify({ enabled: true }));

    await expect(
      readValidatedJson(storage, "settings", z.strictObject({ enabled: z.boolean() })),
    ).resolves.toEqual({ enabled: true });
    expect(storage.values.has("settings")).toBe(true);
  });
});
