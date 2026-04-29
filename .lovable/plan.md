## Supprimer le champ "Emplacement" libre dans l'éditeur

### Contexte
Dans le composant `LocationEditor` (`src/components/ProductCard.tsx`), le panneau "Emplacement" affiche aujourd'hui deux champs côte à côte :
- **Allée** : combobox de sélection (H2, A1...) — utile.
- **Emplacement** : champ texte libre (`Ex: Étagère B2`) — sans utilité réelle, à supprimer.

### Modifications

**Fichier : `src/components/ProductCard.tsx`**

1. **Supprimer le champ libre `spot`** dans `LocationEditor` :
   - Retirer le `useState` pour `spot` et son initialisation depuis `initialParsed.spot`.
   - Retirer la prop `initialSpot` et son `useEffect` associé.
   - Retirer le bloc JSX du champ Input "Ex: Étagère B2".
   - Passer la grille de `grid-cols-2` à un layout simple (une colonne, full width).

2. **Simplifier `handleSave`** : enregistrer uniquement l'allée (`formatEmplacement(aisle, "")` qui retournera juste l'allée).

3. **Nettoyer les usages parents** :
   - Retirer les états `aisleEditorInitialSpot` / `setAisleEditorInitialSpot`.
   - Retirer la prop `initialSpot` lors de l'instanciation de `<LocationEditor>` (ligne ~602).

### Notes
- La fonction `parseEmplacement` continue de fonctionner pour lire les anciennes valeurs (rétrocompatibilité affichage via `productSpot` dans `InfoRow` ligne 513 — conservée).
- Le bouton "Ranger dans (A1)" reste inchangé : il continue d'utiliser `productSpot` existant pour préserver les anciens emplacements legacy lors de la mise à jour rapide.
- Aucune migration ni changement d'API requis.
