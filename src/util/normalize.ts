import { tokenize } from "./tokenize";

// User-entered body-token stopwords (recurring heading words like コメント /
// 結果) are run through the same tokenizer the note bodies use, so their
// canonical token forms line up with what lands in salient sets — width/case
// folding and katakana long-vowel normalization included. `segment` must match
// the corpus flag so a word tokenizes to the same form on both sides.
export function normalizeBodyTokenSet(
  list: string[],
  segment: boolean,
): Set<string> {
  const out = new Set<string>();
  for (const raw of list) {
    if (!raw.trim()) continue;
    for (const t of tokenize(raw, segment)) out.add(t);
  }
  return out;
}

export function normalizeFolder(s: string): string {
  return s.trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

export function normalizeTagSet(list: string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of list) {
    const t = raw.trim().replace(/^#+/, "");
    if (t) out.add(t);
  }
  return out;
}

export function normalizeLinkSet(list: string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of list) {
    let s = raw.trim();
    if (!s) continue;
    // Accept full paths, basenames, or [[wikilink]] forms.
    s = s.replace(/^\[\[|\]\]$/g, "");
    const pipe = s.indexOf("|");
    if (pipe >= 0) s = s.slice(0, pipe);
    const slash = s.lastIndexOf("/");
    if (slash >= 0) s = s.slice(slash + 1);
    if (s.endsWith(".md")) s = s.slice(0, -3);
    if (s) out.add(s);
  }
  return out;
}

export function isExcludedByFolder(folder: string, excluded: string[]): boolean {
  if (!folder) return false;
  for (const raw of excluded) {
    const e = normalizeFolder(raw);
    if (!e) continue;
    if (folder === e || folder.startsWith(e + "/")) return true;
  }
  return false;
}
