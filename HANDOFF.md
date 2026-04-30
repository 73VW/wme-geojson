# WME-geojson — Handoff pour le matching de segments

> **Audience.** Ce document s'adresse à Copilot (ou tout agent qui reprend
> le projet). Il résume ce qui fonctionne aujourd'hui, l'architecture, les
> pièges connus du SDK Waze, et le plan utilisateur pour la prochaine
> étape (matching des segments).
>
> ⚠️ **Refactor en cours (avril 2026).** Une refonte CSV-driven closures
> pipeline est en route. Lis [REFACTOR_PROGRESS.md](REFACTOR_PROGRESS.md)
> EN PREMIER — il documente l'état actuel de cette refonte (Lots 0–5
> mergés, Lot 6 release manuelle restante) et la procédure de reprise
> pour n'importe quelle IA. Ce document HANDOFF.md décrit la version
> 0.9.0 stable d'avant-refonte ; il sera mis à jour quand la 0.10.0
> sera taggée.
>
> Lis aussi `claude.md` (conventions de code) et `prd.md` (spec d'origine
>
> - Hypothesis Changelog avec tous les SDK quirks découverts palier après
>   palier).

---

## 1. État actuel — version `0.9.0`

Le userscript est installable depuis `releases/release-0.9.0.user.js`.
Toutes les commandes ci-dessous passent vert :

```bash
npm install
npm run lint     # eslint flat config + prettier
npm test         # vitest, 40 tests
npm run build    # rollup -> .out/main.user.js -> releases/release-X.Y.Z.user.js
npx tsc --noEmit # vrai type-check (rollup-plugin-typescript est tolérant)
```

**Toujours faire `npx tsc --noEmit` avant de commit.** `npm run build`
peut compiler des erreurs TS silencieusement.

### Ce qui fonctionne

- **Chargement track GeoJSON** depuis le query-param `?geojson=<url>`
  (URL SchweizMobil testée). Validation CRS WGS84, normalisation
  `LineString | MultiLineString`, garde 3D dans `NormalizedTrack` mais
  strippe en 2D au moment d'envoyer au SDK (le SDK refuse les coords 3D
  avec « Only 2D points are supported »).
- **Affichage du track** sur un layer `wme-geojson-track` (magenta 4px).
- **Labels distance cumulée** à chaque vertex, avec dedup par bucket
  100 m (l'utilisateur a fait un minifix sur `filterLabels` pour ne
  garder qu'un label par bucket — préserve cette sémantique).
- **Slider de plage** (deux poignées) qui clippe le track entre
  `[minKm, maxKm]` en temps réel, throttlé via `requestAnimationFrame`.
- **Filtre par liste de distances** : textarea collable
  (`0.5, 1.2, 3.4` ou newline ou tab), n'affiche que les labels dont la
  distance arrondie aux 100 m est dans la liste. Compose avec le slider
  en intersection.
- **Vues bbox** : bouton « Calculer les vues » qui, pour chaque portion
  `[d_i, d_{i+1}]` (la dernière allant à `totalKm`), navigue la carte
  via `Map.zoomToExtent`, lit `getZoomLevel`, et bisecte récursivement
  si zoom < 15 (cap profondeur 8). Boutons résultants `Vue pour 1.2 km`
  ou `Vue X pour 1.2 km` qui re-naviguent via `Map.setMapCenter`.
- **Walk + matching segments (palier 3)** : `WalkController.start()`
  parcourt une grille de cellules, fetch les segments via
  `DataModel.Segments.getAll()`, match géométriquement contre le track
  buffé. Liste cliquable, `Editing.setSelection`, modal pour
  sélections > 200. **Ce code existe mais le matching est imparfait
  sur les tracks réels** — c'est la raison du redesign en cours.

### Commits récents (master)

```
03d30a0  feat: waypoint distance filter and bbox views
1b1b50f  perf(slider): collapse styleRules and throttle redraws to rAF
6a3b6ba  feat: distance labels along the track + visible-range slider
20fea4c  fix(track): strip 3D coords before passing to SDK
```

---

## 2. Architecture — invariants à respecter

```
main.user.ts              entry point, only top-level side effect
├── controller/           orchestration, state machines, SDK + matching
├── ui/                   présentation, DOM, écoute les events controller
├── layers/               wrappers minces sur Map.addLayer / addFeatureToLayer
├── matching/   ← PUR     turf only, pas de SDK ni de DOM, testable en Node
├── geojson/    ← PUR     parse/normalize/validate, idem
└── utils/                helpers, dont 2 fichiers SDK-coupled
                          (waitForMapIdle, measureViewport)
```

**Règle dure :** `src/matching/` et `src/geojson/` n'importent **rien**
de `wme-sdk-typings`, ni `window.*`, ni `document.*`. Si tu as besoin
d'une fonction qui mélange SDK et logique pure, splitte : la partie
pure va dans `matching/`, le glue SDK vit dans le caller.

Le test rapide :

```bash
grep -lE "wme-sdk-typings|window\.|document\." src/matching/ src/geojson/ -r
# doit ne renvoyer que des matches dans les commentaires.
```

### Conventions clés (résumées de `claude.md`)

- **Pas de `any`.** Utiliser `unknown` + narrowing.
- **Constantes nommées** (`MIN_BBOX_ZOOM = 15`, `LARGE_SELECTION_THRESHOLD = 200`).
- **Comments « why », pas « what ».**
- **Early returns**, pas de nesting profond.
- **Pas d'effets de bord top-level** sauf `unsafeWindow.SDK_INITIALIZED.then(initScript)`.
- **i18n** : toutes les strings UI passent par `i18next.t(...)`. FR + EN.

---

## 3. SDK Waze — pièges déjà découverts

Voir `prd.md` section 1.11 « Hypothesis changelog » pour le détail
horodaté. Résumé exécutif :

| Quirk                                                                     | Comment ça se manifeste                                     | Solution                                                                                                                           |
| ------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------- |
| `context7` MCP n'indexe pas `wme-sdk-typings`                             | Recherches docs vides                                       | Lire `node_modules/wme-sdk-typings/index.d.ts` directement                                                                         |
| `SdkFeatureGeometry` = `Point                                             | LineString                                                  | Polygon`                                                                                                                           | Pas de MultiLineString | Décomposer en N LineStrings dans le layer |
| `FeatureStyle.label` = `string`, pas context-keyed                        | Labels per-feature impossibles via styleRules avec prédicat | Utiliser `styleContext: { getLabel: ({feature}) => ... }` + `style.label = "${getLabel}"`. Documenté dans les exemples des typings |
| `addFeatureToLayer` rejette les coords 3D                                 | Crash « Only 2D points are supported »                      | Stripper la 3e dim avant envoi                                                                                                     |
| Pas de `Map.fitBounds`                                                    | —                                                           | `Map.zoomToExtent({ bbox })` est l'équivalent                                                                                      |
| `Map.zoomToExtent` ne prend qu'un BBox `[minLon, minLat, maxLon, maxLat]` | —                                                           | `turf.bbox` produit ce format directement                                                                                          |
| `Editing.setSelection` est sync, accepte `ids: number[]` arbitraire       | —                                                           | `try/catch` quand même autour, le SDK peut throw sur dense selection                                                               |
| `DataModel.Segments.findSegment` est **async**                            | Returns `Promise<Segment>`                                  | `await` requis                                                                                                                     |
| `wme-selection-changed` payload = `undefined`                             | —                                                           | Lire `Editing.getSelection()` au déclenchement                                                                                     |
| `LonLat` shape = `{ lon, lat }` (pas `lng`)                               | —                                                           | Attention aux objets venant d'autres SDK                                                                                           |
| `Segments.getAll()` viewport-scoped                                       | Ne retourne que les segments à zoom 17+ et dans le viewport | C'est toute la raison du grid-walking                                                                                              |
| `State.isMapLoading()` existe et est fiable                               | —                                                           | `waitForMapIdle` poll 100 ms avec timeout 10 s soft (resolve, pas reject)                                                          |
| `Sidebar.registerScriptTab()` retourne `{ tabLabel, tabPane }`            | `HTMLElement` déjà mountés                                  | `textContent` directement                                                                                                          |

---

## 4. Plan utilisateur — matching par vue

### Idée

À côté de chaque bouton de vue (`Vue pour 1.2 km`, `Vue X pour 1.2 km`),
ajouter un **second bouton** qui lance le matching uniquement pour les
segments Waze visibles dans cette vue.

```
[ Vue pour 1.2 km ] [ Match ]   lon=7.05464&lat=46.17835
[ Vue 1 pour 3.4 km ] [ Match ] lon=7.06120&lat=46.18012
[ Vue 2 pour 3.4 km ] [ Match ] lon=7.06340&lat=46.18105
```

### Pourquoi c'est mieux que le walking actuel

Le `WalkController` actuel parcourt une grille sur **toute la longueur**
du track, ce qui :

1. Prend du temps (déplacements + idle entre chaque cellule).
2. Match plein de segments parallèles non pertinents (chemins
   parallèles aux routes du track).
3. Ne profite pas de la connaissance utilisateur (les distances saisies
   correspondent à des waypoints d'un roadbook).

Le matching par-vue exploite directement les zones d'intérêt déclarées
par l'utilisateur. La portion track entre `d_i` et `d_{i+1}` est
restreinte ; les segments Waze à matcher dans cette zone sont peu
nombreux.

### Workflow attendu

1. L'utilisateur clique « Calculer les vues » → liste de boutons s'affiche.
2. L'utilisateur clique « Match » sur une vue précise.
3. Le script :
   - Navigue à la vue (`setMapCenter` avec center + zoom mémorisés).
   - `await waitForMapIdle(wmeSDK)`.
   - Lit `wmeSDK.DataModel.Segments.getAll()` (segments du viewport actuel).
   - Slice le track sur la portion correspondante via
     `sliceMultiLineByDistance` (déjà dispo dans
     [src/matching/trackPortions.ts](src/matching/trackPortions.ts)).
   - Buffe le slice (`turf.buffer`, ~15 m).
   - Match géométrique via `matchSegments` déjà dispo dans
     [src/matching/SegmentMatcher.ts](src/matching/SegmentMatcher.ts).
   - Ajoute les IDs trouvés à un Set global de matches, et au DOM
     (liste des résultats existante).
4. Optionnel : un bouton « Match all views » qui itère sur toutes les vues.

### Composants à réutiliser

| Composant                      | Chemin                             | Rôle                                                                             |
| ------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------- |
| `sliceMultiLineByDistance`     | `src/matching/trackPortions.ts`    | Déjà testé, slice un MultiLineString sur `[kmA, kmB]`                            |
| `matchSegments`                | `src/matching/SegmentMatcher.ts`   | Pure, `turf.booleanIntersects` segment vs buffered track                         |
| `waitForMapIdle`               | `src/utils/waitForMapIdle.ts`      | Poll `State.isMapLoading()`                                                      |
| `WalkController.geometryCache` | `src/controller/WalkController.ts` | Map<id, LineString> à alimenter pour que le clic-pour-recadrer (Palier 4) marche |
| `MatchPanel.appendResultItem`  | `src/ui/MatchPanel.ts`             | Ajoute un `<li>` avec bouton de sélection au DOM existant                        |
| `WalkController.matchedIds`    | `src/controller/WalkController.ts` | Set des IDs match accumulés                                                      |
| `WalkController.selectAll`     | `src/controller/WalkController.ts` | Sélectionne tous les `matchedIds` via `Editing.setSelection`                     |

### Composants probablement à modifier / ajouter

- **`WalkController`** : ajouter une méthode `matchInCurrentViewport(portionKmA, portionKmB)`
  qui fait le slice + buffer + match + cache + emit. Réutilise la même
  logique que la boucle de cellule du `runWalk()` actuel.
- **`MatchPanel`** : dans la fonction qui rend les boutons de vue (cherche
  `viewButton` / `viewButtonIndexed` dans `runBboxProcess`), ajouter un
  second bouton à côté avec class `match-btn`. Le clic appelle
  `controller.matchInCurrentViewport(portion.kmA, portion.kmB)` après
  avoir navigué via `setMapCenter`.
- **State** : la portion (kmA, kmB) doit être stockée sur chaque
  `RecordedView` interne pour que le bouton match sache quel slice
  utiliser. Ajoute les champs au type local `RecordedView` dans
  [`runBboxProcess`](src/ui/MatchPanel.ts).

### Le walking actuel : garder ou retirer ?

À l'utilisateur de décider. Mes recommandations :

- **Garder** le `WalkController` actuel comme fallback. Le bouton « Start
  matching » du panel reste, mais devient un mode « brute-force ». La
  per-vue est le mode privilégié.
- **Ou bien** désactiver le bouton « Start matching » par défaut et le
  cacher derrière un toggle dev. Mais ne supprime pas le code — il
  reste utile comme référence et pour les tracks sans waypoints.

---

## 5. Pièges à éviter (vu sur ce projet)

- **Ne pas remplacer `npm run build` par `tsc`.** Le build rollup
  transpile en mode tolérant ; les erreurs TS passent. Toujours faire
  `npx tsc --noEmit` séparément.
- **Ne pas modifier les anciennes `releases/release-X.Y.Z.user.js`.**
  Ce sont des artefacts immuables. Si prettier ou rollup les
  reformate, restaure depuis `git checkout HEAD --
releases/release-N.user.js`.
- **`prd.md` Hypothesis changelog** : à mettre à jour à chaque nouveau
  SDK quirk découvert. C'est ce qui sauve l'agent suivant.
- **`filterLabels` dans `TrackLayer`** : ne pas casser la dedup à
  100 m (l'utilisateur a corrigé exprès).
- **Le throttle rAF des sliders** : si tu ajoutes un nouvel event
  handler qui redraw le layer, throttle-le. 1000+ vertices font
  freezer la UI sinon.
- **`measureViewport`** ancrée sur un point en Suisse (8.23, 46.82).
  Si tu veux mesurer ailleurs, prends `Map.getMapCenter()` au moment
  de la mesure ; ne hardcode pas.

---

## 6. Pour démarrer

```bash
# Installer
npm install

# Workflow dev
npm run watch       # rollup --watch + i18next + prettier + eslint en parallèle
                    # (concurrently)
                    # ou plus simple :
npm run compile     # un seul build
npm run build       # compile + concat header.js → releases/release-X.Y.Z.user.js

# Avant chaque commit
npm run lint
npm test
npx tsc --noEmit
```

Pour tester dans Tampermonkey en mode dev, utilise `header-dev.js` qui
contient `@require file://...` pointant vers `.out/main.user.js` (build
incrémental sans concat). Le chemin du `@require` est en dur — adapter
au système local.

URL de test :

```
https://beta.waze.com/fr/editor/?env=row&lon=7.1255&lat=46.1258&zoom=8&geojson=https%3A%2F%2Fschweizmobil.ch%2Fapi%2F6%2Ftracks%2F1764963942
```

Bonne chance ✨
