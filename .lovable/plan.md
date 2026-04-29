# Bouton "Ranger dans (A1)" — enregistrement direct dans Dolibarr

## Problème actuel
Dans `src/components/ProductCard.tsx`, le bouton **"Ranger ici (A1)"** ouvre l'éditeur d'emplacement (combobox + champ libre) au lieu d'écrire directement la valeur dans Dolibarr. L'utilisateur doit alors confirmer manuellement avec "Enregistrer".

## Comportement souhaité
Quand l'utilisateur clique sur le bouton en ayant l'allée active **A1** scannée :
1. Le libellé devient **"Ranger dans (A1)"** (au lieu de "Ranger ici (A1)").
2. Un appel direct à Dolibarr met à jour le champ `options_emplacement` avec la valeur **`A1`** (l'allée active), sans ouvrir de dialogue.
3. Le spot/étagère existant est préservé : si le produit avait déjà `A2 / Étagère 3`, on enregistre `A1 / Étagère 3`. Sinon on enregistre simplement `A1`.
4. Toast de confirmation, état de chargement pendant l'appel, et rafraîchissement de l'affichage de l'emplacement local.

## Modifications techniques

**Fichier : `src/components/ProductCard.tsx`**

- Renommer le libellé du bouton :
  ```tsx
  <MapPin size={14} /> Ranger dans ({activeAisle})
  ```
- Remplacer `handleStoreHere` (qui ouvrait l'éditeur) par une fonction async qui :
  - Calcule la nouvelle valeur via `formatEmplacement(activeAisle, productSpot)`.
  - Appelle `updateProductExtrafields(product.id, { options_emplacement: value })`.
  - Met à jour localement `product.array_options.options_emplacement` (mutation directe + `useState` pour forcer le re-render) afin que `productAisle` reflète immédiatement A1 et que le bouton disparaisse.
  - Affiche un toast succès/erreur et un spinner pendant l'appel (état `storing`).
- Supprimer le passage par `aisleEditorOpen` / `setAisleEditorInitialAisle` pour ce flux. Conserver l'ouverture manuelle via `LocationEditor` (bouton "Modifier emplacement") pour les autres cas.

## Notes
- L'API Dolibarr utilisée (`updateProductExtrafields`) est déjà en place et fonctionne via le proxy edge function.
- Aucun changement de schéma ni de migration requis.
- Pas de changement à `src/lib/aisle.ts` ni au catalogue.
