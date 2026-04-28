## Rattacher les produits à une allée dans Dolibarr

### Bonne nouvelle : pas besoin d'un nouveau champ

Le champ `options_emplacement` (extrafield produit déjà utilisé par l'app) suffit pour stocker l'allée. On va simplement formaliser sa convention d'écriture et l'exploiter automatiquement.

**Convention proposée** : `<ALLÉE> / <EMPLACEMENT>` (ex. `A1 / Étagère 3`).
- Si seule l'allée est connue : `A1`.
- Si seul l'emplacement est saisi (legacy), il est conservé tel quel.

Aucune migration Dolibarr nécessaire. Aucune migration Supabase nécessaire.

### Comportement utilisateur

1. **Affichage produit** : la carte produit affichera l'allée (badge bleu cliquable) en plus de l'emplacement détaillé. Si on est dans une allée active différente, un petit avertissement "Produit rangé en A1" s'affiche.
2. **Scan d'un QR allée** : en plus d'activer la bannière, l'app proposera (toast avec bouton) d'enregistrer cette allée comme allée par défaut pour les prochains produits scannés/modifiés.
3. **Édition d'emplacement** : le champ actuel sera scindé en deux inputs côte à côte :
   - "Allée" (pré-rempli avec l'allée active si présente)
   - "Emplacement" (texte libre)
   Les deux sont concaténés à l'enregistrement selon la convention.
4. **Auto-remplissage** : quand une allée est active et qu'un produit n'a pas d'allée, un bouton "Ranger ici (A1)" en un tap met à jour l'extrafield Dolibarr.

### Détails techniques

**`src/lib/aisle.ts`** — ajouter helpers :
- `parseEmplacement(raw: string): { aisle: string | null; spot: string | null }` — split sur ` / ` (premier séparateur), tolère absence.
- `formatEmplacement(aisle: string | null, spot: string | null): string` — recompose proprement, vide si tout vide.

**`src/components/ProductCard.tsx`** :
- Remplacer le state unique `value` de l'éditeur d'emplacement par `{ aisle, spot }`, initialisés via `parseEmplacement(opts.options_emplacement)`.
- Pré-remplir `aisle` avec `useActiveAisle()` si vide.
- À la sauvegarde : `updateProductExtrafields(id, { options_emplacement: formatEmplacement(aisle, spot) })`.
- Affichage : afficher l'allée comme badge `MapPin` distinct, et l'emplacement détaillé en dessous.
- Ajouter un bouton "Ranger dans l'allée active" visible uniquement si une allée est active ET différente de celle du produit.
- Avertissement visuel si `product.aisle && activeAisle && product.aisle !== activeAisle`.

**`src/components/SettingsPanel.tsx`** : mettre à jour le texte d'aide pour expliquer que scanner un QR allée pré-remplit le champ "Allée" lors de l'édition d'un produit.

### Ce qui ne change pas

- Pas de modification de schéma Dolibarr.
- Pas de modification de la table Supabase.
- L'extrafield `options_emplacement` continue d'être lu/écrit via le proxy `dolibarr-proxy` existant.
- Les produits déjà saisis avec un emplacement libre restent affichés sans perte (zone "Emplacement", allée vide).

### Évolution future possible (hors scope)

Si tu veux plus tard un vrai champ séparé `options_allee` côté Dolibarr (utile pour filtrer/exporter par allée dans Dolibarr lui-même), il faudra :
1. Créer l'extrafield `allee` sur l'entité Produit dans Dolibarr (Configuration → Modules → Produits → Attributs supplémentaires).
2. Adapter le code pour lire/écrire `options_allee` au lieu de splitter `options_emplacement`.

Mais ce n'est utile que si tu veux exploiter l'allée **dans Dolibarr** (rapports, filtres). Pour l'usage app seul, la convention proposée suffit.
