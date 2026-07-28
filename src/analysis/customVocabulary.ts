const ASCII_IDENTIFIER_CHAR = /[A-Za-z0-9_]/;

export interface CustomTerm {
  // ASCII-only case folding keeps UTF-16 offsets stable.
  surface: string;
  // First spelling in the connected alias group.
  key: string;
}

interface CustomAlias {
  surface: string;
  display: string;
  order: number;
}

export interface ProtectedCustomTerms {
  text: string;
  placeholder: string;
  terms: CustomTerm[];
}

export class CustomVocabulary {
  private byInitial = new Map<string, CustomTerm[]>();
  private symbolByInitial = new Map<string, CustomTerm[]>();

  setEntries(entries: string[]): void {
    this.byInitial.clear();
    this.symbolByInitial.clear();

    for (const term of buildCustomTerms(entries)) {
      addByInitial(this.byInitial, term);
      if (/\p{S}/u.test(term.surface)) {
        addByInitial(this.symbolByInitial, term);
      }
    }
    sortLongestFirst(this.byInitial);
    sortLongestFirst(this.symbolByInitial);
  }

  matchFolded(foldedText: string, index: number): CustomTerm | undefined {
    return findMatch(this.byInitial, foldedText, index);
  }

  protectSymbolTerms(line: string): ProtectedCustomTerms | null {
    if (this.symbolByInitial.size === 0) return null;

    const placeholder = unusedPrivateUseCharacter(line);
    const foldedLine = foldAsciiCase(line);
    const terms: CustomTerm[] = [];
    let text = "";
    let index = 0;
    while (index < line.length) {
      const match = findMatch(this.symbolByInitial, foldedLine, index);
      if (!match) {
        text += line[index];
        index++;
        continue;
      }
      text += placeholder;
      terms.push(match);
      index += match.surface.length;
    }
    return { text, placeholder, terms };
  }
}

export function foldAsciiCase(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function buildCustomTerms(entries: string[]): CustomTerm[] {
  const aliases = new Map<string, CustomAlias>();
  const parent = new Map<string, string>();
  let order = 0;

  const find = (surface: string): string => {
    const current = parent.get(surface);
    if (!current || current === surface) return surface;
    const root = find(current);
    parent.set(surface, root);
    return root;
  };
  const union = (left: string, right: string): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    const leftOrder = aliases.get(leftRoot)?.order ?? Number.MAX_VALUE;
    const rightOrder = aliases.get(rightRoot)?.order ?? Number.MAX_VALUE;
    if (leftOrder <= rightOrder) parent.set(rightRoot, leftRoot);
    else parent.set(leftRoot, rightRoot);
  };

  for (const raw of entries) {
    const group: string[] = [];
    for (const part of raw.split("|")) {
      const display = part.normalize("NFKC").trim();
      if (!display || !/\p{L}/u.test(display)) continue;
      const surface = foldAsciiCase(display);
      if (!aliases.has(surface)) {
        aliases.set(surface, { surface, display, order: order++ });
        parent.set(surface, surface);
      }
      if (!group.includes(surface)) group.push(surface);
    }
    for (let i = 1; i < group.length; i++) union(group[0], group[i]);
  }

  return [...aliases.values()].map((alias) => ({
    surface: alias.surface,
    key: aliases.get(find(alias.surface))?.display ?? alias.display,
  }));
}

function addByInitial(
  index: Map<string, CustomTerm[]>,
  term: CustomTerm,
): void {
  const terms = index.get(term.surface[0]) ?? [];
  terms.push(term);
  index.set(term.surface[0], terms);
}

function sortLongestFirst(index: Map<string, CustomTerm[]>): void {
  for (const terms of index.values()) {
    terms.sort((left, right) => right.surface.length - left.surface.length);
  }
}

function findMatch(
  index: Map<string, CustomTerm[]>,
  foldedText: string,
  offset: number,
): CustomTerm | undefined {
  return index
    .get(foldedText[offset])
    ?.find(
      (term) =>
        foldedText.startsWith(term.surface, offset) &&
        hasValidBoundaries(foldedText, term.surface, offset),
    );
}

function hasValidBoundaries(
  text: string,
  surface: string,
  index: number,
): boolean {
  const before = index > 0 ? text[index - 1] : "";
  const after = text[index + surface.length] ?? "";
  const leftOk =
    !ASCII_IDENTIFIER_CHAR.test(surface[0]) ||
    !ASCII_IDENTIFIER_CHAR.test(before);
  const rightOk =
    !ASCII_IDENTIFIER_CHAR.test(surface[surface.length - 1]) ||
    !ASCII_IDENTIFIER_CHAR.test(after);
  return leftOk && rightOk;
}

function unusedPrivateUseCharacter(text: string): string {
  for (let code = 0xe000; code <= 0xf8ff; code++) {
    const candidate = String.fromCharCode(code);
    if (!text.includes(candidate)) return candidate;
  }
  // Preserve uniqueness even if every BMP private-use character is occupied.
  let fallback = "\uFDD0";
  while (text.includes(fallback)) fallback += "\uFDD0";
  return fallback;
}
