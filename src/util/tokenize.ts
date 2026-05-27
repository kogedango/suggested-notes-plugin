const TOKEN_RE = /[A-Za-z][A-Za-z0-9_\-]{2,}|[ァ-ヶー]{3,}|[一-龥々]{2,}/gu;

const ASCII_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "have", "are", "was",
  "you", "your", "but", "not", "all", "any", "use", "using", "used", "can",
  "will", "into", "out", "about", "they", "their", "them", "these", "those",
  "http", "https", "www", "com", "org", "net",
]);

export function tokenize(body: string): Set<string> {
  // NFKC folds full-width ASCII, half-width katakana, and decomposed kana into
  // their canonical forms so "Ｏbsidian"/"ﾉｰﾄ" tokenize the same as the plain
  // forms. Without this, the same word in different widths produces distinct
  // tokens and never matches.
  const stripped = body
    .normalize("NFKC")
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\[\[[^\]]*\]\]/g, " ")
    .replace(/!\[\[[^\]]*\]\]/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, " $1 ")
    .replace(/(^|[\s(])#[\p{L}\p{N}_\-/]+/gu, " ");

  const out = new Set<string>();
  const matches = stripped.matchAll(TOKEN_RE);
  for (const m of matches) {
    let tok = m[0];
    if (/[A-Za-z]/.test(tok[0])) tok = tok.toLowerCase();
    // Minimum-length is already enforced per-script by TOKEN_RE
    // (ascii 3+, katakana 3+, kanji 2+). A blanket length<3 filter here
    // would incorrectly drop valid 2-kanji terms like "関連".
    if (ASCII_STOPWORDS.has(tok)) continue;
    out.add(tok);
  }
  return out;
}
