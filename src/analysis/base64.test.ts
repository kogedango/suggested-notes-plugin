import { describe, expect, it } from "vitest";
import { decodeBase64 } from "./base64";

describe("embedded dictionary base64 decoder", () => {
  it.each(["", "a", "ab", "abc", "dictionary bytes \u0000\u00ff"])(
    "decodes %j without an intermediate binary string",
    (value) => {
      const bytes = new TextEncoder().encode(value);
      const encoded = Buffer.from(bytes).toString("base64");
      expect(decodeBase64(encoded)).toEqual(bytes);
    },
  );
});
