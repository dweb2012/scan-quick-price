# Liste des produits non identifiés

## Objectif

Permettre à chaque utilisateur de constituer une liste personnelle de codes-barres scannés mais introuvables dans Dolibarr, avec note + photo, pour les traiter plus tard. L'admin a une vue globale et peut exporter en CSV pour transmettre à l'équipe ERP.

## Comportement utilisateur

### Signalement (lors d'une erreur de scan)
Sur l'écran d'erreur "Produit introuvable" actuel, ajouter un bouton **"Signaler à traiter"** à côté de "Réessayer" et "Nouveau scan".

Le clic ouvre une **boîte de dialogue** :
- Code-barres (pré-rempli, lecture seule)
- Allée active (pré-rempli si présente, lecture seule)
- **Note** (textarea libre, optionnelle, max 500 car.) — ex: "verre à vin Riedel, carton bleu"
- **Photo** (bouton "Prendre une photo" → `<input capture>` mobile, ou "Choisir depuis galerie") — optionnelle, compressée côté client à ≤1024px / 80% JPEG avant upload
- Boutons : Annuler / Enregistrer

À l'enregistrement : insertion en base + upload photo dans le bucket privé + toast de confirmation. Reste sur l'écran d'erreur (l'utilisateur peut alors lancer un nouveau scan).

### Onglet "À traiter" (nouveau, dans BottomNav)
Nouvel onglet entre "Historique" et "Paramètres", icône `ClipboardList`, badge avec le nombre d'items en statut `pending`.

Liste des items de l'utilisateur courant (les plus récents en haut), chaque carte affiche :
- Code-barres (gros, en haut)
- Date + heure
- Allée (badge si présente)
- Note (si présente)
- Miniature photo cliquable (zoom plein écran)
- Statut (pending / resolved) avec couleur
- Actions :
  - **Re-scanner** : relance `searchProduct(code)` → si trouvé, affiche la fiche produit et propose "Marquer comme traité"
  - **Modifier la note**
  - **Marquer traité / À traiter** (toggle)
  - **Supprimer** (confirmation)

Filtre rapide en haut : "À traiter (N)" / "Traités" / "Tous".

### Vue admin
Dans le panneau admin existant (`AdminUsersPanel`), ajouter une nouvelle section **"Produits non identifiés (tous utilisateurs)"** :
- Liste agrégée triée par date desc
- Affiche en plus l'email de l'utilisateur qui a signalé
- Filtre par utilisateur, par statut
- Bouton **"Exporter CSV"** (toute la sélection courante)

CSV : `code, note, allee, statut, utilisateur_email, date_creation, photo_url`.

## Détails techniques

### Nouvelle table `unknown_products`
```sql
CREATE TABLE public.unknown_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  barcode text NOT NULL,
  note text,
  aisle text,
  photo_path text,                    -- chemin dans le bucket
  status text NOT NULL DEFAULT 'pending'  -- 'pending' | 'resolved'
    CHECK (status IN ('pending','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.unknown_products(user_id, created_at DESC);
CREATE INDEX ON public.unknown_products(status);
```

Trigger `update_updated_at_column` attaché.

### RLS
- **SELECT** : `user_id = auth.uid() OR has_role(auth.uid(),'admin')`
- **INSERT** : `user_id = auth.uid()`
- **UPDATE / DELETE** : `user_id = auth.uid() OR has_role(auth.uid(),'admin')`

### Bucket Storage `unknown-product-photos`
- **Privé** (pas de lecture publique).
- Chemin : `{user_id}/{uuid}.jpg`
- Policies storage.objects :
  - INSERT : `auth.uid()::text = (storage.foldername(name))[1]`
  - SELECT/DELETE : owner OU admin (via `has_role`)
- Lecture côté client via signed URL (60 min) générées à la volée pour l'affichage.

### Nouveaux fichiers
- `src/lib/unknownProducts.ts` — CRUD : `reportUnknown({barcode, note, aisle, photo})`, `listMyUnknowns(filter)`, `listAllUnknowns(filter)` (admin), `updateUnknown(id, patch)`, `deleteUnknown(id)`, `getSignedPhotoUrl(path)`, `exportUnknownsCsv(items)`. Compression photo via canvas.
- `src/components/ReportUnknownDialog.tsx` — Dialog Shadcn, validation Zod (code requis, note ≤500c, photo ≤5 Mo).
- `src/components/UnknownProductsPanel.tsx` — Onglet utilisateur (liste + filtre + actions).
- `src/components/AdminUnknownProducts.tsx` — Section admin (vue agrégée + export CSV).

### Fichiers modifiés
- `src/components/BottomNav.tsx` — Ajouter onglet `unknown` avec badge.
- `src/pages/Index.tsx` — Router le nouvel onglet, ajouter le bouton "Signaler à traiter" sur l'écran d'erreur, gérer l'ouverture du dialog.
- `src/components/AdminUsersPanel.tsx` — Ajouter la section admin.
- `src/integrations/supabase/types.ts` — régénéré automatiquement.

### Compression photo (côté client)
Avant upload :
```ts
// canvas: redim ≤ 1024px côté max, encode JPEG quality 0.8
// résultat typique : 80–250 Ko
```
Cap dur : refus si photo finale > 2 Mo après compression.

## Sécurité
- Validation Zod côté client + RLS strictes côté serveur (jamais faire confiance au client).
- `barcode` : trim + max 200 caractères.
- `note` : trim + max 500 caractères.
- Photos : type MIME vérifié (`image/jpeg|png|webp`), taille max 5 Mo brut / 2 Mo compressé.
- Le bucket reste privé : aucune URL publique, uniquement signed URLs courtes.

## Ce qui ne change pas
- Aucun impact sur l'historique en mémoire (toujours 20 derniers, jamais persisté).
- Aucun impact sur la logique Dolibarr.
- L'onglet admin existant continue de fonctionner.
