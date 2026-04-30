/**
 * SegmentMatcher — pure module, no SDK imports, no DOM.
 *
 * matchSegments() tests each segment's LineString geometry against the
 * pre-buffered track polygon and returns the set of matching segment IDs.
 *
 * Deduplication is implicit because we use a Set<number> as the return type.
 * The caller is responsible for accumulating results across multiple cells and
 * computing the delta of new IDs per cell.
 */
import { booleanIntersects } from "@turf/turf";
import type { Feature, LineString } from "geojson";
import type { MatchArgs } from "./types";

export interface MatchSegmentsAsyncOptions {
    chunkSize?: number;
    yieldBetweenChunks?: () => Promise<void>;
}

/**
 * Return the set of segment IDs whose geometry intersects the buffered track.
 *
 * A segment is matched when ANY part of it falls inside or crosses the buffer
 * boundary — even a single shared point suffices.  This matches the PRD
 * criterion "Segment crossing buffer at one point → matched."
 */
export function matchSegments(args: MatchArgs): Set<number> {
    const { segments, bufferedTrack } = args;
    const matched = new Set<number>();

    for (const segment of segments) {
        const segFeature: Feature<LineString> = {
            type: "Feature",
            geometry: segment.geometry,
            properties: null,
        };

        if (booleanIntersects(segFeature, bufferedTrack)) {
            matched.add(segment.id);
        }
    }

    return matched;
}

/**
 * Async variant of matchSegments that yields between chunks so callers can
 * keep the browser responsive during large per-view matching runs.
 */
export async function matchSegmentsAsync(
    args: MatchArgs,
    options: MatchSegmentsAsyncOptions = {},
): Promise<Set<number>> {
    const { segments, bufferedTrack } = args;
    const matched = new Set<number>();
    const chunkSize = options.chunkSize ?? 20;
    const yieldBetweenChunks = options.yieldBetweenChunks;

    for (let start = 0; start < segments.length; start += chunkSize) {
        const chunk = segments.slice(start, start + chunkSize);

        for (const segment of chunk) {
            const segFeature: Feature<LineString> = {
                type: "Feature",
                geometry: segment.geometry,
                properties: null,
            };

            if (booleanIntersects(segFeature, bufferedTrack)) {
                matched.add(segment.id);
            }
        }

        if (yieldBetweenChunks && start + chunkSize < segments.length) {
            await yieldBetweenChunks();
        }
    }

    return matched;
}
