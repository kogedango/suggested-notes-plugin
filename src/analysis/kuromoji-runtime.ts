import type { IpadicFeatures, Tokenizer as KuromojiTokenizer } from "kuromoji";
import DynamicDictionaries from "kuromoji/src/dict/DynamicDictionaries";
import Tokenizer from "kuromoji/src/Tokenizer";
import { Zlib } from "zlibjs/bin/gunzip.min.js";
import takeBaseGzip from "kuromoji/dict/base.dat.gz";
import takeCcGzip from "kuromoji/dict/cc.dat.gz";
import takeCheckGzip from "kuromoji/dict/check.dat.gz";
import takeTidGzip from "kuromoji/dict/tid.dat.gz";
import takeTidMapGzip from "kuromoji/dict/tid_map.dat.gz";
import takeTidPosGzip from "kuromoji/dict/tid_pos.dat.gz";
import takeUnkGzip from "kuromoji/dict/unk.dat.gz";
import takeUnkCharGzip from "kuromoji/dict/unk_char.dat.gz";
import takeUnkCompatGzip from "kuromoji/dict/unk_compat.dat.gz";
import takeUnkInvokeGzip from "kuromoji/dict/unk_invoke.dat.gz";
import takeUnkMapGzip from "kuromoji/dict/unk_map.dat.gz";
import takeUnkPosGzip from "kuromoji/dict/unk_pos.dat.gz";
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

let japaneseAnalyzerPromise: Promise<KuromojiJapaneseAnalyzer> | undefined;

export function createJapaneseAnalyzer(): Promise<KuromojiJapaneseAnalyzer> {
  japaneseAnalyzerPromise ??= buildJapaneseAnalyzer();
  return japaneseAnalyzerPromise;
}

async function buildJapaneseAnalyzer(): Promise<KuromojiJapaneseAnalyzer> {
  await yieldToEventLoop();
  const dictionaries = new DynamicDictionaries();
  const trie = compactDoubleArrayBuffers(
    decompressInt32(takeBaseGzip()),
    decompressInt32(takeCheckGzip()),
  );
  dictionaries.loadTrie(trie.base, trie.check);

  const tokenTargetMap = compactTargetMap(decompress(takeTidMapGzip()));
  // Compact the record buffer before decompressing the much larger feature
  // buffer. This keeps both raw builder allocations from being live during
  // the copy.
  const tokenDictionary = compactTokenInfoDictionary(
    decompress(takeTidGzip()),
    tokenTargetMap,
  );
  // Compacting this 40 MB file would allocate another 34.36 MB merely to
  // reclaim 5.64 MB. Retain the original buffer so mobile startup avoids the
  // much larger transient copy.
  const tokenFeatures = decompress(takeTidPosGzip());
  dictionaries.loadTokenInfoDictionaries(
    tokenDictionary,
    tokenFeatures,
    tokenTargetMap,
  );
  dictionaries.loadConnectionCosts(decompressInt16(takeCcGzip()));

  const unknownTargetMap = compactTargetMap(decompress(takeUnkMapGzip()));
  const unknownDictionary = compactTokenInfoDictionary(
    decompress(takeUnkGzip()),
    unknownTargetMap,
  );
  const unknownFeatures = compactTokenInfoFeatures(
    unknownDictionary,
    decompress(takeUnkPosGzip()),
    unknownTargetMap,
  );
  dictionaries.loadUnknownDictionaries(
    unknownDictionary,
    unknownFeatures,
    unknownTargetMap,
    decompress(takeUnkCharGzip()),
    compactTrailingZeroUint32(decompressUint32(takeUnkCompatGzip())),
    compactInvokeDefinitions(decompress(takeUnkInvokeGzip())),
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
