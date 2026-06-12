// tiny-segmenter ships no types. CJS: `module.exports = TinySegmenter`.
declare module "tiny-segmenter" {
  class TinySegmenter {
    segment(text: string): string[];
  }
  export = TinySegmenter;
}
