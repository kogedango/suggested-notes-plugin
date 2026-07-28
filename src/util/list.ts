// Parses a list-setting textarea into entries. Values that can never contain
// a comma (tags, content words) also split on commas — users habitually type
// "a, b, c" and a newline-only split silently turns that into one dead entry.
// Folder paths and note basenames CAN legally contain commas, so those lists
// must stay newline-only or a valid entry gets corrupted instead.
export function parseListInput(raw: string, splitCommas: boolean): string[] {
  return raw
    .split(splitCommas ? /[\n,,、]/ : "\n")
    .map((s) => s.trim())
    .filter(Boolean);
}
