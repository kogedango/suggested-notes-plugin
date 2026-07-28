import kuromoji, { type IpadicFeatures, type Tokenizer } from "kuromoji";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { BilingualMorphologyAnalyzer } from "./bilingual";
import { WinkEnglishAnalyzer } from "./english";
import { KuromojiJapaneseAnalyzer } from "./japanese";

function buildTokenizer(): Promise<Tokenizer<IpadicFeatures>> {
  const packagePath = fileURLToPath(
    import.meta.resolve("kuromoji/package.json"),
  );
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: join(dirname(packagePath), "dict") }).build(
      (error, tokenizer) => {
        if (error) reject(error);
        else resolve(tokenizer);
      },
    );
  });
}

describe("KuromojiJapaneseAnalyzer with IPADIC", () => {
  let analyzer: KuromojiJapaneseAnalyzer;
  let bilingual: BilingualMorphologyAnalyzer;

  beforeAll(async () => {
    analyzer = new KuromojiJapaneseAnalyzer(await buildTokenizer());
    bilingual = new BilingualMorphologyAnalyzer(
      analyzer,
      new WinkEnglishAnalyzer(),
    );
  });

  const keys = (text: string) =>
    analyzer.analyze(text).map((token) => token.key);

  it("normalizes real Japanese inflections to IPADIC basic forms", () => {
    expect(keys("道具を使った")).toEqual(["道具", "使う"]);
    expect(keys("道具を使わない")).toEqual(["道具", "使う"]);
    expect(keys("暑かったので窓を開けた")).toEqual([
      "暑い",
      "窓",
      "開ける",
    ]);
    expect(keys("急いだ")).toEqual(["急ぐ"]);
    expect(keys("とても速く走った")).toEqual([
      "とても",
      "速い",
      "走る",
    ]);
  });

  it("emits noun components, length-two and length-three windows", () => {
    expect(keys("自然言語処理")).toEqual([
      "自然",
      "言語",
      "処理",
      "自然言語",
      "言語処理",
      "自然言語処理",
    ]);
  });

  it("adds one maximal key for noun runs longer than three parts", () => {
    expect(keys("関連ノート検索機能")).toEqual([
      "関連",
      "ノート",
      "検索",
      "機能",
      "関連ノート",
      "ノート検索",
      "検索機能",
      "関連ノート検索",
      "ノート検索機能",
      "関連ノート検索機能",
    ]);
  });

  it("uses prefixes and suffixes only inside valid compounds", () => {
    expect(keys("再構築")).toEqual(["構築", "再構築"]);
    expect(keys("安全性評価")).toEqual([
      "安全",
      "評価",
      "安全性",
      "安全性評価",
    ]);
    expect(keys("日本語形態素解析器")).toEqual([
      "日本語",
      "形態素",
      "解析",
      "日本語形態素",
      "形態素解析",
      "解析器",
      "日本語形態素解析",
      "形態素解析器",
      "日本語形態素解析器",
    ]);
  });

  it("breaks compound runs at numbers, counters, and whitespace", () => {
    expect(keys("第3回会議")).toEqual(["会議"]);
    expect(keys("猫 写真")).toEqual(["猫", "写真"]);
  });

  it("recovers a full three-part surface despite misleading IPADIC components", () => {
    expect(keys("外国人参政権")).toEqual([
      "外国",
      "人参",
      "政権",
      "外国人参",
      "人参政権",
      "外国人参政権",
    ]);
  });

  it("joins adjacent ASCII nouns and identifiers to Japanese noun runs", () => {
    bilingual.setCustomVocabulary([]);
    expect(bilingual.analyze("API設計").map((token) => token.key)).toEqual([
      "api",
      "設計",
      "api設計",
    ]);
    expect(bilingual.analyze("Web開発").map((token) => token.key)).toEqual([
      "web",
      "開発",
      "web開発",
    ]);
    expect(bilingual.analyze("設計API").map((token) => token.key)).toEqual([
      "設計",
      "api",
      "設計api",
    ]);
    expect(bilingual.analyze("API再設計").map((token) => token.key)).toEqual([
      "api",
      "設計",
      "再設計",
      "api再設計",
    ]);
    expect(
      bilingual.analyze("API自然言語処理").map((token) => token.key),
    ).toEqual([
      "api",
      "自然",
      "言語",
      "処理",
      "自然言語",
      "言語処理",
      "自然言語処理",
      "api自然",
      "api自然言語",
      "api自然言語処理",
    ]);
  });

  it("does not join ASCII and Japanese tokens across visible boundaries", () => {
    bilingual.setCustomVocabulary([]);
    expect(bilingual.analyze("API 設計").map((token) => token.key)).toEqual([
      "api",
      "設計",
    ]);
    expect(bilingual.analyze("APIを設計").map((token) => token.key)).toEqual([
      "api",
      "設計",
    ]);
    expect(bilingual.analyze("API・設計").map((token) => token.key)).toEqual([
      "api",
      "設計",
    ]);
  });

  it("keeps custom terms atomic while joining their outer noun boundary", () => {
    bilingual.setCustomVocabulary(["機械学習", "C++"]);
    expect(
      bilingual.analyze("機械学習モデル").map((token) => token.key),
    ).toEqual(["機械学習", "モデル", "機械学習モデル"]);
    expect(bilingual.analyze("C++開発").map((token) => token.key)).toEqual([
      "C++",
      "開発",
      "C++開発",
    ]);
    expect(
      bilingual.analyze("機械学習 モデル").map((token) => token.key),
    ).toEqual(["機械学習", "モデル"]);
    expect(
      bilingual.analyze("自然機械学習モデル").map((token) => token.key),
    ).toEqual([
      "自然",
      "機械学習",
      "モデル",
      "自然機械学習",
      "機械学習モデル",
      "自然機械学習モデル",
    ]);
  });
});
