# WME Event Closures — UI overhaul — design

**Date:** 2026-10-05
**Status:** approved in chat, pending spec review

## Goal

Make every view the script adds look and behave like native WME, simplify the
flow, remove design flaws (horizontal scroll, duplicated labels, raw ids), and
add non-destructive step navigation to the matching panel.

## Findings (browser audit, 2026-10-05)

- Sidebar scrolls horizontally: the file button label and "Télécharger le CSV
  de fermetures (secours)" are wider than the 200 px sidebar.
- Script tab label is truncated to "GeoJ".
- The "visible distance" range renders as two stacked sliders.
- "Importer le CSV de planning" appears twice (label + button).
- Linked MTE shows its raw UUID.
- Sidebar status ("En attente") disagrees with the panel ("Terminé").
- The completed panel still says "Validez ou corrigez et validez" and talks
  about downloading the file although "Appliquer" exists.
- The floating matching panel opens on top of the sidebar and hides its
  buttons, even collapsed.
- All dialogs use native browser inputs and grey buttons; `alert()` is used in
  six places.
- Four same-weight buttons stacked with no hierarchy; hard-coded hex colours in
  five files.

## Native WME reference

- Font Rubik; tokens on `body`: `--primary #0099ff`, `--primary_variant`,
  `--content_default/p1/p2/p3`, `--background_default/variant`,
  `--surface_default/variant`, `--separator_default`, `--hairline`,
  `--hairline_strong`, `--alarming(_variant)`, `--cautious(_variant)`,
  `--safe(_variant)`, `--leading_icon`.
- Registered components used here: `wz-button`, `wz-text-input`, `wz-textarea`,
  `wz-select`/`wz-option`, `wz-date-input`, `wz-file-input`, `wz-card`,
  `wz-alert`, `wz-checkable-chip`, `wz-tabs`, `wz-label`, `wz-body2`,
  `wz-caption`, `wz-h4`, `wz-snackbar`.
- Native dialog structure (save dialog):

  ```
  #wz-dialog-container
    wz-dialog size="xs"                    (attrs: size, alignment, dismissible)
      wz-dialog-content
        wz-h4 / wz-body2 / wz-caption
      wz-dialog-controls layout="horizontal-reverse"
        wz-button color="primary"           → main action (right)
        wz-button color="secondary" alarming → cancel/abandon (left, red text)
  ```

- Native MTE form: "Catégorie de l'événement" (`wz-select.category`, SDK type
  `MajorTrafficEventCategory`) and "Niveau de verrouillage" (1–4 buttons).

## Design

### 0. Foundation

- **One stylesheet** (`src/ui/styles.ts`, exported CSS string injected once in
  the WME document and once in the MTE popup window). Only WME tokens, no hex
  except fallbacks. Replaces the inline `<style>` in `MatchPanel`,
  `MatchingSubTab` and the inline `style.*` assignments in views/prompts.
- **Native dialog helper** (`src/ui/components/wzDialog.ts`): builds the
  structure above inside `#wz-dialog-container`, returns a promise; Enter
  triggers the primary action, Esc / alarming button cancels. Fallback to a
  `<dialog>` with the same classes when `wz-dialog` is not registered (tests).
  `confirmModal`, `promptFinalFields`, `promptMteInfo`, `promptClosureWindow`
  are rebuilt on it; `modal.ts` is deleted.
- **Form fields** use `wz-text-input`, `wz-textarea`, `wz-select`,
  `wz-checkbox`, `wz-checkable-chip`. Dates use a native `datetime-local`
  input dressed like a `wz-text-input` (WME's date/time pickers have no
  documented API).
  Helpers added to `wz.ts` next to the existing ones.
- **Text** uses `wz-label` (section titles), `wz-body2`, `wz-caption`.
- **`alert()` removed**: replaced by a single-button native dialog
  (`alertDialog`), same look as every other dialog.
- **No horizontal scroll**: root `min-width: 0; overflow-wrap: anywhere`,
  buttons `max-width: 100%` with short labels, overlay no longer in the
  sidebar flow.

### 1. Name

- Userscript `@name` "WME Event Closures" (dev: "WME Event Closures (dev)"),
  `@description` updated, sidebar tab label "Event Closures", README title.
- Internal prefixes (`wmegj-` CSS classes, storage keys, `@namespace`) are kept
  so persisted sessions survive. Note: changing `@name` makes Tampermonkey treat
  it as a new script; release notes must tell users to remove "WME GeoJSON".

### 2. Lignes tab

- Primary button **"Charger les slowUps"** → loads
  `https://schweizmobil.ch/api/4/slowups.geojson` through the existing
  `loadFn`.
- Section **"Autre source"**: URL `wz-text-input` with an inline load icon
  button; below, the native `wz-file-input` via the existing `fileInput()`
  helper (drag & drop + button, accepts `.geojson,.gpx,.kml,.kmz`, formats in a
  `wz-caption`).
- **Loaded source card**: name (file name, "slowUps" or URL host), line count,
  × to unload. Replaces the file badge, the × inside the URL field and the
  "FeatureCollection (n lignes)" line.
- List header: "n lignes" + recenter-all icon button.
- Rows in native list style (hairline separators, no card borders): colour dot,
  name, slowUp date as a `wz-caption` second line, **progress on the right**
  ("3/8", "✓ Terminé", nothing when not started — from the persisted source
  for that line), small recenter icon.

### 3. Matching tab (sidebar)

- Header: "← Lignes" link, line name, `wz-caption` "30.85 km · <status>". The
  status is derived from the same source as the panel (single function), so
  they cannot disagree.
- Planning CSV through `wz-file-input`; once loaded, a chip "Planning chargé ×".
  Duplicate label removed.
- Resume banner folded into the main button: "Reprendre (ligne 1 / sous-ligne 8)".
- **Dual-thumb range**: two overlapping `input[type=range]` on one track (CSS:
  transparent tracks, thumbs `pointer-events: auto`), km values displayed above.
- **Three numbered steps**, each with ✓ when done; only the next step's button
  is primary:
  1. Correspondance — "Ouvrir la correspondance" / "Reprendre (…)".
  2. MTE — "Préparer le MTE"; when linked, shows the MTE **name** (resolved via
     the SDK, falling back to the id only if unresolvable).
  3. Fermetures — "Appliquer les fermetures dans WME"; "CSV de secours" as a
     link-style button underneath.

### 4. Matching panel

- Opens over the map, right of the sidebar (left = sidebar right edge + 16 px),
  remembers its dragged position for the session; `wz-card`-like elevation.
- Header: title, status caption, collapse, **"⋯" menu** (Debug view, Copier
  debug JSON, Recommencer à zéro — red, native confirm dialog), close.
- Wording depends on state; one primary button per state. The completed text
  mentions applying closures, never the "validate or correct" hint.

#### Step navigation ("editor within the editor")

A _step_ is a sub-line, ordered (lineIndex, subLineIndex) across lines.
Reachable steps: every existing validated sub-line, plus the **frontier** (the
first unvalidated sub-line, i.e. the current cursor). Never beyond the
frontier.

Navigation bar: `‹  Ligne 1 · sous-ligne 3/8 · 9.1 → 14.3 km · ✓  ›`.
`‹` disabled on the first step, `›` disabled on the frontier (or on the last
step when done). Disabled while stepping/bursting/pausePending.

- **On the frontier** the existing flow is unchanged: Valider / Passer, burst
  Pause / Reprendre, automatic chaining.
- **On a validated step** (review): the map is centred on `sub.view`; two
  buttons:
  - **"Sélectionner les segments matchés"** → `Editing.setSelection` with the
    step's stored `segmentIds` (only those loaded).
  - **"Relancer le matching"** → runs matching on the same window (same view,
    same km range) and puts the result in the WME selection. Non-destructive:
    nothing is stored yet, later steps untouched.
- **Dirty edit**: while reviewing, a `wme-selection-changed` listener compares
  the current segment selection to the step's stored ids. When different (after
  "Relancer", or a manual edit in WME), **"Enregistrer" / "Annuler"** appear:
  - Enregistrer → `store.validateSubLine(li, si, currentIds)` (overwrites only
    this step), dirty cleared.
  - Annuler → selection reset to the stored ids, dirty cleared.
  - Navigating (‹ ›, close panel, change line) while dirty asks with a native
    dialog: "Abandonner les modifications ?" (Abandonner / Rester).
- The old destructive actions are removed: `pipeline.back()`,
  `pipeline.rerunCurrent()`, `SourceStore.rerunSubLine()` (if no longer used),
  the "Retour", "Relancer la ligne" and "Resélectionner" buttons.

#### State machine

Extend the existing pure reducer `src/ui/matchingUiState.ts` (not a new flag):

- New state `{ kind: "reviewing"; step: StepRef; dirty: boolean; returnTo:
"waiting" | "done" }`.
- Events: `NAVIGATE { step }` (from `waiting`/`done`/`reviewing`),
  `SELECTION_DIRTY`, `SELECTION_CLEAN` (save or cancel), `RETURN_TO_FRONTIER`
  (navigating › onto the frontier → back to `waiting`; when done →
  `done`), `REMATCH_STARTED` / `REMATCH_READY` (review-local loader).
- `NAVIGATE` while `dirty` is not handled by the reducer: the UI asks first,
  then dispatches `SELECTION_CLEAN` + `NAVIGATE`.
- Button visibility stays a table keyed by state kind.

Pipeline additions (`LazyMatchingPipeline`): `listReachableSteps()`,
`matchStep(step)` (centre + match, returns ids, does not persist). Store
addition: none beyond `validateSubLine`.

### 5. Dialogs

All on the native dialog helper, with `wz-*` fields, Enter submits, Esc
cancels: confirmations, "Fenêtre de fermeture", final fields, "Préparer MTE —
informations de l'événement".

**MTE info dialog additions:**

- **Catégorie de l'événement**: `wz-select` with every
  `MajorTrafficEventCategory`, labels in the UI language; default
  `SPORTING_EVENT`.
- **Niveau de verrouillage**: 1–4 segmented selector like the native form;
  default 1.
- Both are passed to `fillMteForm` (`category` already supported; lock level
  added by clicking `wz-checkable-chip#lockRank-<level-1>`). For slowUps the
  same dialog opens with only these two fields (title, dates and texts come
  from the slowUp API). The "MTE already linked" confirmation now comes before
  this dialog.

### 6. "Préparer MTE" window

Injects the shared stylesheet and the Rubik font link; uses the same
component classes (native `wz-*` elements are not available in the detached
window, so styled plain elements mirroring them).

## Out of scope

- Dark mode (WME has none).
- Changing the matching algorithm.

## Testing

- Unit (vitest): reducer transitions for `reviewing` (navigate, dirty, save,
  cancel, return to frontier, guards while stepping/bursting);
  `listReachableSteps` (never past frontier, across lines); re-validating one
  step leaves the others' ids and later steps intact; line progress summary
  ("3/8", done).
- `npm test`, `npm run lint`.
- Browser pass on every view (Lignes empty/loaded/slowUps, Matching each step,
  panel each state incl. review + dirty, each dialog, MTE window) with the
  sidebar checked for horizontal scroll.

## Delivery

Three batches, each verified in the browser before the next:

- **A** — foundation, dialogs (incl. MTE category + lock level), name.
- **B** — Lignes tab + Matching sidebar.
- **C** — matching panel + step navigation.
