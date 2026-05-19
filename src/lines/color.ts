// Stable preview colour for a line, derived from its id.
// Phase 7a only needs determinism; Phase 7b tunes the palette for contrast.

export function colorForLineId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 45%)`;
}
