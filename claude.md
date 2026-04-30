# WME-geojson — repo conventions for AI agents

This file describes the coding conventions, design philosophy, and operational guardrails for this repository. **Read this before making any non-trivial change.** Conventions here override defaults from training data.

## Project context

`WME-geojson` is a userscript for the Waze Map Editor (WME). It loads a GeoJSON track from a URL passed as a query parameter, displays it on the map, walks the map programmatically to load segments along the track, and lets the user select Waze segments matching the track.

The script is written in TypeScript, bundled with Rollup, distributed as a Tampermonkey-compatible userscript.

The project is built incrementally in **paliers** (stages). Each palier is independently shippable and testable. Do not implement features from a future palier when working on the current one — even if the temptation is strong, even if "you'll need it anyway." Premature implementation creates risk and noise.

## Tech stack invariants

- TypeScript strict mode
- Rollup as bundler (mirror `WME-Switzerland-Helper`'s rollup config style)
- `@turf/turf` for geometry operations — never reimplement what turf does
- `wme-sdk-typings` for SDK types — every SDK call must be typed
- `i18next` + `i18next-parser` for i18n
- `vitest` for unit tests
- `eslint` flat config + `prettier`
- `GM.xmlHttpRequest` for any external HTTP fetch (CORS bypass, userscript context)

The user's other repo `WME-Switzerland-Helper` is the reference for build pipeline, header structure, and overall layout. Mirror it when in doubt.

## SDK usage rules

- Verify SDK method signatures via the `context7` MCP server (Waze Editor SDK doc, `waze_editor_sdk`) before using them. The SDK is evolving; do not rely on training data or external WME script examples.
- Use `unsafeWindow.SDK_INITIALIZED` (since `@grant unsafeWindow` is set).
- Wait for the `wme-ready` event before calling any data model method.
- For map-data-dependent operations, also wait for `wme-map-data-loaded`.
- Segments and other data model objects are scoped to the current viewport. `Segments.getAll()` returns only what is currently loaded, never all segments worldwide.

## Code style — readability first

This codebase optimizes for **human cognitive load**, not for cleverness or terseness. Concrete rules:

### Conditions and variables

Extract complex boolean expressions into named variables. Working memory is ~4 items; nested conditions blow that budget.

```ts
// Avoid
if (segment.roadType === ROAD_TYPE.PRIMARY && (segment.isAtoB || segment.isBtoA) && !segment.hasRestrictions && permissions.canEdit) { ... }

// Prefer
const isPrimaryRoad = segment.roadType === ROAD_TYPE.PRIMARY;
const isBidirectional = segment.isAtoB || segment.isBtoA;
const isUnrestricted = !segment.hasRestrictions;
const userCanEdit = permissions.canEdit;

if (isPrimaryRoad && isBidirectional && isUnrestricted && userCanEdit) { ... }
```

### Early returns

Prefer early returns and guard clauses over nested `if` blocks. The happy path stays at the lowest indentation level.

### Comments

- Write **why**, not **what**. The code already says what.
- Acceptable: intent, constraints, historical context, non-obvious tradeoffs, links to relevant SDK docs or issues.
- Unacceptable: restating what the next line does, comments that drift out of date.
- A comment summarizing the purpose of a function or module at one level of abstraction higher than the code is welcome.

### Functions and modules

- Prefer composition over deep inheritance.
- Avoid superficial abstractions: don't introduce a base class for two implementations that share three lines. Wait for the third concrete case before extracting.
- Avoid factory-of-factory naming (`MetricsProviderFactoryFactory`). Names should describe what the thing is, not its architectural pedigree.
- Prefer **deep modules**: a small, simple interface backed by rich implementation. A module that exposes 12 functions doing trivial things is usually wrong.

### Duplication vs dependency

Follow DRY, but accept light duplication if the alternative is a forced shared dependency between modules that should otherwise stay independent. Two five-line copies of similar code, in modules that have no other reason to know about each other, is fine. Couple them only when the shared logic grows or diverges.

### Explicit values

Prefer explicit constants over implicit conventions. `ZOOM_LEVEL_FOR_SEGMENTS = 17` is better than a magic `17` scattered across files.

### Linear thinking

Excess abstraction layers force readers to mentally jump between files. Prefer linear, sequential code when the logic is naturally linear. Save abstractions for things that genuinely vary.

## Module organization

- `src/geojson/`: parsing, normalization, validation of incoming GeoJSON. **No SDK calls.** Pure functions where possible.
- `src/matching/`: geometry computations, grid walk planning, segment matching. **No SDK calls.** Pure, testable.
- `src/layers/`: thin wrappers over `wmeSDK.Map.addLayer` / `addFeaturesToLayer`.
- `src/controller/`: the only place that wires SDK + matching + UI together. State machines, orchestration.
- `src/ui/`: presentation only. Receives events from controllers, renders DOM. No business logic.
- `src/utils/`: cross-cutting helpers. Keep thin. If a util file grows past ~100 lines, it probably wants its own module.

The boundary that matters most: **`geojson/` and `matching/` must remain SDK-free**, so they can be tested in plain Node without mocking WME. Any temptation to import from the SDK in those folders is a smell.

## Error handling

- Fail loud and early. A descriptive thrown error beats a silent wrong result.
- Custom error classes (`TrackLoadError`, `WalkAbortedError`, etc.) carry intent better than plain `Error`.
- `try/catch` blocks must do something meaningful in the catch — log with context, transform the error, or rethrow. Never swallow.
- `console.error` is acceptable for unrecoverable scripting errors. User-facing errors go through the UI.

## Performance principles

- Don't optimize prematurely. Write the obvious version first.
- For `O(N×M)` geometry tests on >1000 elements, consider an `rbush` spatial index — `WME-Switzerland-Helper` has the pattern.
- `Segments.getAll()` can be expensive in dense areas. Cache geometries you've already seen if the controller will revisit them.
- Avoid rendering loops that block the UI thread. Yield with `await new Promise(r => setTimeout(r, 0))` between batches.

## Tests

- Pure modules (`geojson/`, `matching/`) get unit tests with vitest.
- Test the **contract**, not the implementation: input fixture in, expected output checked. Refactors should not break tests.
- Use realistic fixtures — synthesize them from real API payloads, scrubbed if needed.
- Don't mock the SDK. If a test needs the SDK, it doesn't belong in this layer.

## Unix commands and CLI

When proposing or running shell commands:

- Use long-form options (`--silent`, not `-s`). Self-documenting.
- Briefly state what each flag does.
- Flag destructive commands explicitly.
- Indicate if a command is long-running, blocking, or interactive.

## Git and commits

- Commit messages: present tense, imperative ("Add Loader normalize logic", not "Added"). Conventional Commits prefixes welcome (`feat:`, `fix:`, `chore:`, `test:`, `docs:`).
- Keep commits small and self-describing. A reviewer should understand each commit independently.
- Never commit to a branch named `main` or `master` directly without confirmation.

## Working with the user

- The user is a senior software engineer / DevOps with deep Python and infrastructure experience. They prefer reasoning out loud over jumping to solutions.
- When you're unsure, ask. The user prefers a question over a wrong assumption.
- When you make a non-trivial design decision implicitly, surface it: "I chose X because Y; happy to switch if you'd prefer Z."
- Prefer small reviewable steps. Land Palier 1 before starting Palier 2.

## Anti-patterns to actively avoid

- Hidden side effects in module top-level code (script imports should be safe; only `main.user.ts` triggers behavior).
- "Helper" or "utility" classes with static methods. Prefer free functions.
- Global mutable state. Pass dependencies explicitly.
- Magic strings for SDK event names — import from typings.
- TypeScript `any` (use `unknown` and narrow).
- Premature i18n of internal-only strings (logs, internal errors). Only externalize what users will see.

## Questions to surface to the user (do not guess)

- A new external API integration (cookies, auth, rate limits).
- Behavior on edge cases not covered by the brief (empty track, track outside the WME viewport, track too long).
- Performance regressions or measurements above ~50 ms for a hot path.
- Any deviation from `WME-Switzerland-Helper`'s established patterns.
