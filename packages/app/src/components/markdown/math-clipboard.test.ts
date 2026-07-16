import { describe, expect, it } from "vitest";
import { getMathClipboardText } from "./math-clipboard";

describe("getMathClipboardText", () => {
  it("preserves inline formula source with dollar delimiters", () => {
    expect(getMathClipboardText("E = mc^2", false)).toBe("$E = mc^2$");
  });

  it("preserves display formula source with double-dollar delimiters", () => {
    expect(getMathClipboardText("\\int_0^1 x^2 \\, dx", true)).toBe("$$\\int_0^1 x^2 \\, dx$$");
  });
});
