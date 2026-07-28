import { BilingualMorphologyAnalyzer } from "./bilingual";
import { WinkEnglishAnalyzer } from "./english";
import { createJapaneseAnalyzer } from "./kuromoji-runtime";
import type { MorphologyAnalyzer } from "./types";

export async function createBilingualAnalyzer(
  customVocabulary: string[],
): Promise<MorphologyAnalyzer> {
  const japanese = await createJapaneseAnalyzer();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const analyzer = new BilingualMorphologyAnalyzer(
    japanese,
    new WinkEnglishAnalyzer(),
  );
  analyzer.setCustomVocabulary(customVocabulary);
  return analyzer;
}
