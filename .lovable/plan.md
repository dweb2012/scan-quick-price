# Affichage du stock physique en rupture

## Problème

Dans `src/components/ProductCard.tsx`, le composant `StockBadge` (lignes 18–27) affiche uniquement le texte « Rupture de stock » dès que `stock <= 0`, sans montrer la valeur réelle. Or cette valeur reste utile pour le magasinier :

- `0` = vraiment vide
- valeur négative = écart d'inventaire (réservations, sorties non réceptionnées, erreur de saisie)

## Modification proposée

Mettre à jour `StockBadge` pour toujours afficher la quantité numérique, quel que soit l'état :

- `stock > 5` → vert, `"{n} en stock"`
- `0 < stock ≤ 5` → orange, `"{n} en stock"` (stock faible)
- `stock = 0` → rouge, `"Rupture (0)"`
- `stock < 0` → rouge, `"Rupture ({n})"` — la valeur négative est conservée pour signaler l'écart

Aucune autre logique n'est touchée. Pas de changement de design (mêmes couleurs `bg-stock-ok` / `bg-stock-low` / `bg-stock-out`, mêmes classes Tailwind, même pastille arrondie).

## Détails techniques

Fichier : `src/components/ProductCard.tsx`, composant `StockBadge` (lignes 18–27).

```tsx
const StockBadge = ({ stock }: { stock: number }) => {
  const color =
    stock > 5 ? "bg-stock-ok" : stock > 0 ? "bg-stock-low" : "bg-stock-out";
  const label =
    stock > 0 ? `${stock} en stock` : `Rupture (${stock})`;
  return (
    <span className={`${color} text-white text-xs font-semibold px-3 py-1 rounded-full`}>
      {label}
    </span>
  );
};
```

Aucun autre fichier modifié, aucune migration, aucun impact sur l'API Dolibarr ni sur le cache.
