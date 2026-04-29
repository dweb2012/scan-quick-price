import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Camera, Loader2, X, MapPin, Package } from "lucide-react";
import { toast } from "sonner";
import { reportUnknown } from "@/lib/unknownProducts";
import { useActiveAisle } from "@/hooks/use-active-aisle";
import { z } from "zod";

const schema = z.object({
  note: z.string().trim().max(500, "Note trop longue (500 max)").optional(),
});

interface Props {
  open: boolean;
  barcode: string;
  onClose: () => void;
  onReported?: () => void;
}

const ReportUnknownDialog = ({ open, barcode, onClose, onReported }: Props) => {
  const activeAisle = useActiveAisle();
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setNote("");
    setPhoto(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (fileRef.current) fileRef.current.value = "";
    if (galleryRef.current) galleryRef.current.value = "";
  };

  const handleFile = (f: File | null) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      toast.error("Image trop volumineuse (max 5 Mo)");
      return;
    }
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(f.type)) {
      toast.error("Format non supporté (JPEG, PNG ou WebP)");
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPhoto(f);
    setPreviewUrl(URL.createObjectURL(f));
  };

  const handleSave = async () => {
    const parsed = schema.safeParse({ note });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message || "Données invalides");
      return;
    }
    setSaving(true);
    try {
      await reportUnknown({
        barcode,
        note: note || null,
        aisle: activeAisle,
        photo,
      });
      toast.success("Produit ajouté à votre liste à traiter");
      reset();
      onReported?.();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Erreur lors de l'enregistrement");
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (saving) return;
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Signaler un produit non identifié</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="bg-muted rounded-lg p-3 space-y-1">
            <div className="flex items-center gap-2 text-sm">
              <Package size={14} className="text-muted-foreground" />
              <span className="text-muted-foreground">Code :</span>
              <span className="font-mono font-semibold break-all">{barcode}</span>
            </div>
            {activeAisle && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin size={14} className="text-primary" />
                <span className="text-muted-foreground">Allée :</span>
                <span className="font-bold text-primary">{activeAisle}</span>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold">Note (optionnel)</label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex: verre à vin Riedel, carton bleu"
              className="text-base resize-none"
              rows={3}
              maxLength={500}
            />
            <p className="text-[10px] text-muted-foreground text-right">{note.length}/500</p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold">Photo (optionnel)</label>
            {previewUrl ? (
              <div className="relative rounded-lg overflow-hidden border border-border">
                <img src={previewUrl} alt="Aperçu" className="w-full h-48 object-contain bg-muted" />
                <button
                  type="button"
                  onClick={() => {
                    if (previewUrl) URL.revokeObjectURL(previewUrl);
                    setPhoto(null);
                    setPreviewUrl(null);
                    if (fileRef.current) fileRef.current.value = "";
                    if (galleryRef.current) galleryRef.current.value = "";
                  }}
                  className="absolute top-2 right-2 bg-foreground/70 text-background rounded-full p-1.5"
                  aria-label="Retirer la photo"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="touch-target gap-2"
                  onClick={() => fileRef.current?.click()}
                >
                  <Camera size={16} /> Prendre
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="touch-target gap-2"
                  onClick={() => galleryRef.current?.click()}
                >
                  Galerie
                </Button>
              </div>
            )}
            <Input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
            <Input
              ref={galleryRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={saving} className="touch-target flex-1">
            Annuler
          </Button>
          <Button onClick={handleSave} disabled={saving} className="touch-target flex-1 gap-2">
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ReportUnknownDialog;