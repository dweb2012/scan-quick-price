# Catalogue d'emplacements CHR Elite

## Objectif

Centraliser la liste officielle des emplacements du dépôt (~210 codes) et l'utiliser pour :
1. **Valider strictement** les allées scannées et saisies (whitelist).
2. **Faciliter l'édition produit** via un sélecteur déroulant groupé par zone.
3. **Générer en un clic** le PDF complet des QR codes à coller en rayon.

## La liste officielle

| Zone | Codes | Nom complet |
|---|---|---|
| A | A1 → A22 | Allée A |
| B | B1 → B22 | Allée B |
| C | C1 → C22 | Allée C |
| D | D1 → D22 | Allée D |
| E | E1 → E22 | Allée E |
| F | F1 → F20 | Allée F |
| G | G1 → G22 | Allée G |
| H | H1 → H38 | Allée H |
| I | I1 → I18 | Allée I |
| J | J1 → J15 | Allée J |
| R | R | Retours |
| S | S1 → S4 | SAV |
| O | O1 → O8 | Occasion |
| Y | Y1 → Y4 | Déclassé |
| X | X | Inox |
| SW | SW | Show Room |

**Total : 213 emplacements.** Affichage utilisateur : `H12 (Allée H)`, `S2 (SAV)`, `X (Inox)`, etc.

## Comportement utilisateur

### Édition d'un produit (ProductCard)
- Le champ texte libre **Allée** devient un **sélecteur déroulant** (Combobox avec recherche), groupé par zone (A, B, … J, puis Spéciales).
- L'allée active est pré-sélectionnée si elle existe.
- Une option « Aucune » permet de vider l'allée.
- Le champ **Emplacement** (texte libre, ex. « Étagère 3 ») reste inchangé.
- Si un produit Dolibarr contient une allée hors-liste (legacy), elle s'affiche avec un badge orange « Hors liste » et un bouton « Réassigner ».

### Scan d'un QR allée
- Si le code scanné **n'est pas dans la whitelist** → toast d'erreur « Allée inconnue : XYZ ».
- Si valide → comportement actuel (bannière + activation).

### Paramètres → Génération PDF
- Le champ texte libre « Liste des allées (séparées par virgule) » est **remplacé** par :
  - Un bouton **« Tout sélectionner (213) »** (par défaut coché).
  - Un sélecteur de zones (cases à cocher : A, B, …, J, Spéciales) pour n'imprimer qu'un sous-ensemble.
- Les contrôles d'orientation et de QR par page restent identiques.
- Le PDF affiche désormais sous le code : la zone complète (ex. `H12` en gros + `Allée H` en petit, ou `S2` + `SAV`).

## Détails techniques

### Nouveau fichier `src/lib/aisleCatalog.ts`
Source de vérité unique :
```ts
export interface AisleZone { code: string; name: string; range?: [number, number] }
export const AISLE_ZONES: AisleZone[] = [
  { code: "A", name: "Allée A", range: [1, 22] },
  // … B, C, D, E (22), F (20), G (22), H (38), I (18), J (15)
  { code: "R", name: "Retours" },
  { code: "S", name: "SAV", range: [1, 4] },
  { code: "O", name: "Occasion", range: [1, 8] },
  { code: "Y", name: "Déclassé", range: [1, 4] },
  { code: "X", name: "Inox" },
  { code: "SW", name: "Show Room" },
];

export interface AisleEntry { code: string; zoneName: string; label: string }
// expandAisles() → AisleEntry[] (213 entrées) avec memoization
export function expandAisles(): AisleEntry[];
export function isValidAisle(code: string): boolean;
export function getAisleEntry(code: string): AisleEntry | null;
export function formatAisleLabel(code: string): string; // "H12 (Allée H)"
```

### `src/lib/aisle.ts`
- `parseAisleCode()` : ajouter validation via `isValidAisle()` ; retourner `null` si inconnu (le scanner affichera l'erreur).

### `src/components/BarcodeScanner.tsx`
- Quand `parseAisleCode` retourne `null` mais que le code commence par `CHR-AISLE:` → toast d'erreur explicite « Allée inconnue ».

### `src/components/ProductCard.tsx`
- Remplacer l'`Input` du champ "Allée" par un `<Combobox>` (basé sur `Command` + `Popover` Shadcn déjà présents) listant les 213 entrées groupées par zone, avec recherche live.
- Si l'allée actuelle du produit n'est pas dans la liste → afficher l'option en haut avec libellé « (Hors liste) ».

### `src/components/SettingsPanel.tsx`
- Supprimer le champ texte `aisleList`.
- Ajouter une grille de cases à cocher pour les zones (sélection rapide : Tout / Aucun / par zone).
- Au clic sur "Générer", appeler `generateAisleLabelsPdf(selectedEntries, …)` avec les `AisleEntry` (au lieu de simples strings).

### `src/lib/aisleLabelsPdf.ts`
- Changer la signature : `generateAisleLabelsPdf(entries: AisleEntry[], options)`.
- Sous le code en gros, afficher `entry.zoneName` en petit (police 8pt, gris).
- Le payload QR reste `CHR-AISLE:<code>` (rétrocompatible).

### Fichiers modifiés
- **Nouveau** : `src/lib/aisleCatalog.ts`
- **Modifié** : `src/lib/aisle.ts`, `src/lib/aisleLabelsPdf.ts`, `src/components/BarcodeScanner.tsx`, `src/components/ProductCard.tsx`, `src/components/SettingsPanel.tsx`

## Ce qui ne change pas
- Format de stockage Dolibarr `options_emplacement` (`<ALLÉE> / <EMPLACEMENT>`).
- Payload des QR codes (`CHR-AISLE:H12`).
- Sessionstorage de l'allée active.
- Aucune migration base de données.

## Mémoire projet
Mettre à jour `mem://project/overview` (ou créer `mem://features/aisle-catalog`) avec la liste officielle pour que les futures itérations la respectent.
