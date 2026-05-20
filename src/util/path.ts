export function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  return base.endsWith(".md") ? base.slice(0, -3) : base;
}

export function displayName(path: string): string {
  return basename(path);
}
