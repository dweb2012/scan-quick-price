Je vais corriger la génération d’étiquette pour que le PDF corresponde réellement au format papier choisi par le pilote, au lieu de toujours envoyer une page PDF portrait.

Plan de correction :

1. Séparer deux notions dans le code
   - Format papier PDF : dimensions exactes de la page envoyée à l’imprimante.
   - Sens de lecture du contenu : portrait ou paysage.

2. Modifier la génération PDF DYMO 30334
   - En mode portrait : générer une page PDF strictement en 32 × 57 mm.
   - En mode paysage : générer une page PDF strictement en 57 × 32 mm.
   - Supprimer la rotation artificielle actuelle quand elle n’est pas nécessaire, car elle peut laisser une boîte PDF/zone image interprétée trop grande par le pilote.
   - Garder tous les éléments à l’intérieur des marges : référence, emplacement, libellé sur 2 lignes, code-barres, prix HT et prix remisé.

3. Recalculer automatiquement le layout selon le format
   - Largeur/hauteur utiles recalculées à partir de la page réelle.
   - Code-barres adapté au format choisi pour ne pas dépasser.
   - Libellé et emplacement tronqués proprement si nécessaire.
   - Prix placés en bas sans débordement.

4. Ajuster le texte des paramètres
   - Remplacer l’explication actuelle qui dit que le PDF est toujours envoyé en portrait.
   - Expliquer que l’option doit correspondre au réglage papier du pilote DYMO :
     - Portrait = page PDF 32 × 57 mm
     - Paysage = page PDF 57 × 32 mm

5. Vérification
   - Lancer le build/typecheck si disponible.
   - Vérifier que le PDF généré reste sur une seule page et que les dimensions changent bien selon le choix portrait/paysage.

Détail technique : le problème vient probablement du fait que les deux options actuelles produisent la même page PDF physique 32 × 57 mm, avec seulement le contenu pivoté. Si le pilote DYMO est configuré en 57 × 32 mm, il peut interpréter cette page comme trop haute/large et la répartir sur deux étiquettes. La correction consiste à faire correspondre la taille réelle du PDF à l’orientation sélectionnée.