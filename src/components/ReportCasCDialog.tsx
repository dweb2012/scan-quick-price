import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { sendCasC } from "@/lib/exportCasB";
import { supabase } from "@/integrations/supabase/client";
import { useActiveAisle } from "@/hooks/use-active-aisle";

interface Props {
  open: boolean;
  barcode: string;
  onClose: () => void;
}

const ReportCasCDialog = ({ open, barcode, onClose }: Props) => {
  const activeAisle = useActiveAisle();
  const [marque, setMarque] = useState("");
  const [stock, setStock] = useState("");
  const [emplacement, setEmplacement] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setMarque("");
    setStock("");
    setEmplacement("");
    setNote("");
  };

  const handleClose = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const handleSave = async () => {
    if (!barcode) return toast.error("Code manquant");
    setSaving(true);
    try {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) throw new Error("Non authentifié");
      await sendCasC(barcode, {
        fournisseur: marque.trim(),
        stock: stock.trim(),
        emplacement: emplacement.trim() || activeAisle || "",
        note: note.trim(),
        user: userData.user.email || "",
      });
      toast.success("Ajouté à l'onglet C");
      reset();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Échec de l'envoi");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Produit introuvable (CAS C)</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="bg-muted rounded-lg p-2 text-sm">
            <span className="text-muted-foreground">Code : </span>
            <span className="font-mono font-semibold">{barcode}</span>
          </div>

          {activeAisle && !emplacement && (
            <div className="bg-muted rounded-lg p-2 flex items-center gap-2 text-sm">
              <MapPin size={14} className="text-primary" />
              <span className="text-muted-foreground">Allée active :</span>
              <span className="font-bold text-primary">{activeAisle}</span>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-semibold">Marque (optionnel)</label>
            <Input
              value={marque}
              onChange={(e) => setMarque(e.target.value)}
              placeholder="Ex: Villeroy & Boch"
              maxLength={100}
              className="text-base"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold">Stock estimé (optionnel)</label>
            <Input
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              placeholder="Ex: 12"
              inputMode="numeric"
              maxLength={20}
              className="text-base"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold">Emplacement (optionnel)</label>
            <Input
              value={emplacement}
              onChange={(e) => setEmplacement(e.target.value)}
              placeholder={activeAisle || "Ex: A12"}
              maxLength={50}
              className="text-base"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold">Note (optionnel)</label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Précisions supplémentaires"
              className="text-base resize-none"
              rows={2}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={saving} className="touch-target flex-1">
            Annuler
          </Button>
          <Button onClick={handleSave} disabled={saving} className="touch-target flex-1 gap-2">
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            Envoyer au Sheet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ReportCasCDialog;