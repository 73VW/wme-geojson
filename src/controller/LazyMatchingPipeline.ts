import type { MultiLineString } from "geojson";
import type { SourceStore } from "../state/SourceStore";
import type { Line, SubLine } from "../domain/types";
import { fitNextSubLine } from "../matching/fitNextSubLine";
import { sliceMultiLineByDistance } from "../matching/trackPortions";

export interface MapDriver {
  zoomToExtent(bbox: [number, number, number, number]): void;
  setMapCenter(lon: number, lat: number, zoom: number): void;
  getZoomLevel(): number;
  setSelection(segmentIds: number[]): void;
  waitIdle(): Promise<void>;
}

export interface MatchDriver {
  runMatch(): Promise<number[]>;
}

export interface LazyMatchingPipelineOptions {
  store: SourceStore;
  map: MapDriver;
  match: MatchDriver;
  targetZoom: number;
}

export class LazyMatchingPipeline {
  constructor(private readonly opts: LazyMatchingPipelineOptions) {}

  private pendingMatched: number[] | null = null;

  /**
   * Advance to the next sub-line that needs operator validation. If the cursor
   * already points at an unvalidated sub-line, reuse it; otherwise fit and
   * persist the next sub-line. Then center the map, run matching, set selection.
   * No-op (returns) when there is nothing left to match.
   */
  async stepUntilValidation(): Promise<void> {
    const src = this.opts.store.getSource();
    if (!src) throw new Error("LazyMatchingPipeline: store not hydrated");

    const cursor = this.findOrCreateNextSubLineCursor();
    if (cursor === null) return;
    this.opts.store.rewindCursor(cursor.lineIndex, cursor.subLineIndex);
    const { lineIndex, subLineIndex } = cursor;
    const sub = this.opts.store.getSource()!.lines[lineIndex].subLines[subLineIndex];

    this.opts.map.setMapCenter(sub.view.lon, sub.view.lat, sub.view.zoom);
    await this.opts.map.waitIdle();
    const matched = await this.opts.match.runMatch();
    this.opts.map.setSelection(matched);
    this.pendingMatched = matched;
  }

  /**
   * Segment ids matched in the most recent step, before validation. Empty once
   * the current sub-line has been validated (or before the first match).
   */
  getPendingMatched(): number[] {
    return this.pendingMatched ?? [];
  }

  validate(segmentIdsOverride?: number[]): void {
    const src = this.opts.store.getSource();
    if (!src || !src.cursor) throw new Error("LazyMatchingPipeline.validate: no cursor");
    const ids = segmentIdsOverride ?? this.pendingMatched ?? [];
    this.opts.store.validateSubLine(src.cursor.lineIndex, src.cursor.subLineIndex, ids);
    this.pendingMatched = null;
  }

  back(): void {
    const src = this.opts.store.getSource();
    if (!src || !src.cursor) return;
    const { lineIndex, subLineIndex } = src.cursor;
    if (subLineIndex > 0) {
      this.opts.store.rewindCursor(lineIndex, subLineIndex - 1);
      return;
    }
    if (lineIndex > 0) {
      const prevLine = src.lines[lineIndex - 1];
      const lastIdx = prevLine.subLines.length - 1;
      if (lastIdx >= 0) this.opts.store.rewindCursor(lineIndex - 1, lastIdx);
    }
  }

  rerunCurrent(): void {
    const src = this.opts.store.getSource();
    if (!src || !src.cursor) return;
    this.opts.store.rerunSubLine(src.cursor.lineIndex, src.cursor.subLineIndex);
  }

  private findOrCreateNextSubLineCursor(): { lineIndex: number; subLineIndex: number } | null {
    const src = this.opts.store.getSource()!;
    for (let li = 0; li < src.lines.length; li++) {
      const line = src.lines[li];
      const firstUnvalidated = line.subLines.findIndex((s) => !s.validated);
      if (firstUnvalidated !== -1) {
        return { lineIndex: li, subLineIndex: firstUnvalidated };
      }
      if (line.pendingTail.length > 0) {
        const newSub = this.createNextSubLineFor(line);
        const remainder = line.pendingTail[0].kmB > newSub.kmB
          ? { kmA: newSub.kmB, kmB: line.pendingTail[0].kmB }
          : null;
        this.opts.store.addSubLine(li, newSub, remainder);
        return { lineIndex: li, subLineIndex: newSub.index };
      }
    }
    return null;
  }

  private createNextSubLineFor(line: Line): SubLine {
    const pending = line.pendingTail[0];
    const slice = sliceMultiLineByDistance(line.geometry, pending.kmA, pending.kmB);
    const fit = fitNextSubLine({
      pending,
      geometry: slice,
      targetZoom: this.opts.targetZoom,
      evaluateZoom: (geom) => this.evaluateZoomViaSdk(geom),
      sliceByKm: (_geom, a, b) => sliceMultiLineByDistance(line.geometry, a, b),
    });
    return {
      index: line.subLines.length,
      kmA: fit.accepted.kmA,
      kmB: fit.accepted.kmB,
      bbox: fit.accepted.bbox,
      view: fit.accepted.view,
      segmentIds: [],
      validated: false,
    };
  }

  private evaluateZoomViaSdk(geom: MultiLineString): number {
    const xs = geom.coordinates.flatMap((line) => line.map((p) => p[0]));
    const ys = geom.coordinates.flatMap((line) => line.map((p) => p[1]));
    const bbox: [number, number, number, number] = [
      Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys),
    ];
    this.opts.map.zoomToExtent(bbox);
    return this.opts.map.getZoomLevel();
  }
}
