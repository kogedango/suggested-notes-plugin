import { BilingualMorphologyAnalyzer } from "./bilingual";
import { WinkEnglishAnalyzer } from "./english";
import { createJapaneseAnalyzer } from "./kuromoji-runtime";
import type { MorphologyAnalyzer } from "./types";
import { yieldToEventLoop } from "../util/async";

export async function createBilingualAnalyzer(
  customVocabulary: string[],
): Promise<MorphologyAnalyzer> {
  const japanese = await createJapaneseAnalyzer();
  await yieldToEventLoop();
  const analyzer = new BilingualMorphologyAnalyzer(
    japanese,
    new WinkEnglishAnalyzer(),
  );
  analyzer.setCustomVocabulary(customVocabulary);
  return analyzer;
}
