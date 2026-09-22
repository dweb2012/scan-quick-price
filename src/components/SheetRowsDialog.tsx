import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, Save, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { listSheetRows, updateSheetRow, SheetRow } from "@/lib/exportCasB";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Recherche initiale (ex. référence du produit scanné). */
  initialQuery?: string;
}

const SheetRowsDialog = ({ open, onClose, initialQuery = "" }: Props) => {
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [selected, setSelected] = useState<SheetRow | null>(null);
  const [saving, setSaving] = useState(false);

  // Champs éditables
  const [label, setLabel] = useState("");
  const [fournisseur, setFournisseur] = useState("");
  const [stock, setStock] = useState("");
  const [emplacement, setEmplacement] = useState("");

  const load = async (q: string) => {
    setLoading(true);
    try {
      const data = await listSheetRows(q);
      setRows(data);
      if (data.length === 0) toast.info("Aucune fiche trouvée");
    } catch (e: any) {
      toast.error(e?.message || "Lecture impossible");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setSelected(null);
      setQuery(initialQuery);
      load(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialQuery]);

  const pick = (r: SheetRow) => {
    setSelected(r);
    setLabel(r.label);
    setFournisseur(r.fournisseur);
    setStock(r.stock);
    setEmplacement(r.emplacement);
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await updateSheetRow(
        { sheet: selected.sheet, row: selected.row },
        { label, fournisseur, stock, emplacement },
      );
      toast.success(`Fiche mise à jour (onglet ${selected.sheet})`);
      setRows((prev) =>
        prev.map((r) =>
          r.sheet === selected.sheet && r.row === selected.row
            ? { ...r, label, fournisseur, stock, emplacement }
            : r,
        ),
      );
      setSelected(null);
    } catch (e: any) {
      toast.error(e?.message || "Mise à jour impossible");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Modifier une fiche du Google Sheet</DialogTitle>
        </DialogHeader>

        {!selected && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && load(query)}
                placeholder="Réf, code-barre, libellé ou marque"
                className="touch-target text-base flex-1"
              />
              <Button onClick={() => load(query)} disabled={loading} className="touch-target">
                {loading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
              </Button>
            </div>

            <div className="space-y-2">
              {rows.map((r) => (
                <button
                  key={`${r.sheet}-${r.row}`}
                  onClick={() => pick(r)}
                  className="w-full text-left rounded-lg border border-border p-3 hover:bg-muted"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm">{r.ref || r.barcode || "—"}</span>
                    <span className="text-[10px] font-bold rounded bg-primary/10 text-primary px-1.5 py-0.5">
                      Onglet {r.sheet}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground line-clamp-2">{r.label}</div>
                  <div className="text-xs text-muted-foreground">
                    Stock : {r.stock || "—"} · Emplacement : {r.emplacement || "—"}
                  </div>
                </button>
              ))}
              {!loading && rows.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Lancez une recherche pour retrouver une fiche déjà envoyée.
                </p>
              )}
            </div>
          </div>
        )}

        {selected && (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Onglet {selected.sheet} · ligne {selected.row} ·{" "}
              <span className="font-semibold text-foreground">
                {selected.ref || selected.barcode || "sans code"}
              </span>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold">Libellé</label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} className="touch-target text-base" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-semibold">Marque</label>
              <Input value={fournisseur} onChange={(e) => setFournisseur(e.target.value)} className="touch-target text-base" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-sm font-semibold">Stock</label>
                <Input value={stock} onChange={(e) => setStock(e.target.value)} className="touch-target text-base" />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold">Emplacement</label>
                <Input value={emplacement} onChange={(e) => setEmplacement(e.target.value)} className="touch-target text-base" />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setSelected(null)} className="touch-target flex-1">
                <RefreshCw size={16} className="mr-1" /> Retour
              </Button>
              <Button onClick={handleSave} disabled={saving} className="touch-target flex-1">
                {saving ? <Loader2 size={16} className="animate-spin mr-1" /> : <Save size={16} className="mr-1" />}
                Enregistrer
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default SheetRowsDialog;
