import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Camera, Loader2, X, MapPin, AlertTriangle, RefreshCw, Search, Check } from "lucide-react";
import { toast } from "sonner";
import { compressImage } from "@/lib/unknownProducts";
import { sendCasD } from "@/lib/exportCasB";
import { autocompleteProducts, DolibarrProduct } from "@/lib/dolibarr";
import { supabase } from "@/integrations/supabase/client";
import { useActiveAisle } from "@/hooks/use-active-aisle";

interface Props {
  open: boolean;
  onClose: () => void;
}

const UPLOAD_TIMEOUT_MS = 30_000;

const ReportCasDDialog = ({ open, onClose }: Props) => {
  const activeAisle = useActiveAisle();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<DolibarrProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<DolibarrProduct | null>(null);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  // Debounce autocomplete (300ms, min 2 caractères — cohérent avec le reste de l'app)
  useEffect(() => {
    if (selected) return;
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    setSearching(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await autocompleteProducts(q);
        setSuggestions(res);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [query, selected]);

  const reset = () => {
    setQuery("");
    setSuggestions([]);
    setSelected(null);
    setNote("");
    setPhoto(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (fileRef.current) fileRef.current.value = "";
    if (galleryRef.current) galleryRef.current.value = "";
    setError(null);
    setElapsed(0);
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
    if (!selected) return toast.error("Sélectionnez d'abord un produit dans la liste");
    if (!photo) return toast.error("La photo du carton est obligatoire");

    setSaving(true);
    setError(null);
    setElapsed(0);
    const startedAt = Date.now();
    const ticker = window.setInterval(() => {
      setElapsed(Math.round((Date.now() - startedAt) / 1000));
    }, 500);
    try {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) throw new Error("Non authentifié");

      const compressed = await compressImage(photo);
      const imageDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Lecture de la photo impossible"));
        reader.readAsDataURL(compressed);
      });

      await Promise.race([
        sendCasD({
          product: selected,
          emplacement: activeAisle || "",
          note: note.trim(),
          user: userData.user.email || "",
          imageDataUrl,
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`Délai dépassé (${UPLOAD_TIMEOUT_MS / 1000}s) — Google Drive ne répond pas`)),
            UPLOAD_TIMEOUT_MS,
          ),
        ),
      ]);

      toast.success("Produit ajouté à l'onglet D");
      reset();
      onClose();
    } catch (e: any) {
      const msg = e?.message || "Erreur lors de l'envoi";
      setError(msg);
      toast.error(msg);
    } finally {
      window.clearInterval(ticker);
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Produit sans code (CAS D)</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Produit présent dans Dolibarr mais sans code-barre ni référence sur le carton.
          </p>
        </DialogHeader>

        <div className="space-y-3">
          {activeAisle && (
            <div className="bg-muted rounded-lg p-2 flex items-center gap-2 text-sm">
              <MapPin size={14} className="text-primary" />
              <span className="text-muted-foreground">Allée :</span>
              <span className="font-bold text-primary">{activeAisle}</span>
            </div>
          )}

          {saving && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex items-start gap-3">
              <Loader2 size={18} className="animate-spin text-primary mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Envoi de la photo vers Google Drive…</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {elapsed}s / {UPLOAD_TIMEOUT_MS / 1000}s
                  {elapsed > 10 ? " — connexion lente, patientez encore un peu." : ""}
                </p>
              </div>
            </div>
          )}

          {error && !saving && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle size={18} className="text-destructive mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-destructive">Échec de l'envoi</p>
                  <p className="text-xs text-muted-foreground mt-0.5 break-words">{error}</p>
                </div>
              </div>
              <Button type="button" variant="destructive" size="sm" onClick={handleSave} className="w-full touch-target gap-2">
                <RefreshCw size={14} /> Réessayer l'envoi
              </Button>
            </div>
          )}

          {/* Recherche produit Dolibarr */}
          <div className="space-y-1">
            <label className="text-xs font-semibold">Rechercher le produit dans Dolibarr *</label>
            {selected ? (
              <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-1">
                <div className="flex items-start gap-2">
                  <Check size={16} className="text-primary mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold break-words">{selected.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Réf : <span className="font-mono">{selected.ref}</span>
                      {selected.supplierName ? ` • ${selected.supplierName}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Stock : {selected.stock_reel ?? 0}
                      {selected.array_options?.options_emplacement
                        ? ` • Emplacement : ${selected.array_options.options_emplacement}`
                        : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(null);
                      setQuery("");
                    }}
                    className="text-xs text-muted-foreground underline shrink-0"
                  >
                    Changer
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Libellé, marque ou début de référence…"
                    className="pl-9 text-base"
                    autoFocus
                  />
                </div>
                {(searching || suggestions.length > 0) && (
                  <div className="border border-border rounded-lg max-h-56 overflow-y-auto divide-y divide-border">
                    {searching && (
                      <div className="p-2 text-xs text-muted-foreground flex items-center gap-2">
                        <Loader2 size={12} className="animate-spin" /> Recherche…
                      </div>
                    )}
                    {suggestions.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setSelected(p);
                          setSuggestions([]);
                        }}
                        className="w-full text-left p-2 hover:bg-muted active:bg-muted"
                      >
                        <p className="text-sm font-medium break-words">{p.label}</p>
                        <p className="text-[11px] text-muted-foreground font-mono">{p.ref}</p>
                      </button>
                    ))}
                    {!searching && suggestions.length === 0 && query.trim().length >= 2 && (
                      <div className="p-2 text-xs text-muted-foreground">Aucun résultat</div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold">Note (optionnel)</label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex : étiquette arrachée, carton déchiré…"
              className="text-base resize-none"
              rows={2}
              maxLength={500}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold">Photo du carton * (obligatoire)</label>
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
          <Button onClick={handleSave} disabled={saving || !selected || !photo} className="touch-target flex-1 gap-2">
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            {error ? "Réessayer" : "Envoyer au Sheet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ReportCasDDialog;