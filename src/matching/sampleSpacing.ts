/**
 * Adaptive sample-spacing helpers shared by SegmentMatcher (BUFFERED stage)
 * and WalkController (slice projection cache).
 *
 * Tiered strategy: keep fine spacing on short segments where every sample
 * matters; relax on long segments where additional samples yield diminishing
 * precision gains.
 */

/**
 * Returns the effective sample spacing in metres for a segment of the given
 * length.  The returned value is used as the step between evenly-distributed
 * samples; callers also apply a separate hard cap on total sample count.
 *
 * Two variants share the same tier boundaries but differ in the short-segment
 * floor to preserve the calibration of each call site:
 *
 *  effectiveSampleSpacing()           — SegmentMatcher (BUFFERED), floor 10 m
 *  effectiveSampleSpacingProjection() — WalkController (projection cache), floor 8 m
 *
 * Common tiers (length thresholds):
 *   < 100 m  → floor (short: precision matters most)
 *   < 300 m  → 12 m  (medium)
 *   ≥ 300 m  → 15 m  (long: diminishing returns)
 */
export function effectiveSampleSpacing(lengthMeters: number): number {
  if (lengthMeters < 100) return 10;
  if (lengthMeters < 300) return 12;
  return 15;
}

/**
 * Projection-cache variant: same tiers but the short-segment floor is 8 m
 * (matching the original `PROJECTED_SAMPLE_STEP_METERS = 8` constant so that
 * existing precision thresholds remain calibrated for short segments).
 */
export function effectiveSampleSpacingProjection(lengthMeters: number): number {
  if (lengthMeters < 100) return 8;
  if (lengthMeters < 300) return 12;
  return 15;
}
