import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  compactDoubleArrayBuffers,
  compactInvokeDefinitions,
  compactTargetMap,
  compactTokenInfoBuffers,
  compactTrailingZeroUint32,
} from "./dictionaryBuffers";

describe("Kuromoji dictionary buffer compaction", () => {
  it("copies only the double-array range through its final used node", () => {
    const base = new Int32Array([1, 2, 3, -3, -4, -5]);
    const check = new Int32Array([0, 0, 1, -4, -5, -6]);

    const compacted = compactDoubleArrayBuffers(base, check);

    expect([...compacted.base]).toEqual([1, 2, 3, -3]);
    expect([...compacted.check]).toEqual([0, 0, 1, -4]);
    expect(compacted.base.buffer).not.toBe(base.buffer);
    expect(compacted.check.buffer).not.toBe(check.buffer);
  });

  it("derives token and feature lengths from the target map", () => {
    const dictionary = new Uint8Array(40);
    writeInt32LE(dictionary, 6, 0);
    writeInt32LE(dictionary, 26, 4);
    const features = new TextEncoder().encode("one\0two\0padding");
    const targetMap = targetMapWith([[7, [0, 20]]], 32);

    const compacted = compactTokenInfoBuffers(
      dictionary,
      features,
      targetMap,
    );

    expect(compacted.dictionary).toHaveLength(30);
    expect(new TextDecoder().decode(compacted.features)).toBe("one\0two\0");
    expect(compacted.dictionary.buffer).not.toBe(dictionary.buffer);
    expect(compacted.features.buffer).not.toBe(features.buffer);
  });

  it("removes target-map allocation padding after declared entries", () => {
    const targetMap = targetMapWith(
      [
        [1, [10]],
        [4, [20, 30]],
      ],
      64,
    );

    expect(compactTargetMap(targetMap)).toHaveLength(32);
  });

  it("removes zero-filled compatibility and invoke-definition tails", () => {
    expect([
      ...compactTrailingZeroUint32(new Uint32Array([1, 0, 2, 0, 0])),
    ]).toEqual([1, 0, 2]);
    expect([
      ...compactInvokeDefinitions(new Uint8Array([1, 2, 65, 0, 0, 0])),
    ]).toEqual([1, 2, 65, 0]);
  });
});

describe("installed Kuromoji dictionary layout", () => {
  const require = createRequire(import.meta.url);
  const doublearray = require("doublearray") as {
    load(base: Int32Array, check: Int32Array): { size(): number };
  };
  const InvokeDefinitionMap = require(
    "kuromoji/src/dict/InvokeDefinitionMap",
  ) as {
    load(data: Uint8Array): { map: unknown[] };
  };

  it("compacts the real double-array exactly like its loader", () => {
    const base = gunzipInt32("base");
    const check = gunzipInt32("check");
    const compacted = compactDoubleArrayBuffers(base, check);

    expect(compacted.base).toHaveLength(1_355_501);
    expect(compacted.check).toHaveLength(1_355_501);
    expect(doublearray.load(base, check).size()).toBe(compacted.check.length);
  });

  it("discards only zero padding from real token-info buffers", () => {
    const targetMap = gunzip("tid_map");
    const compactedMap = compactTargetMap(targetMap);
    expect(compactedMap).toHaveLength(4_175_476);
    expect(isAllZero(targetMap.subarray(compactedMap.length))).toBe(true);

    const dictionary = gunzip("tid");
    const features = gunzip("tid_pos");
    const compacted = compactTokenInfoBuffers(
      dictionary,
      features,
      compactedMap,
    );
    expect(compacted.dictionary).toHaveLength(3_921_260);
    expect(compacted.features).toHaveLength(36_028_025);
    expect(isAllZero(dictionary.subarray(compacted.dictionary.length))).toBe(
      true,
    );
    expect(isAllZero(features.subarray(compacted.features.length))).toBe(true);
  });

  it("discards only zero padding from real unknown-word buffers", () => {
    const targetMap = gunzip("unk_map");
    const compactedMap = compactTargetMap(targetMap);
    expect(compactedMap).toHaveLength(252);
    expect(isAllZero(targetMap.subarray(compactedMap.length))).toBe(true);

    const dictionary = gunzip("unk");
    const features = gunzip("unk_pos");
    const compacted = compactTokenInfoBuffers(
      dictionary,
      features,
      compactedMap,
    );
    expect(compacted.dictionary).toHaveLength(400);
    expect(compacted.features).toHaveLength(1_596);
    expect(isAllZero(dictionary.subarray(compacted.dictionary.length))).toBe(
      true,
    );
    expect(isAllZero(features.subarray(compacted.features.length))).toBe(true);

    const invoke = gunzip("unk_invoke");
    const compactedInvoke = compactInvokeDefinitions(invoke);
    expect(compactedInvoke).toHaveLength(153);
    expect(isAllZero(invoke.subarray(compactedInvoke.length))).toBe(true);
    expect(InvokeDefinitionMap.load(compactedInvoke).map).toHaveLength(11);

    const compatible = gunzipUint32("unk_compat");
    const compactedCompatible = compactTrailingZeroUint32(compatible);
    expect(compactedCompatible).toHaveLength(30_335);
    expect(
      [...compatible.subarray(compactedCompatible.length)].every(
        (value) => value === 0,
      ),
    ).toBe(true);
  });
});

function targetMapWith(
  entries: Array<[number, number[]]>,
  allocation: number,
): Uint8Array {
  const data = new Uint8Array(allocation);
  writeInt32LE(data, 0, entries.length);
  let offset = 4;
  for (const [key, values] of entries) {
    writeInt32LE(data, offset, key);
    writeInt32LE(data, offset + 4, values.length);
    offset += 8;
    for (const value of values) {
      writeInt32LE(data, offset, value);
      offset += 4;
    }
  }
  return data;
}

function writeInt32LE(data: Uint8Array, offset: number, value: number): void {
  new DataView(data.buffer, data.byteOffset + offset, 4).setInt32(
    0,
    value,
    true,
  );
}

function gunzip(name: string): Uint8Array {
  return new Uint8Array(
    gunzipSync(
      readFileSync(
        resolve("node_modules", "kuromoji", "dict", `${name}.dat.gz`),
      ),
    ),
  );
}

function gunzipInt32(name: string): Int32Array {
  return new Int32Array(gunzip(name).buffer);
}

function gunzipUint32(name: string): Uint32Array {
  return new Uint32Array(gunzip(name).buffer);
}

function isAllZero(values: Uint8Array): boolean {
  return values.every((value) => value === 0);
}
