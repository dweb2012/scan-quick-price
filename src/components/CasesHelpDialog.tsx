import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Props = { open: boolean; onClose: () => void };

const CASES = [
  {
    code: "A",
    title: "Produits « BMY »",
    text: "Article trouvé dans Dolibarr et dont le libellé contient BMY. Envoi automatique après le scan.",
  },
  {
    code: "B",
    title: "Produits hors BMY",
    text: "Article trouvé dans Dolibarr mais sans BMY dans le libellé. Envoi après validation (bouton « Envoyer à l'onglet B »).",
  },
  {
    code: "C",
    title: "Code inconnu",
    text: "Vous avez une référence ou un code-barres, mais l'article n'existe pas dans Dolibarr. Vous complétez marque, stock, emplacement et note avant l'envoi.",
  },
  {
    code: "D",
    title: "Sans code, mais connu",
    text: "Le carton n'a ni référence ni code-barres, pourtant le produit existe dans Dolibarr. Vous le retrouvez par recherche texte, puis ajoutez une photo du carton, le stock, l'emplacement et une note.",
  },
  {
    code: "E",
    title: "Sans code et inconnu",
    text: "Ni référence, ni code-barres, ni fiche Dolibarr. Vous prenez une photo, décrivez le produit, indiquez quantité et emplacement.",
  },
];

const CasesHelpDialog = ({ open, onClose }: Props) => (
  <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
    <DialogContent className="max-w-md max-h-[85dvh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Rappel des situations (A → E)</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        {CASES.map((c) => (
          <div key={c.code} className="flex gap-3 rounded-lg border border-border p-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
              {c.code}
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-sm text-foreground">{c.title}</p>
              <p className="text-sm text-muted-foreground leading-snug">{c.text}</p>
            </div>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          Dans tous les cas : pas de doublon, état « A traiter » à la création, et votre nom ajouté
          dans la note.
        </p>
      </div>
    </DialogContent>
  </Dialog>
);

export default CasesHelpDialog;
