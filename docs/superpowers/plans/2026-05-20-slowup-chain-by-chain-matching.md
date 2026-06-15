# Slowup Chain-by-Chain Matching Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

Goal: Match each slowup chain independently (as if each chain were its own split CSV line), without implementing cross-chain merge yet.

Architecture: Keep the existing MatchingPipeline unchanged for the core matching loop. Add an orchestration layer in MatchingSubTab that runs one guided matching session per chain sequentially on a per-chain track slice. This minimizes risk and allows validation chain-by-chain before implementing merge.

Tech Stack: TypeScript strict, existing matching pipeline, SessionStore, TrackLayer, Vitest.

---

## Scope

- In scope: Guided matching runs chain 1, then chain 2, etc. for selected slowup lines.
- In scope: Visual and debug indicators clearly show active chain index and total chain count.
- In scope: Persist/restore must keep chain progression when user pauses or changes selection.
- Out of scope: Merging matched segments across chains into final multi-chain consolidation logic.
- Out of scope: Reworking CSV semantics for imported schedules.

## Assumptions to validate before coding

- Primary target is synthetic mode for slowup lines (no imported CSV).
- Existing CSV mode keeps current behavior for now.
- Chain boundaries are defined by MultiLineString sub-lines as currently loaded in the line track.

---

## Task 1: Introduce explicit chain model (pure, SDK-free)

Files:

- Create: src/matching/chainTracks.ts
- Test: src/**tests**/chainTracks.test.ts

Plan:

- Add pure helpers to enumerate chains from a MultiLineString track.
- Expose deterministic chain ids: chain-0, chain-1, etc.
- Compute per-chain length in km with existing distance math.
- Return chain metadata: index, id, geometry (single sub-line wrapped as MultiLineString), lengthKm.

Acceptance:

- For a 3-subline track, helper returns exactly 3 chains in original order.
- Empty/degenerate sub-lines are ignored consistently.
- Unit tests cover order, id stability, and length sanity.

---

## Task 2: Add chain-session orchestrator in MatchingSubTab

Files:

- Modify: src/ui/subtabs/MatchingSubTab.ts
- Test: src/**tests**/MatchingSubTab.test.ts

Plan:

- Add a small orchestrator that drives one pipeline per chain sequentially.
- For each chain, instantiate SessionStore + MatchingPipeline with that chain geometry.
- Reuse existing guided controls (validate/skip/back/pause), but scoped to active chain.
- Move to next chain only when current chain is completed or skipped.
- Keep non-slowup behavior unchanged.

Acceptance:

- Slowup line with N chains opens guided flow and processes exactly N chain sessions in order.
- Abort/pause/resume work at chain level without losing already validated previous chains.
- Existing single-track flow remains unchanged for non-slowup lines.

---

## Task 3: UI/debug state for chain progress

Files:

- Modify: src/ui/subtabs/MatchingSubTab.ts
- Modify: locales/en/common.json
- Modify: locales/fr/common.json
- Test: src/**tests**/MatchingSubTab.test.ts

Plan:

- Add chain progress text in guided header: Chain X/Y.
- Add debug block listing per-chain status: idle, matching, done, skipped, paused.
- Extend debug export payload with chain context (activeChainIndex, chainCount, chainSummaries).

Acceptance:

- Operator always sees current chain position.
- Debug copy contains enough context to reproduce chain-level issues.

---

## Task 4: Persistence and restore for chain-by-chain progress

Files:

- Modify: src/lines/types.ts
- Modify: src/ui/subtabs/MatchingSubTab.ts
- Optional modify: src/state/SessionStore.ts (only if needed)
- Test: src/**tests**/MatchingSubTab.test.ts

Plan:

- Persist chain orchestration snapshot in line entry session data:
  - activeChainIndex
  - perChainSession snapshots (if available)
  - perChainMatchedGroups
- On re-open/resume, restore to the same chain and same row in that chain.
- Keep backward compatibility: old session data (without chain fields) still loads.

Acceptance:

- User can switch tabs/lines and resume exactly where left off in chain flow.
- Old sessions do not crash and continue with fallback behavior.

---

## Task 5: Guardrails and compatibility behavior

Files:

- Modify: src/ui/subtabs/MatchingSubTab.ts
- Test: src/**tests**/MatchingSubTab.test.ts

Plan:

- Feature flag behavior by conditions, not global config:
  - Enable chain-by-chain only when selected line is slowup and in synthetic mode.
  - Keep CSV imported mode on current pipeline path.
- Add clear operator message when chain-by-chain mode is active.

Acceptance:

- No regression for non-slowup and CSV flows.
- Chain-by-chain activates only in intended context.

---

## Task 6: Test matrix and verification

Files:

- Modify: src/**tests**/MatchingPipeline.test.ts (only if chain-context hooks are added)
- Modify: src/**tests**/MatchingSubTab.test.ts
- Modify: src/**tests**/TrackLayer.test.ts (if needed for chain overlays)

Plan:

- Add tests for:
  - Sequential chain execution order.
  - Pause/resume during chain K keeps K context.
  - Back action at first row of chain K does not corrupt K-1 state.
  - Skip entire chain path moves to K+1 cleanly.
  - Final completion event emitted only after last chain.
- Run focused tests then full suite.

Verification commands:

- npx vitest run src/**tests**/chainTracks.test.ts src/**tests**/MatchingSubTab.test.ts
- npx vitest run
- npx tsc --noEmit

---

## Rollout strategy (incremental)

- Step A: Deliver chain model + unit tests.
- Step B: Deliver orchestration for synthetic slowup only, with minimal UI text.
- Step C: Deliver persistence + debug enrichment.
- Step D: Stabilization and regression sweep.

Definition of done for this phase:

- A slowup with multiple chains can be matched end-to-end chain-by-chain in guided mode.
- Each chain can be validated independently.
- No merge logic is implemented yet.
- Existing non-slowup and CSV flows are preserved.
