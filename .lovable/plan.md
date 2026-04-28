## Mode "Allée" via QR Code

Objectif : permettre de scanner un QR code collé sur chaque allée (A, B, C…) pour que l'app sache où vous êtes, puis enchaîner les scans produits avec l'allée pré-renseignée.

---

### 1. Format des QR codes d'allée

Convention dédiée pour distinguer un QR allée d'un code-barres produit :

```
CHR-AISLE:A
CHR-AISLE:B12
CHR-AISLE:Frigo-1
```

Le préfixe `CHR-AISLE:` est détecté côté app, le reste est libre (lettre, numéro, nom).

Un petit générateur PDF d'étiquettes d'allée (A4, plusieurs QR par page) sera ajouté dans **Paramètres → Étiquettes d'allées** pour imprimer le jeu complet en une fois.

---

### 2. Comportement dans le scanner

Quand le scanner détecte un code :

- Si le code commence par `CHR-AISLE:` → on entre en **mode allée active** (pas de recherche produit).
  - Bandeau persistant en haut : `📍 Allée A — Changer / Quitter`
  - L'allée est mémorisée en `sessionStorage` (oubliée à la fermeture).
- Sinon → recherche produit normale (comportement actuel inchangé).

---

### 3. Effet sur la fiche produit

Quand une allée est active et qu'un produit est affiché :

- Bouton supplémentaire **"Ranger ici (Allée A)"** à côté de "Modifier emplacement".
  - Un clic = enregistre `options_emplacement = "A"` (ou `"A / <emplacement existant détaillé>"` au choix — voir question ci-dessous).
- Le champ "Modifier emplacement" est **pré-rempli avec l'allée active** comme préfixe, l'utilisateur n'a plus qu'à compléter (ex : `A - Étagère 3`).

---

### 4. Historique enrichi

Chaque scan dans l'historique mémorise l'allée active au moment du scan → permet plus tard de faire un audit "qu'est-ce qui a été scanné dans l'allée B aujourd'hui".

---

### 5. Détails techniques

- **`src/lib/aisle.ts`** (nouveau) : helpers `parseAisleCode()`, `getActiveAisle()`, `setActiveAisle()`, `clearActiveAisle()` (sessionStorage).
- **`src/components/BarcodeScanner.tsx`** : intercepter le code avant `onScan`, si préfixe allée → setActiveAisle + toast, sinon flux normal.
- **`src/components/AisleBanner.tsx`** (nouveau) : bandeau affichant l'allée active avec bouton "Quitter".
- **`src/pages/Index.tsx`** : afficher `<AisleBanner>` sous la TopBar quand une allée est active.
- **`src/components/ProductCard.tsx`** : bouton "Ranger ici" + pré-remplissage du `LocationEditor` avec l'allée active.
- **`src/lib/history.ts`** : ajouter `aisle?: string` à l'item d'historique.
- **`src/components/SettingsPanel.tsx`** : section "Étiquettes d'allées" → input liste `A,B,C,D,...` + bouton "Générer PDF" (jsPDF + qrcode lib déjà disponibles, format A4, 8 QR par page avec libellé sous chaque code).

Aucune migration DB nécessaire — l'allée est stockée côté client (session) et incluse dans le champ `options_emplacement` Dolibarr existant.

---

### Question à clarifier avant implémentation

Quand vous cliquez sur "Ranger ici (Allée A)" sur un produit qui a déjà un emplacement détaillé (ex : `Étagère 3, Bac 2`), je dois :

1. **Remplacer** par `A` tout court
2. **Préfixer** → `A - Étagère 3, Bac 2`
3. **Ouvrir l'éditeur** pré-rempli `A - ` pour que vous complétiez à la main

Je propose l'option **3** (la plus sûre, pas d'écrasement accidentel), à confirmer.
