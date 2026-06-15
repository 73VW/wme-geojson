# Slowup Chain Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge results from chain-by-chain matching into one coherent exportable result set for a slowup line, without depending on chain order in the source geometry.

**Architecture:** Keep per-chain matching independent, then aggregate into a line-level merge state. The merge layer deduplicates by semantic keys (`rowIndex`, `segmentId`, closure window), preserves enough geo anchors for CSV export, and is resilient when MultiLineString sub-lines are unordered.

**Tech Stack:** TypeScript strict, SessionStore snapshots, MatchingSubTab orchestration, buildClosuresCsv, vitest.

---

## Scope

- In scope: persist chain outputs independently, then merge them into one line-level export state.
- In scope: dedupe repeated segments appearing in several chains.
- In scope: merge strategy must not assume geometric chain order.
- In scope: keep existing non-slowup and CSV flows unchanged.
- Out of scope: re-ordering geometry for display/matching, route topology reconstruction, or map-matching improvements.

---

## Why this phase is needed now

Current chain-by-chain flow validates chains sequentially, but `rewindToRow(0)` + reuse of one `SessionStore` can overwrite previous chain closures. This phase introduces an explicit multi-chain aggregate so exports represent the full slowup, not only the last processed chain.

---

## Data model target

Add a line-level structure (stored on `LineEntry`) that survives chain switches:

- `chainMergeState.mode`: `"chain-by-chain" | "single-track"`
- `chainMergeState.chains[]`:
  - `chainId`
  - `status`: `idle | matching | done | skipped | error`
  - `sessionSnapshot` (optional)
  - `matchedGroups`
  - `closuresBySegment`
- `chainMergeState.merged`:
  - `mergedGroups`
  - `mergedClosuresBySegment`
  - `stats` (segments before/after dedupe)

Design rule: the merge output is derived from chain snapshots and can be recomputed deterministically at any time.

---

## Task 1: Introduce pure merge helpers (SDK-free)

**Files:**

- Create: `src/matching/chainMerge.ts`
- Test: `src/__tests__/chainMerge.test.ts`

- [ ] Implement `mergeChainClosures(chains)`:
  - input: per-chain `closuresBySegment`
  - output: merged `closuresBySegment`
  - dedupe identical ranges per (`segmentId`, `rowIndex`, `startISO`, `endISO`)
- [ ] Implement `mergeChainGroups(chains)`:
  - input: per-chain `matchedGroups`
  - output: merged `ClosureRowGroup[]`
  - dedupe by (`rowIndex`, `segmentId`) with deterministic owner choice
- [ ] Add tests:
  - two chains with overlap on same segment/range
  - same segment in different rows (must stay separate)
  - empty chains ignored
  - deterministic output order regardless input chain order

**Acceptance:** merge helpers are pure and fully unit-tested; no SDK imports.

---

## Task 2: Persist chain snapshots in line entry

**Files:**

- Modify: `src/lines/types.ts`
- Modify: `src/ui/subtabs/MatchingSubTab.ts`
- Test: `src/__tests__/MatchingSubTab.test.ts`

- [ ] Add types for chain merge state on `LineEntry`.
- [ ] On each chain completion, persist that chain snapshot (groups + closures + status).
- [ ] Keep backward compatibility when `chainMergeState` is absent.

**Acceptance:** switching lines/tabs keeps chain results accumulated, not replaced.

---

## Task 3: Compute merged state after each chain completion

**Files:**

- Modify: `src/ui/subtabs/MatchingSubTab.ts`
- Use: `src/matching/chainMerge.ts`
- Test: `src/__tests__/MatchingSubTab.test.ts`

- [ ] After a chain reaches done/skip, recompute line-level merged state from all saved chain snapshots.
- [ ] Store merged groups/closures in `LineEntry.chainMergeState.merged`.
- [ ] Ensure recompute is idempotent and independent of completion order.

**Acceptance:** finishing chains in order `2 -> 1 -> 3` yields same merged output as `1 -> 2 -> 3`.

---

## Task 4: Export path uses merged state in chain mode

**Files:**

- Modify: `src/ui/subtabs/MatchingSubTab.ts`
- Optional small adjust: `src/csv/buildClosuresCsv.ts` (only if strict typing helper needed)
- Test: `src/__tests__/MatchingSubTab.test.ts`
- Test (if touched): `src/__tests__/buildClosuresCsv.test.ts`

- [ ] In `getExportClosureGroups` / download flow, branch:
  - chain mode: use merged groups + merged closures from `chainMergeState`
  - existing mode: keep current behavior
- [ ] Add guard: if chain mode active but merge state missing/incomplete, show clear user message.

**Acceptance:** exported closures include segments from all completed chains; existing single-track export unchanged.

---

## Task 5: UI/debug transparency for merge quality

**Files:**

- Modify: `src/ui/subtabs/MatchingSubTab.ts`
- Modify: `locales/en/common.json`
- Modify: `locales/fr/common.json`
- Test: `src/__tests__/MatchingSubTab.test.ts`

- [ ] Add merge summary in debug pane:
  - completed chains / total chains
  - raw segment count vs deduped count
- [ ] Add explicit warning when some chains are not done before export.

**Acceptance:** operator can see whether export is full, partial, and deduped.

---

## Task 6: Unordered-chain resilience tests

**Files:**

- Modify: `src/__tests__/chainMerge.test.ts`
- Modify: `src/__tests__/MatchingSubTab.test.ts`

- [ ] Build fixtures where chains are intentionally out of route order.
- [ ] Assert identical merge result for permuted chain completion orders.
- [ ] Assert deterministic sort of merged outputs for stable exports.

**Acceptance:** merge behavior no longer depends on source chain ordering.

---

## Verification

- `npx vitest run src/__tests__/chainMerge.test.ts src/__tests__/MatchingSubTab.test.ts`
- `npx vitest run src/__tests__/buildClosuresCsv.test.ts` (if touched)
- `npx vitest run`
- `npx tsc --noEmit`

Known baseline allowed: existing `waitForMapIdle.test.ts` type error if still present in branch baseline.

---

## Rollout order

1. Pure merge helpers + tests.
2. Persistence of per-chain snapshots.
3. Recompute merged state after each chain.
4. Wire export to merged state.
5. UI/debug + regression sweep.

**Definition of done:**

- Export after chain-by-chain matching includes cumulative results from all completed chains.
- Duplicate segments/ranges are deduped deterministically.
- Merge output is stable even when chain order in source GeoJSON is chaotic.
- Non-slowup and CSV flows remain unchanged.
