import type { FileSnapshot } from "../types";
import { basename } from "../util/path";
import { preprocessMentionableText } from "./preprocess";

const ASCII_WORD = /[A-Za-z0-9_]/;
const MIN_TITLE_CODE_POINTS = 2;

export class TitleMentionIndex {
  private surfaceByPath = new Map<string, string>();
  private pathsBySurface = new Map<string, Set<string>>();
  private surfacesByInitial = new Map<string, string[]>();

  rebuild(snapshots: Iterable<FileSnapshot>): void {
    this.surfaceByPath.clear();
    this.pathsBySurface.clear();
    this.surfacesByInitial.clear();
    for (const snapshot of snapshots) this.addWithoutRefreshing(snapshot.path);
    for (const surface of this.pathsBySurface.keys()) {
      const surfaces = this.surfacesByInitial.get(surface[0]) ?? [];
      surfaces.push(surface);
      this.surfacesByInitial.set(surface[0], surfaces);
    }
    for (const surfaces of this.surfacesByInitial.values()) {
      surfaces.sort((a, b) => b.length - a.length);
    }
  }

  add(path: string): void {
    if (this.surfaceByPath.has(path)) return;
    const surface = normalizedTitle(path);
    if (!surface) return;
    this.surfaceByPath.set(path, surface);
    const paths = this.pathsBySurface.get(surface) ?? new Set<string>();
    paths.add(path);
    this.pathsBySurface.set(surface, paths);
    this.refreshSurface(surface);
  }

  remove(path: string): void {
    const surface = this.surfaceByPath.get(path);
    if (!surface) return;
    this.surfaceByPath.delete(path);
    const paths = this.pathsBySurface.get(surface);
    paths?.delete(path);
    if (paths?.size === 0) this.pathsBySurface.delete(surface);
    this.refreshSurface(surface);
  }

  rename(oldPath: string, newPath: string): void {
    this.remove(oldPath);
    this.add(newPath);
  }

  find(
    body: string,
    activePath: string,
    linkedPaths: ReadonlySet<string>,
  ): Set<string> {
    const prose = preprocessMentionableText(body);
    if (!prose.trim()) return new Set();

    const found = new Set<string>();
    for (let index = 0; index < prose.length; index++) {
      const surfaces = this.surfacesByInitial.get(prose[index]);
      if (!surfaces) continue;
      let match: { surface: string; path: string } | undefined;
      for (const surface of surfaces) {
        if (
          !prose.startsWith(surface, index) ||
          !hasValidBoundaries(prose, surface, index)
        ) {
          continue;
        }
        const path = this.onlyEligiblePath(
          surface,
          activePath,
          linkedPaths,
        );
        if (path) {
          match = { surface, path };
          break;
        }
      }
      if (!match) continue;
      found.add(match.path);
      // Emit only the longest eligible title at each position.
      index += match.surface.length - 1;
    }
    return found;
  }

  private addWithoutRefreshing(path: string): void {
    const surface = normalizedTitle(path);
    if (!surface) return;
    this.surfaceByPath.set(path, surface);
    const paths = this.pathsBySurface.get(surface) ?? new Set<string>();
    paths.add(path);
    this.pathsBySurface.set(surface, paths);
  }

  private refreshSurface(surface: string): void {
    const initial = surface[0];
    const surfaces = (
      this.surfacesByInitial.get(initial) ?? []
    ).filter((candidate) => candidate !== surface);
    if (this.pathsBySurface.has(surface)) surfaces.push(surface);
    surfaces.sort((a, b) => b.length - a.length);
    if (surfaces.length > 0) this.surfacesByInitial.set(initial, surfaces);
    else this.surfacesByInitial.delete(initial);
  }

  private onlyEligiblePath(
    surface: string,
    activePath: string,
    linkedPaths: ReadonlySet<string>,
  ): string | undefined {
    let eligible: string | undefined;
    for (const path of this.pathsBySurface.get(surface) ?? []) {
      if (path === activePath || linkedPaths.has(path)) continue;
      if (eligible !== undefined) return undefined;
      eligible = path;
    }
    return eligible;
  }
}

// Ambiguous basenames and one-character titles are not reliable mentions.
// ASCII titles also require identifier boundaries.
export function findUnlinkedTitleMentions(
  body: string,
  activePath: string,
  snapshots: Iterable<FileSnapshot>,
  linkedPaths: ReadonlySet<string>,
): Set<string> {
  const index = new TitleMentionIndex();
  index.rebuild(snapshots);
  return index.find(body, activePath, linkedPaths);
}

function normalizedTitle(path: string): string | null {
  const surface = basename(path).normalize("NFKC").trim();
  if (
    [...surface].length < MIN_TITLE_CODE_POINTS ||
    !/[\p{L}\p{N}]/u.test(surface)
  ) {
    return null;
  }
  return surface.toLocaleLowerCase();
}

function hasValidBoundaries(
  text: string,
  surface: string,
  index: number,
): boolean {
  const before = index > 0 ? text[index - 1] : "";
  const after = text[index + surface.length] ?? "";
  const leftOk = !ASCII_WORD.test(surface[0]) || !ASCII_WORD.test(before);
  const rightOk =
    !ASCII_WORD.test(surface[surface.length - 1]) ||
    !ASCII_WORD.test(after);
  return leftOk && rightOk;
}
