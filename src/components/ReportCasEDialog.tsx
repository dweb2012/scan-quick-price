import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Camera, Loader2, X, MapPin } from "lucide-react";
import { toast } from "sonner";
import { compressImage } from "@/lib/unknownProducts";
import { sendCasE } from "@/lib/exportCasB";
import { supabase } from "@/integrations/supabase/client";
import { useActiveAisle } from "@/hooks/use-active-aisle";
import { z } from "zod";

const BUCKET = "cas-e-photos";
// URL signée longue durée (~10 ans) pour que =IMAGE() reste stable dans le Sheet
const SIGNED_URL_TTL = 60 * 60 * 24 * 365 * 10;

const schema = z.object({
  description: z.string().trim().min(3, "Description trop courte").max(300),
  quantite: z.string().trim().max(20).optional(),
  note: z.string().trim().max(500).optional(),
});

interface Props {
  open: boolean;
  onClose: () => void;
}

const ReportCasEDialog = ({ open, onClose }: Props) => {
  const activeAisle = useActiveAisle();
  const [description, setDescription] = useState("");
  const [quantite, setQuantite] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setDescription("");
    setQuantite("");
    setNote("");
    setPhoto(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (fileRef.current) fileRef.current.value = "";
    if (galleryRef.current) galleryRef.current.value = "";
  };

  const handleFile = (f: File | null) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return toast.error("Image trop volumineuse (max 5 Mo)");
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(f.type)) return toast.error("Format non supporté (JPEG, PNG, WebP)");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPhoto(f);
    setPreviewUrl(URL.createObjectURL(f));
  };

  const handleClose = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const handleSave = async () => {
    const parsed = schema.safeParse({ description, quantite, note });
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message || "Données invalides");
    if (!photo) return toast.error("La photo est obligatoire pour un produit sans code");

    setSaving(true);
    try {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) throw new Error("Non authentifié");
      const userId = userData.user.id;

      const compressed = await compressImage(photo);
      const fileName = `${userId}/${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(fileName, compressed, { contentType: "image/jpeg", cacheControl: "3600" });
      if (upErr) throw new Error(`Upload photo : ${upErr.message}`);

      const { data: signed, error: signErr } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(fileName, SIGNED_URL_TTL);
      if (signErr || !signed) throw new Error("Impossible de générer l'URL de la photo");

      await sendCasE({
        description: description.trim(),
        emplacement: activeAisle || "",
        quantite: quantite.trim(),
        note: note.trim(),
        user: userData.user.email || "",
        imageUrl: signed.signedUrl,
      });

      toast.success("Produit ajouté à l'onglet E");
      reset();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Erreur lors de l'envoi");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Produit sans code (CAS E)</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {activeAisle && (
            <div className="bg-muted rounded-lg p-2 flex items-center gap-2 text-sm">
              <MapPin size={14} className="text-primary" />
              <span className="text-muted-foreground">Allée :</span>
              <span className="font-bold text-primary">{activeAisle}</span>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-semibold">Description *</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex: verre à pied gravé, carton rouge, ~30cm"
              className="text-base resize-none"
              rows={3}
              maxLength={300}
            />
            <p className="text-[10px] text-muted-foreground text-right">{description.length}/300</p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold">Quantité estimée (optionnel)</label>
            <Input
              value={quantite}
              onChange={(e) => setQuantite(e.target.value)}
              placeholder="Ex: 12"
              inputMode="numeric"
              maxLength={20}
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

          <div className="space-y-2">
            <label className="text-xs font-semibold">Photo * (obligatoire)</label>
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
                <Button type="button" variant="outline" className="touch-target gap-2" onClick={() => fileRef.current?.click()}>
                  <Camera size={16} /> Prendre
                </Button>
                <Button type="button" variant="outline" className="touch-target gap-2" onClick={() => galleryRef.current?.click()}>
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
            Envoyer au Sheet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ReportCasEDialog;