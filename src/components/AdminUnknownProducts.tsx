import { useEffect, useState, useCallback } from "react";
import {
  listAllUnknowns,
  deleteUnknown,
  updateUnknown,
  exportUnknownsCsv,
  downloadCsv,
  getSignedPhotoUrl,
  type UnknownProductWithUser,
  type UnknownFilter,
} from "@/lib/unknownProducts";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Trash2,
  CheckCircle2,
  RotateCcw,
  Download,
  MapPin,
  Image as ImageIcon,
  X,
} from "lucide-react";
import { toast } from "sonner";

const fmt = (s: string) => new Date(s).toLocaleString("fr-FR");

const AdminThumb = ({ path, onClick }: { path: string; onClick: (u: string) => void }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    getSignedPhotoUrl(path).then((u) => active && setUrl(u));
    return () => {
      active = false;
    };
  }, [path]);
  if (!url) return <div className="w-12 h-12 bg-muted rounded shrink-0" />;
  return (
    <button onClick={() => onClick(url)} className="w-12 h-12 rounded overflow-hidden bg-muted shrink-0">
      <img src={url} alt="" className="w-full h-full object-cover" />
    </button>
  );
};

const AdminUnknownProducts = () => {
  const [items, setItems] = useState<UnknownProductWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<UnknownFilter>("pending");
  const [userFilter, setUserFilter] = useState<string>("all");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listAllUnknowns(filter));
    } catch (e: any) {
      toast.error(e?.message || "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const userOptions = Array.from(
    new Map(
      items.map((i) => [
        i.user_id,
        { id: i.user_id, label: i.user_display_name || i.user_email || "Inconnu" },
      ])
    ).values()
  );

  const filtered = userFilter === "all" ? items : items.filter((i) => i.user_id === userFilter);

  const handleExport = () => {
    if (filtered.length === 0) {
      toast.error("Rien à exporter");
      return;
    }
    const csv = exportUnknownsCsv(filtered);
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(`produits-non-identifies-${date}.csv`, csv);
    toast.success(`${filtered.length} ligne(s) exportée(s)`);
  };

  const toggle = async (it: UnknownProductWithUser) => {
    try {
      await updateUnknown(it.id, { status: it.status === "pending" ? "resolved" : "pending" });
      load();
    } catch (e: any) {
      toast.error(e?.message || "Erreur");
    }
  };

  const remove = async (it: UnknownProductWithUser) => {
    if (!confirm(`Supprimer le signalement de ${it.user_email || "cet utilisateur"} ?`)) return;
    try {
      await deleteUnknown(it);
      toast.success("Supprimé");
      load();
    } catch (e: any) {
      toast.error(e?.message || "Erreur");
    }
  };

  return (
    <div className="border-t border-border pt-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Produits non identifiés ({filtered.length})
        </h3>
        <Button size="sm" variant="outline" onClick={handleExport} className="gap-1 touch-target h-8">
          <Download size={14} /> CSV
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
          </button>
        ))}
      </div>

      {userOptions.length > 1 && (
        <select
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          className="w-full h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="all">Tous les utilisateurs ({items.length})</option>
          {userOptions.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      )}

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="animate-spin text-primary" size={24} />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">Aucun signalement.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((it) => (
            <div key={it.id} className="bg-card rounded-lg p-2 border border-border">
              <div className="flex items-start gap-2">
                {it.photo_path ? (
                  <AdminThumb path={it.photo_path} onClick={setPhotoUrl} />
                ) : (
                  <div className="w-12 h-12 rounded bg-muted flex items-center justify-center shrink-0">
                    <ImageIcon size={14} className="text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="font-mono text-xs font-bold break-all">{it.barcode}</div>
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[10px] text-muted-foreground">{fmt(it.created_at)}</span>
                    <span className="text-[10px] font-semibold">
                      {it.user_display_name || it.user_email || "?"}
                    </span>
                    {it.aisle && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] bg-primary/10 text-primary px-1 rounded font-semibold">
                        <MapPin size={8} /> {it.aisle}
                      </span>
                    )}
                    <span
                      className={`text-[9px] uppercase font-bold px-1 rounded ${
                        it.status === "pending"
                          ? "bg-stock-low/15 text-stock-low"
                          : "bg-stock-ok/15 text-stock-ok"
                      }`}
                    >
                      {it.status === "pending" ? "À traiter" : "Traité"}
                    </span>
                  </div>
                  {it.note && (
                    <p className="text-xs text-foreground/80 break-words line-clamp-2">{it.note}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => toggle(it)}
                    title={it.status === "pending" ? "Marquer traité" : "Rouvrir"}
                  >
                    {it.status === "pending" ? (
                      <CheckCircle2 size={14} className="text-stock-ok" />
                    ) : (
                      <RotateCcw size={14} />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => remove(it)}
                  >
                    <Trash2 size={14} className="text-destructive" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {photoUrl && (
        <div
          onClick={() => setPhotoUrl(null)}
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4"
        >
          <img src={photoUrl} alt="" className="max-w-full max-h-full object-contain" />
          <button
            onClick={() => setPhotoUrl(null)}
            className="absolute top-4 right-4 bg-foreground/70 text-background rounded-full p-2"
          >
            <X size={24} />
          </button>
        </div>
      )}
    </div>
  );
};

export default AdminUnknownProducts;