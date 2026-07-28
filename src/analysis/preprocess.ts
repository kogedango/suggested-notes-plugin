export function stripTokenizableStructures(
  text: string,
  keepMarkdownLinkLabels: boolean,
): string {
  return text
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[\[[^\]]*\]\]/g, " ")
    .replace(/\[\[[^\]]*\]\]/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, keepMarkdownLinkLabels ? " $1 " : " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, keepMarkdownLinkLabels ? " $1 " : " ")
    .replace(/https?:\/\/[!-~]+/g, " ");
}

export function preprocessTokenizableText(text: string): string {
  return preprocessTokenizablePlainText(
    stripTokenizableStructures(text, true),
  );
}

export function preprocessTokenizablePlainText(text: string): string {
  return text
    // Remove compatibility symbols before NFKC can turn them into letters.
    .replace(/\p{S}+/gu, " ")
    // Keep digits inside identifiers while dropping standalone numerals.
    .replace(
      /(^|[^\p{L}\p{N}_])\p{N}+(?![\p{L}\p{N}_])/gu,
      "$1 ",
    )
    .normalize("NFKC")
    .replace(
      /(^|[\s(])#(?=[\p{N}\-/]*[\p{L}_])[\p{L}\p{N}_\-/]+/gu,
      "$1 ",
    )
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, " ")
    .replace(/^[ \t]*[-*+>][ \t]+/gm, " ");
}

// Linked labels are not unlinked title mentions.
export function preprocessMentionableText(text: string): string {
  return stripTokenizableStructures(text, false)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(
      /(^|[\s(])#(?=[\p{N}\-/]*[\p{L}_])[\p{L}\p{N}_\-/]+/gu,
      "$1 ",
    );
}
