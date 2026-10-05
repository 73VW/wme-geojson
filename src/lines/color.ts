// Preview colour of a line, from its position in its source. Consecutive
// hues are a golden angle (~137.5°) apart, so the tracks of one file stay
// clearly distinct however many there are. (A hash of the id did not: the
// ids of one file differ only by their last character.)

const GOLDEN_ANGLE = 137.508;

export function colorForLineIndex(index: number): string {
  const hue = Math.round((index * GOLDEN_ANGLE) % 360);
  return `hsl(${hue}, 70%, 45%)`;
}
