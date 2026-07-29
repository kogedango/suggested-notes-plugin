export interface DoubleArrayBuffers {
  base: Int32Array;
  check: Int32Array;
}

export interface TokenInfoBuffers {
  dictionary: Uint8Array;
  features: Uint8Array;
}

const INT32_BYTES = Int32Array.BYTES_PER_ELEMENT;
const TOKEN_INFO_RECORD_BYTES = 10;
const TOKEN_INFO_FEATURE_OFFSET_BYTES = 6;
const TARGET_MAP_ENTRY_HEADER_BYTES = INT32_BYTES * 2;
const DOUBLE_ARRAY_TRAILING_FREE_SLOTS = 1;
const INVOKE_DEFINITION_TERMINATOR_BYTES = 1;

// doublearray's own constructor narrows these buffers with subarray(), but that
// view retains the complete decompressed ArrayBuffer. Copy the same logical
// range so the unused tail can actually be collected.
export function compactDoubleArrayBuffers(
  base: Int32Array,
  check: Int32Array,
): DoubleArrayBuffers {
  if (base.length !== check.length || check.length === 0) {
    throw new Error("Invalid Kuromoji double-array buffers");
  }
  let lastUsed = check.length - 1;
  while (lastUsed >= 0 && check[lastUsed] < 0) lastUsed--;
  if (lastUsed < 0) throw new Error("Empty Kuromoji double-array trie");

  // Match doublearray's shrink(): retain one unused slot after the final node
  // when the source allocation has room for it.
  const length = Math.min(
    check.length,
    lastUsed + 1 + DOUBLE_ARRAY_TRAILING_FREE_SLOTS,
  );
  return {
    base: copyInt32(base, length),
    check: copyInt32(check, length),
  };
}

// tid/unk dictionaries are arrays of ten-byte records. Their target map is the
// authoritative list of record offsets, and each record points to one
// null-terminated feature string. Use those references rather than the
// builder's fixed allocation size to find the complete live ranges.
export function compactTokenInfoBuffers(
  dictionary: Uint8Array,
  features: Uint8Array,
  targetMap: Uint8Array,
): TokenInfoBuffers {
  const compactedDictionary = compactTokenInfoDictionary(
    dictionary,
    targetMap,
  );
  return {
    dictionary: compactedDictionary,
    features: compactTokenInfoFeatures(
      compactedDictionary,
      features,
      targetMap,
    ),
  };
}

export function compactTokenInfoDictionary(
  dictionary: Uint8Array,
  targetMap: Uint8Array,
): Uint8Array {
  let dictionaryLength = 0;
  visitTargetMap(targetMap, (tokenInfoId) => {
    const recordEnd = tokenInfoId + TOKEN_INFO_RECORD_BYTES;
    if (tokenInfoId < 0 || recordEnd > dictionary.length) {
      throw new Error("Invalid Kuromoji token-info offset");
    }
    dictionaryLength = Math.max(dictionaryLength, recordEnd);
  });
  return copyUint8(dictionary, dictionaryLength);
}

export function compactTokenInfoFeatures(
  dictionary: Uint8Array,
  features: Uint8Array,
  targetMap: Uint8Array,
): Uint8Array {
  let featuresLength = 0;
  visitTargetMap(targetMap, (tokenInfoId) => {
    const recordEnd = tokenInfoId + TOKEN_INFO_RECORD_BYTES;
    if (tokenInfoId < 0 || recordEnd > dictionary.length) {
      throw new Error("Invalid Kuromoji token-info offset");
    }
    const featureOffset = readInt32LE(
      dictionary,
      tokenInfoId + TOKEN_INFO_FEATURE_OFFSET_BYTES,
    );
    if (featureOffset < 0 || featureOffset >= features.length) {
      throw new Error("Invalid Kuromoji feature offset");
    }
    const terminator = features.indexOf(0, featureOffset);
    if (terminator < 0) {
      throw new Error("Unterminated Kuromoji feature record");
    }
    featuresLength = Math.max(featuresLength, terminator + 1);
  });
  return copyUint8(features, featuresLength);
}

// TokenInfoDictionary.loadTargetMap() reads until the physical end rather than
// stopping after its declared key count. Remove builder padding so it does not
// scan a large zero-filled tail, especially for unk_map.
export function compactTargetMap(targetMap: Uint8Array): Uint8Array {
  return copyUint8(targetMap, visitTargetMap(targetMap, () => undefined));
}

// The compatible-category lookup treats an out-of-range code point exactly
// like a stored zero, so trailing zero words carry no information.
export function compactTrailingZeroUint32(values: Uint32Array): Uint32Array {
  let length = values.length;
  while (length > 0 && values[length - 1] === 0) length--;
  const result = new Uint32Array(length);
  result.set(values.subarray(0, length));
  return result;
}

// unk_invoke has no entry-count header and its parser also runs to the physical
// end. The generated file is padded with zero records; retain the terminator
// immediately following the final non-zero class-name byte.
export function compactInvokeDefinitions(data: Uint8Array): Uint8Array {
  let lastNonZero = data.length - 1;
  while (lastNonZero >= 0 && data[lastNonZero] === 0) lastNonZero--;
  if (lastNonZero < 0) return new Uint8Array();
  return copyUint8(
    data,
    Math.min(
      data.length,
      lastNonZero + 1 + INVOKE_DEFINITION_TERMINATOR_BYTES,
    ),
  );
}

function visitTargetMap(
  targetMap: Uint8Array,
  visit: (tokenInfoId: number) => void,
): number {
  if (targetMap.length < INT32_BYTES) {
    throw new Error("Invalid Kuromoji target map");
  }
  const keyCount = readInt32LE(targetMap, 0);
  if (keyCount < 0) throw new Error("Invalid Kuromoji target-map key count");

  let offset = INT32_BYTES;
  for (let keyIndex = 0; keyIndex < keyCount; keyIndex++) {
    if (offset + TARGET_MAP_ENTRY_HEADER_BYTES > targetMap.length) {
      throw new Error("Truncated Kuromoji target map");
    }
    const valueCount = readInt32LE(targetMap, offset + INT32_BYTES);
    if (valueCount < 0) {
      throw new Error("Invalid Kuromoji target-map value count");
    }
    offset += TARGET_MAP_ENTRY_HEADER_BYTES;
    const valuesEnd = offset + valueCount * INT32_BYTES;
    if (valuesEnd > targetMap.length) {
      throw new Error("Truncated Kuromoji target-map values");
    }
    for (; offset < valuesEnd; offset += INT32_BYTES) {
      visit(readInt32LE(targetMap, offset));
    }
  }
  return offset;
}

function readInt32LE(data: Uint8Array, offset: number): number {
  return (
    (data[offset + 3] << 24) |
    (data[offset + 2] << 16) |
    (data[offset + 1] << 8) |
    data[offset]
  );
}

function copyUint8(source: Uint8Array, length: number): Uint8Array {
  const result = new Uint8Array(length);
  result.set(source.subarray(0, length));
  return result;
}

function copyInt32(source: Int32Array, length: number): Int32Array {
  const result = new Int32Array(length);
  result.set(source.subarray(0, length));
  return result;
}
