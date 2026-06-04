# Préparation et liaison d'un MTE à un slowup

**Date :** 2026-06-04
**Status :** Design approuvé, prêt pour planification d'implémentation

## Contexte

Un slowup matché donne lieu à un CSV de fermetures. Pour que ces fermetures
soient liées à un événement Waze (Major Traffic Event, MTE), il faut un MTE
sur la carte dont l'ID est repris dans la colonne « MTE ID » du CSV.

Le SDK Waze (`SDK.MajorTrafficEvents`) **ne permet pas** de créer un MTE — un
éditeur doit le créer manuellement dans WME. Et il se peut que la zone soit
trop grande pour qu'un éditeur non-staff puisse en créer un (limite serveur).

Ce design ajoute :

1. Une popup qui rassemble les infos nécessaires à la création manuelle d'un
   MTE (titre, date, abstracts FR/EN/DE/IT, lien `urlLink`) sous une forme
   facile à copier-coller dans le formulaire de création de MTE de WME.
2. Une auto-détection de l'ID MTE si un MTE déjà créé porte le bon
   `urlLink`, avec fallback liste cliquable de candidats géo+date.
3. Une persistance `localStorage` par `refid` de slowup pour que l'ID retrouvé
   soit pré-rempli automatiquement dans le dialogue d'export CSV
   (`promptFinalFields`).

## Décisions clés (issues du brainstorming)

- **Granularité :** 1 MTE par slowup. Le même ID est réutilisé pour toutes
  les lignes lors de l'export.
- **Emplacement du bouton :** panneau Matching (`MatchingSubTab`), à côté de
  l'export CSV. Indépendant de l'avancement du matching.
- **Stratégie de matching MTE → slowup :**
  1. URL exacte : `mte.urlLink === slowup.urlLink`
  2. Fallback : liste cliquable de candidats dont la bbox intersecte la
     bbox du slowup et dont `[startDate, endDate]` couvre `slowup.date`.
- **Capture de l'ID MTE :** combo auto-détection (re-scan SDK sur clic
  « rafraîchir ») + champ libre éditable (override manuel).
- **Persistance :** `localStorage` sous une clé unique du plugin, mappant
  `refid → mteId`.
- **Layout abstracts :** 4 blocs empilés (FR/EN/DE/IT), un bouton « copier »
  par bloc.

## Architecture

### Nouveau module `src/mte/`

```
src/mte/
  mteStore.ts        // localStorage map { [refid]: mteId }
  mteResolver.ts     // Pur : byUrl(), candidatesByBbox()
  mteSdk.ts          // Adapter SDK : listMtes() → MteRef[]
  index.ts           // Barrel d'export
```

### Modifications de l'existant

| Fichier | Changement |
| --- | --- |
| `src/lines/types.ts` | Ajout du type `SlowupFullDetails` (étend `SlowupDetails` avec `urlLink` + `abstracts.{fr,en,de,it}`). |
| `src/lines/slowupClient.ts` | Ajout `fetchSlowupFullDetails(refid)` : 4 fetches `?lang=xx` en parallèle (`Promise.all`), extrait `abstract` et `urlLink` de chaque réponse. |
| `src/ui/MtePreparePopup.ts` | Nouveau : DOM popup, lazy-load des 4 langs à l'ouverture, intègre store + resolver + SDK. |
| `src/ui/subtabs/MatchingSubTab.ts` | Ajout du bouton « Préparer MTE » à côté de l'export CSV. |
| `src/ui/promptFinalFields.ts` | Pré-remplissage du champ MTE ID depuis `mteStore.get(refid)` quand `defaults.mteId` est absent. Accepte un `refid?` en options. |

### Tableau des responsabilités

| Module | Rôle | Dépend de |
| --- | --- | --- |
| `mteStore` | Persistance localStorage `refid → mteId`. API : `get`, `set`, `clear`. | Rien (pur). |
| `mteResolver` | Logique pure de matching : `byUrl(mtes, urlLink)` et `candidatesByBbox(mtes, slowupBbox, date)`. | Rien (pur). |
| `mteSdk` | Adapter Waze SDK : `listMtes()` renvoie `MteRef[]` normalisés. | Runtime Waze. |
| `MtePreparePopup` | DOM popup, état (loading/loaded/error), intègre les autres. | `mteStore`, `mteResolver`, `mteSdk`, `slowupClient`. |
| `MatchingSubTab` | Expose le bouton « Préparer MTE ». | `MtePreparePopup`. |
| `promptFinalFields` | Pré-remplit le champ MTE ID. | `mteStore`. |

## Modèle de données

### `SlowupFullDetails`

```ts
export interface SlowupFullDetails {
  refid: number;
  title: string;
  date: string;                        // "YYYY-MM-DD"
  urlLink: string;                     // vérifié identique entre les 4 langs, FR fait foi en cas de divergence
  abstracts: {
    fr: string;
    en: string;
    de: string;
    it: string;
  };
}
```

L'existant `SlowupDetails` (`refid`/`title`/`date`) reste inchangé. C'est ce
qu'on charge eagerly. `SlowupFullDetails` est récupéré uniquement à
l'ouverture de la popup.

### `MteRef` (forme normalisée renvoyée par `mteSdk`)

```ts
interface MteRef {
  id: string;
  name: string;
  urlLink: string | null;
  bbox: [number, number, number, number];   // [minLon, minLat, maxLon, maxLat]
  startDate: string;                        // ISO
  endDate: string;                          // ISO
}
```

La forme exacte renvoyée par `SDK.MajorTrafficEvents` sera vérifiée et
mappée à l'implémentation dans `mteSdk.ts`.

### Persistance `localStorage`

```
localStorage["wme-geojson:mte-by-refid"] = JSON.stringify({
  "12345": "987654",
  "12348": "987700",
})
```

API publique :

```ts
mteStore.get(refid: number): string | undefined
mteStore.set(refid: number, mteId: string): void   // "" => clear
mteStore.clear(refid: number): void
```

## Flow de résolution

À l'ouverture de la popup :

1. **Fetch lazy** des 4 langs en parallèle via
   `slowupClient.fetchSlowupFullDetails(refid)`.
2. **Scan SDK** via `mteSdk.listMtes()`.
3. **Priorité de pré-remplissage du champ MTE ID :**
   1. `mteStore.get(refid)` si présent → badge « depuis localStorage ».
   2. Sinon `mteResolver.byUrl(mtes, urlLink)` → badge « auto-détecté (URL) ».
   3. Sinon vide, et on affiche `mteResolver.candidatesByBbox(...)` comme
      liste cliquable.
4. **Override manuel** : le champ MTE ID est toujours éditable. Toute
   modification (saisie OU clic candidat OU auto-détection) déclenche
   `mteStore.set(refid, value.trim())`. Vide ⇒ `clear(refid)`.
5. **Bouton « rafraîchir »** : re-scan SDK et re-tente la résolution URL
   (utile juste après création manuelle du MTE).

## Maquette popup

```
┌─ Préparer MTE ────────────────────────── ✕ ┐
│ SlowUP Hochrhein                  [copier] │
│ Date : 2026-06-21                 [copier] │
│ URL  : https://schweizmobil...    [copier] │
│ ─────────────────────────────────────────  │
│ Abstract FR                       [copier] │
│ ┌────────────────────────────────────────┐ │
│ │ ...                                    │ │
│ └────────────────────────────────────────┘ │
│ Abstract EN                       [copier] │
│ Abstract DE                       [copier] │
│ Abstract IT                       [copier] │
│ ─────────────────────────────────────────  │
│ MTE ID  ┌──────────┐  [rafraîchir]         │
│         │ 987654   │  ✓ auto (URL match)   │
│         └──────────┘                       │
│ Candidats (si aucun match auto) :          │
│  • [#876543] SlowUp Hochrhein 2026 (87%)   │
│  • [#876912] Velo-Sonntag (52%)            │
└────────────────────────────────────────────┘
```

## Intégration UI

### `MatchingSubTab` — bouton

- Placement : juste à côté du bouton d'export CSV (voir
  `downloadClosures` aux alentours de la ligne 1944).
- i18n : `panel.matching.prepareMte` → « Préparer MTE ».
- Activé ssi un slowup est sélectionné **et** que `slowupDetails.refid` est
  connu. Sinon disabled + tooltip explicatif.
- Indépendant de l'état du matching (utilisable avant/pendant/après).
- Au clic : ouvre la popup (singleton, ferme la précédente si rouvert).

### `promptFinalFields` — défaut MTE ID

```ts
// AVANT
mteIdInput.value = defaults?.mteId ?? "";

// APRÈS
mteIdInput.value = defaults?.mteId ?? (refid ? mteStore.get(refid) ?? "" : "");
```

Le `refid` est ajouté aux options de `promptFinalFields`. `MatchingSubTab`
le passe depuis le slowup sélectionné. Si pas de `refid` (cas legacy
non-slowup), le comportement reste inchangé (champ vide par défaut).

## Erreurs et edge cases

| Cas | Comportement |
| --- | --- |
| Pas de `slowupDetails` chargé (fetch initial KO ou en cours) | Bouton disabled + tooltip. |
| 1+ lang KO au fetch popup | Affiche les abstracts dispo + bloc d'erreur inline pour les KO + bouton « réessayer ». La popup reste utilisable. |
| `urlLink` différent entre langs | `slowupClient` vérifie, garde FR comme référence, log warning. |
| `SDK.MajorTrafficEvents` indisponible | `mteSdk.listMtes()` renvoie `[]`. Popup affiche « Aucun MTE détecté » + bouton rafraîchir. Champ MTE ID reste éditable. |
| Aucun candidat URL ni géo | Section candidats vide ; saisie manuelle reste possible. |
| MTE auto-détecté mais `mteStore` contient déjà un ID différent | On garde la valeur du store + badge « override manuel ». Pas d'écrasement silencieux. |
| `localStorage` indisponible / quota plein | `mteStore.set` log + no-op silencieux ; la session continue en mémoire. |
| Slowup sans `refid` (legacy) | Bouton disabled. |
| MTE ID vide à la sortie | `mteStore.clear(refid)`. Le défaut redevient l'auto-détection au prochain run. |

## Tests

| Cible | Type | Outils | Couverture |
| --- | --- | --- | --- |
| `mteStore` | Unit | vitest + mock `localStorage` | get/set/clear, quota plein, JSON corrompu, multi-refid. |
| `mteResolver` | Unit (pur) | vitest | `byUrl` : match exact, URL absente, URL différente. `candidatesByBbox` : aucun match, bbox tangente, dates hors fenêtre, tri overlap. |
| `slowupClient` | Unit | vitest + mock `GM.xmlHttpRequest` | `fetchSlowupFullDetails` : 4 succès, 1 lang KO, urlLinks divergents, refid invalide. |
| `mteSdk` | — | — | Trop couplé au runtime Waze ; testé manuellement. |
| `MtePreparePopup` | — | — | DOM popup ; smoke testé en navigateur, cohérent avec le reste de `src/ui/`. |
| `MatchingSubTab` | Intégration légère | vitest | Bouton disabled quand pas de slowup, enabled sinon (sans tester l'ouverture). |
| `promptFinalFields` | Unit | vitest | Pré-remplissage MTE ID depuis store quand `defaults.mteId` absent. |

**Vérification finale avant claim "done" :** `npm test` propre + `npm run
compile` propre + smoke manuel dans WME (charger un slowup connu, ouvrir
popup, vérifier les 4 abstracts + URL match + persistance après reload).

## Hors-scope

- Création du MTE via le SDK (impossible — SDK ne l'expose pas).
- Plusieurs MTE par slowup (chevauchement, découpage géographique).
- Push automatique de l'ID auto-détecté vers le serveur ou vers une autre
  source de vérité.
- UI pour gérer/lister/effacer tous les mappings `refid → mteId` persistés.
