const BASE64_VALUES = new Uint8Array(128);

for (let index = 0; index < 64; index++) {
  BASE64_VALUES[
    index < 26
      ? index + 65
      : index < 52
        ? index + 71
        : index < 62
          ? index - 4
          : index * 4 - 205
  ] = index;
}

export function decodeBase64(encoded: string): Uint8Array {
  const length = encoded.length;
  const padding =
    (encoded[length - 1] === "=" ? 1 : 0) +
    (encoded[length - 2] === "=" ? 1 : 0);
  const decoded = new Uint8Array(((length - padding) * 3) / 4);
  let input = 0;
  let output = 0;
  while (input < length) {
    const a = BASE64_VALUES[encoded.charCodeAt(input++)];
    const b = BASE64_VALUES[encoded.charCodeAt(input++)];
    const c = BASE64_VALUES[encoded.charCodeAt(input++)];
    const d = BASE64_VALUES[encoded.charCodeAt(input++)];
    decoded[output++] = (a << 2) | (b >> 4);
    decoded[output++] = (b << 4) | (c >> 2);
    decoded[output++] = (c << 6) | d;
  }
  return decoded;
}
