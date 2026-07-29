import type { IpadicFeatures, Tokenizer as KuromojiTokenizer } from "kuromoji";
import DynamicDictionaries from "kuromoji/src/dict/DynamicDictionaries";
import Tokenizer from "kuromoji/src/Tokenizer";
import { Zlib } from "zlibjs/bin/gunzip.min.js";
import baseGzip from "kuromoji/dict/base.dat.gz";
import ccGzip from "kuromoji/dict/cc.dat.gz";
import checkGzip from "kuromoji/dict/check.dat.gz";
import tidGzip from "kuromoji/dict/tid.dat.gz";
import tidMapGzip from "kuromoji/dict/tid_map.dat.gz";
import tidPosGzip from "kuromoji/dict/tid_pos.dat.gz";
import unkGzip from "kuromoji/dict/unk.dat.gz";
import unkCharGzip from "kuromoji/dict/unk_char.dat.gz";
import unkCompatGzip from "kuromoji/dict/unk_compat.dat.gz";
import unkInvokeGzip from "kuromoji/dict/unk_invoke.dat.gz";
import unkMapGzip from "kuromoji/dict/unk_map.dat.gz";
import unkPosGzip from "kuromoji/dict/unk_pos.dat.gz";
import {
  compactDoubleArrayBuffers,
  compactInvokeDefinitions,
  compactTargetMap,
  compactTokenInfoDictionary,
  compactTokenInfoFeatures,
  compactTrailingZeroUint32,
} from "./dictionaryBuffers";
import { KuromojiJapaneseAnalyzer } from "./japanese";

// Notices for the Kuromoji code and IPADIC data bundled through these imports
// are emitted into main.js by esbuild's banner. See scripts/licenses.mjs.

export async function createJapaneseAnalyzer(): Promise<KuromojiJapaneseAnalyzer> {
  await yieldToEventLoop();
  const dictionaries = new DynamicDictionaries();
  const trie = compactDoubleArrayBuffers(
    decompressInt32(baseGzip),
    decompressInt32(checkGzip),
  );
  dictionaries.loadTrie(trie.base, trie.check);

  const tokenTargetMap = compactTargetMap(decompress(tidMapGzip));
  // Compact the record buffer before decompressing the much larger feature
  // buffer. This keeps both raw builder allocations from being live during
  // the copy.
  const tokenDictionary = compactTokenInfoDictionary(
    decompress(tidGzip),
    tokenTargetMap,
  );
  const tokenFeatures = compactTokenInfoFeatures(
    tokenDictionary,
    decompress(tidPosGzip),
    tokenTargetMap,
  );
  dictionaries.loadTokenInfoDictionaries(
    tokenDictionary,
    tokenFeatures,
    tokenTargetMap,
  );
  dictionaries.loadConnectionCosts(decompressInt16(ccGzip));

  const unknownTargetMap = compactTargetMap(decompress(unkMapGzip));
  const unknownDictionary = compactTokenInfoDictionary(
    decompress(unkGzip),
    unknownTargetMap,
  );
  const unknownFeatures = compactTokenInfoFeatures(
    unknownDictionary,
    decompress(unkPosGzip),
    unknownTargetMap,
  );
  dictionaries.loadUnknownDictionaries(
    unknownDictionary,
    unknownFeatures,
    unknownTargetMap,
    decompress(unkCharGzip),
    compactTrailingZeroUint32(decompressUint32(unkCompatGzip)),
    compactInvokeDefinitions(decompress(unkInvokeGzip)),
  );
  return new KuromojiJapaneseAnalyzer(
    new Tokenizer(dictionaries) as KuromojiTokenizer<IpadicFeatures>,
  );
}

function decompress(compressed: Uint8Array): Uint8Array {
  return new Zlib.Gunzip(compressed).decompress();
}

function decompressInt16(compressed: Uint8Array): Int16Array {
  const bytes = decompress(compressed);
  if (
    bytes.byteOffset % Int16Array.BYTES_PER_ELEMENT === 0 &&
    bytes.byteLength % Int16Array.BYTES_PER_ELEMENT === 0
  ) {
    return new Int16Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength / Int16Array.BYTES_PER_ELEMENT,
    );
  }
  return new Int16Array(new Uint8Array(bytes).buffer);
}

function decompressInt32(compressed: Uint8Array): Int32Array {
  const bytes = decompress(compressed);
  if (
    bytes.byteOffset % Int32Array.BYTES_PER_ELEMENT === 0 &&
    bytes.byteLength % Int32Array.BYTES_PER_ELEMENT === 0
  ) {
    return new Int32Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength / Int32Array.BYTES_PER_ELEMENT,
    );
  }
  return new Int32Array(new Uint8Array(bytes).buffer);
}

function decompressUint32(compressed: Uint8Array): Uint32Array {
  const bytes = decompress(compressed);
  if (
    bytes.byteOffset % Uint32Array.BYTES_PER_ELEMENT === 0 &&
    bytes.byteLength % Uint32Array.BYTES_PER_ELEMENT === 0
  ) {
    return new Uint32Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength / Uint32Array.BYTES_PER_ELEMENT,
    );
  }
  return new Uint32Array(new Uint8Array(bytes).buffer);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
