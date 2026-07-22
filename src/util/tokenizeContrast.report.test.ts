import { expect, it } from "vitest";
import {
  evaluateTokenizerContrasts,
  formatTokenizerContrastReports,
} from "./tokenizeContrast";

it("formats and optionally prints the tokenizer contrast report", () => {
  const output = formatTokenizerContrastReports([
    evaluateTokenizerContrasts(true),
    evaluateTokenizerContrasts(false),
  ]);

  expect(output).toContain("identification rate: 5/20 (25.00%)");
  expect(output).toContain("identification rate: 4/20 (20.00%)");
  expect(output.match(/false-merge rate: 0\/5 \(0\.00%\)/g)).toHaveLength(2);
  expect(output).toContain("育てた | 育てて: shared [育て]");

  if (process.env.PRINT_TOKENIZER_CONTRAST_REPORT === "1") {
    process.stdout.write(`${output}\n`);
  }
});
