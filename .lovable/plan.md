# Améliorer la fiabilité du scan (QR + codes-barres)

## Constat

Le scanner actuel (`src/components/BarcodeScanner.tsx`) repose sur `Html5Qrcode` avec une config minimale :
- Tous les formats activés par défaut (sources fréquentes de mauvaises lectures, ex: ITF lu à la place d'EAN13).
- Aucune validation de checksum sur les EAN/UPC (un mauvais chiffre passe).
- Aucun anti-rebond : un même code peut être déclenché plusieurs fois si le `stop` traîne.
- Pas de "double lecture" : la première trame décodée est acceptée, même si elle est partielle/erronée.
- Zone de scan (`qrbox`) figée à 280×160, peu adaptée aux QR carrés (allées) vs codes-barres rectangulaires.
- Pas de torche / pas de zoom même quand le matériel le supporte.
- Pas de choix de caméra (sur Android certains téléphones démarrent sur l'ultra grand-angle qui ne fait pas la mise au point de près).

## Objectifs

1. Réduire les **faux positifs** (mauvais chiffres lus).
2. Réduire les **non-lectures** (échecs sur petits codes ou faible lumière).
3. Éviter les **doubles déclenchements**.
4. Garder l'UX mobile-first actuelle (gros boutons, vibration, fermeture rapide).

## Modifications — `src/components/BarcodeScanner.tsx`

### 1. Restreindre + cibler les formats

Importer `Html5QrcodeSupportedFormats` et déclarer une liste blanche :
```ts
formatsToSupport: [
  Html5QrcodeSupportedFormats.QR_CODE,        // allées CHR-AISLE:
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
]
```
Désactive ITF / Codabar / PDF417 etc. qui sont les principales sources de mauvaises lectures sur étiquettes produit.

### 2. Double validation + checksum

Avant d'accepter un code, le passer dans une fonction `validateDecoded(text, format)` :
- Si format = `EAN_13` / `EAN_8` / `UPC_A` / `UPC_E` → vérifier le **chiffre de contrôle** (algorithme standard EAN). Rejet sinon.
- Si format = `QR_CODE` et chaîne commence par `CHR-AISLE:` → délégué à `parseAisleCode` (déjà whitelisté via `aisleCatalog`).
- Sinon (CODE_128/39) : longueur min 4, caractères ASCII imprimables.

### 3. Confirmation par deux lectures identiques

Pour les codes-barres 1D (les plus sujets aux erreurs), **exiger 2 décodages successifs identiques** dans une fenêtre de 600 ms avant de déclencher `onScan`. Les QR (intègres par CRC interne) sont acceptés au premier coup.

Implémentation : un `useRef<{ value: string; count: number; ts: number }>` mis à jour à chaque callback. Quand `count >= 2` (ou format QR), on déclenche.

### 4. Anti-doublon global

Mémoriser le dernier code émis + horodatage ; ignorer toute nouvelle émission identique pendant 1 500 ms même après redémarrage du scanner.

### 5. Zone de scan adaptative

Calculer `qrbox` en fonction de la taille du conteneur (function form supportée par html5-qrcode) :
```ts
qrbox: (vw, vh) => {
  const w = Math.min(vw * 0.9, 360);
  const h = Math.min(vh * 0.7, 220);
  return { width: Math.floor(w), height: Math.floor(h) };
}
```
Plus tolérant sur petits écrans, meilleure mise au point.

### 6. Caméra : préférer la "back" principale, exposer torche

- Lister les caméras avec `Html5Qrcode.getCameras()`.
- Choisir en priorité une caméra dont le `label` contient "back" mais **pas** "wide"/"ultra"/"tele" (sur Android, l'ultra grand-angle ne focalise pas à courte distance — cause majeure de non-lecture).
- Fallback : `facingMode: "environment"`.
- Après démarrage, si `scanner.getRunningTrackCapabilities().torch` est dispo, afficher un petit bouton "Lampe" (icône `Flashlight` de lucide) qui appelle `applyVideoConstraints({ advanced: [{ torch: true|false }] })`.

### 7. FPS et résolution

- iOS : conserver fps 30 + 1920×1080.
- Android/desktop : monter à fps 15 (au lieu de 10) + `width: { ideal: 1280 }` pour améliorer la netteté sans saturer.

### 8. Feedback erreur

Quand un code est lu mais rejeté par la validation (checksum invalide), ne pas spammer : compter les rejets, et après 8 rejets consécutifs sur ~3 s afficher un toast discret « Code illisible — rapprochez-vous ou nettoyez l'étiquette ». Aucun toast pour rejets isolés.

### 9. Nettoyage robuste

Le `stopScanner` actuel peut laisser le flux vidéo actif si `start()` rejette tardivement. Garder une `isStartingRef` pour ignorer un `stop()` trop précoce et appeler `scanner.clear()` après `stop()` pour libérer le `<video>`.

## Détails techniques

- Aucune nouvelle dépendance : tout est dans `html5-qrcode` 2.3.8.
- La fonction de checksum EAN-13 :
  ```
  somme = Σ(d[i] * (i pair ? 1 : 3)) sur les 12 premiers chiffres
  contrôle = (10 - somme % 10) % 10 == d[12]
  ```
  Variantes UPC-A (12 chiffres, même formule) et EAN-8 (8 chiffres).
- L'anti-doublon ne concerne que les **produits** ; pour les QR allées on garde le comportement instantané (utile si on rescanne volontairement la même allée).
- Aucune modification d'API, de Dolibarr ou du parsing d'allée.

## Hors périmètre

- Le mode saisie manuelle et l'autocomplete restent inchangés.
- Pas de changement dans `src/lib/aisle.ts` ni dans `aisleCatalog.ts`.
- Pas de modification de `ProductCard` ni des étiquettes PDF.
