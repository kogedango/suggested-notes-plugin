declare module "*.dat.gz" {
  const bytes: Uint8Array;
  export default bytes;
}

declare module "kuromoji/src/dict/DynamicDictionaries" {
  import type { DynamicDictionaries } from "kuromoji";
  const Constructor: {
    new (): DynamicDictionaries & {
      loadTokenInfoDictionaries(
        tokenInfo: Uint8Array,
        pos: Uint8Array,
        targetMap: Uint8Array,
      ): void;
      loadConnectionCosts(costs: Int16Array): void;
      loadUnknownDictionaries(
        unknown: Uint8Array,
        unknownPos: Uint8Array,
        unknownMap: Uint8Array,
        categoryMap: Uint8Array,
        compatibleCategoryMap: Uint32Array,
        invokeDefinition: Uint8Array,
      ): void;
    };
  };
  export = Constructor;
}

declare module "kuromoji/src/Tokenizer" {
  import type {
    DynamicDictionaries,
    IpadicFeatures,
    Tokenizer,
  } from "kuromoji";
  const Constructor: {
    new (dictionaries: DynamicDictionaries): Tokenizer<IpadicFeatures>;
  };
  export = Constructor;
}

declare module "zlibjs/bin/gunzip.min.js" {
  export namespace Zlib {
    class Gunzip {
      constructor(data: Uint8Array);
      decompress(): Uint8Array;
    }
  }
}
