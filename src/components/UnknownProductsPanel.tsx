import { useEffect, useState, useCallback } from "react";
import {
  listMyUnknowns,
  updateUnknown,
  deleteUnknown,
  getSignedPhotoUrl,
  exportUnknownsCsv,
  downloadCsv,
  type UnknownProduct,
  type UnknownFilter,
} from "@/lib/unknownProducts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  Trash2,
  CheckCircle2,
  RotateCcw,
  Edit2,
  Save,
  X,
  MapPin,
  Image as ImageIcon,
  ClipboardList,
  Download,
} from "lucide-react";
import { toast } from "sonner";

const fmtDate = (s: string) => {
  try {
    return new Date(s).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return s;
  }
};

const PhotoThumb = ({ path, onClick }: { path: string; onClick: (url: string) => void }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    getSignedPhotoUrl(path).then((u) => {
      if (active) setUrl(u);
    });
    return () => {
      active = false;
    };
  }, [path]);
  if (!url) {
    return (
      <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center">
        <ImageIcon size={20} className="text-muted-foreground" />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onClick(url)}
      className="w-16 h-16 rounded-lg overflow-hidden bg-muted shrink-0"
    >
      <img src={url} alt="Photo" className="w-full h-full object-cover" />
    </button>
  );
};

const PhotoLightbox = ({ url, onClose }: { url: string | null; onClose: () => void }) => {
  if (!url) return null;
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4"
    >
      <img src={url} alt="Photo" className="max-w-full max-h-full object-contain" />
      <button
        onClick={onClose}
        className="absolute top-4 right-4 bg-foreground/70 text-background rounded-full p-2"
        aria-label="Fermer"
      >
        <X size={24} />
      </button>
    </div>
  );
};

const ItemCard = ({
  item,
  onChanged,
  onPhotoClick,
}: {
  item: UnknownProduct;
  onChanged: () => void;
  onPhotoClick: (url: string) => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(item.note ?? "");
  const [busy, setBusy] = useState(false);

  const toggleStatus = async () => {
    setBusy(true);
    try {
      await updateUnknown(item.id, {
        status: item.status === "pending" ? "resolved" : "pending",
      });
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || "Erreur");
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async () => {
    setBusy(true);
    try {
      await updateUnknown(item.id, { note });
      toast.success("Note mise à jour");
      setEditing(false);
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || "Erreur");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("Supprimer ce signalement ?")) return;
    setBusy(true);
    try {
      await deleteUnknown(item);
      toast.success("Supprimé");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || "Erreur");
      setBusy(false);
    }
  };

  const isPending = item.status === "pending";

  return (
    <div
      className={`bg-card rounded-xl p-3 border ${
        isPending ? "border-stock-low/40" : "border-border opacity-75"
      } space-y-2`}
    >
      <div className="flex items-start gap-3">
        {item.photo_path ? (
          <PhotoThumb path={item.photo_path} onClick={onPhotoClick} />
        ) : (
          <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <ImageIcon size={20} className="text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-mono font-bold text-sm break-all">{item.barcode}</div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[11px] text-muted-foreground">{fmtDate(item.created_at)}</span>
            {item.aisle && (
              <span className="inline-flex items-center gap-1 text-[11px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-semibold">
                <MapPin size={10} /> {item.aisle}
              </span>
            )}
            <span
              className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                isPending
                  ? "bg-stock-low/15 text-stock-low"
                  : "bg-stock-ok/15 text-stock-ok"
              }`}
            >
              {isPending ? "À traiter" : "Traité"}
            </span>
          </div>
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
            className="text-sm resize-none"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 touch-target"
              onClick={() => {
                setNote(item.note ?? "");
                setEditing(false);
              }}
              disabled={busy}
            >
              Annuler
            </Button>
            <Button size="sm" className="flex-1 touch-target gap-1" onClick={saveNote} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Enregistrer
            </Button>
          </div>
        </div>
      ) : (
        item.note && (
          <p className="text-sm text-foreground/80 whitespace-pre-wrap break-words">{item.note}</p>
        )
      )}

      {!editing && (
        <div className="flex gap-2 flex-wrap pt-1">
          <Button
            size="sm"
            variant="outline"
            className="gap-1 touch-target h-9"
            onClick={() => setEditing(true)}
            disabled={busy}
          >
            <Edit2 size={12} /> Note
          </Button>
          <Button
            size="sm"
            variant={isPending ? "default" : "outline"}
            className="gap-1 touch-target h-9"
            onClick={toggleStatus}
            disabled={busy}
          >
            {isPending ? <CheckCircle2 size={12} /> : <RotateCcw size={12} />}
            {isPending ? "Marquer traité" : "Rouvrir"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 touch-target h-9 text-destructive hover:text-destructive"
            onClick={remove}
            disabled={busy}
          >
            <Trash2 size={12} /> Supprimer
          </Button>
        </div>
      )}
    </div>
  );
};

const UnknownProductsPanel = () => {
  const [items, setItems] = useState<UnknownProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<UnknownFilter>("pending");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listMyUnknowns(filter);
      setItems(data);
    } catch (e: any) {
      toast.error(e?.message || "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = {
    pending: items.filter((i) => i.status === "pending").length,
    total: items.length,
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="text-primary" size={20} />
          <h2 className="text-base font-bold">Produits à traiter</h2>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1 touch-target h-9"
          disabled={items.length === 0}
          onClick={() => {
            if (items.length === 0) {
              toast.error("Rien à exporter");
              return;
            }
            const csv = exportUnknownsCsv(items);
            const date = new Date().toISOString().slice(0, 10);
            downloadCsv(`produits-a-traiter-${date}.csv`, csv);
            toast.success(`${items.length} ligne(s) exportée(s)`);
          }}
        >
          <Download size={14} /> Exporter CSV
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-1 bg-muted rounded-lg p-1">
        {(["pending", "resolved", "all"] as UnknownFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs font-semibold py-2 rounded-md transition-colors ${
              filter === f ? "bg-card shadow text-foreground" : "text-muted-foreground"
            }`}
          >
            {f === "pending" ? "À traiter" : f === "resolved" ? "Traités" : "Tous"}
            {filter === f && ` (${counts.total})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="animate-spin text-primary" size={28} />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 space-y-2">
          <ClipboardList className="mx-auto text-muted-foreground" size={36} />
          <p className="text-sm text-muted-foreground">
            {filter === "pending"
              ? "Aucun produit à traiter."
              : filter === "resolved"
                ? "Aucun produit traité."
                : "Liste vide."}
          </p>
          <p className="text-xs text-muted-foreground">
            Lors d'un scan introuvable, utilisez le bouton « Signaler à traiter ».
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} onChanged={load} onPhotoClick={setPhotoUrl} />
          ))}
        </div>
      )}

      <PhotoLightbox url={photoUrl} onClose={() => setPhotoUrl(null)} />
    </div>
  );
};

export default UnknownProductsPanel;