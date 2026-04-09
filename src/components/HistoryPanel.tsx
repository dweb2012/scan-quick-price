import { useEffect, useState } from "react";
import { getHistory, subscribeHistory, HistoryItem } from "@/lib/history";
import { Clock } from "lucide-react";

const formatPrice = (n: number) =>
  n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

const formatTime = (d: Date) =>
  d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

const HistoryPanel = () => {
  const [items, setItems] = useState<HistoryItem[]>(getHistory());

  useEffect(() => {
    return subscribeHistory(() => setItems([...getHistory()]));
  }, []);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-4 px-4 text-center">
        <Clock className="text-muted-foreground" size={48} />
        <p className="text-muted-foreground">Aucun produit scanné</p>
        <p className="text-xs text-muted-foreground">
          L'historique des 20 derniers scans apparaîtra ici
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
      {items.map((item, i) => (
        <div
          key={`${item.id}-${i}`}
          className="bg-card rounded-xl p-3 shadow-sm border border-border flex items-center gap-3"
        >
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">{item.label}</p>
            <p className="text-xs text-muted-foreground">Réf: {item.ref}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-bold text-price-public">
              {formatPrice(item.prixPublic)}
            </p>
            {item.prixRemise !== null && (
              <p className="text-xs font-semibold text-price-remise">
                {formatPrice(item.prixRemise)}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {formatTime(item.timestamp)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
};

export default HistoryPanel;
