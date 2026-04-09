import { useState, useCallback } from "react";
import TopBar from "@/components/TopBar";
import BottomNav from "@/components/BottomNav";
import BarcodeScanner from "@/components/BarcodeScanner";
import ProductCard from "@/components/ProductCard";
import HistoryPanel from "@/components/HistoryPanel";
import SettingsPanel from "@/components/SettingsPanel";
import { searchProduct, DolibarrProduct, getSettings } from "@/lib/dolibarr";
import { addToHistory } from "@/lib/history";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Tab = "scanner" | "history" | "settings";

const Index = () => {
  const [tab, setTab] = useState<Tab>("scanner");
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState<DolibarrProduct | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string>("");

  const handleScan = useCallback(async (code: string) => {
    const { baseUrl, apiKey } = getSettings();
    if (!baseUrl || !apiKey) {
      toast.error("Configurez d'abord l'URL et la clé API dans les paramètres.");
      setTab("settings");
      return;
    }

    setLastCode(code);
    setProduct(null);
    setError(null);
    setLoading(true);

    try {
      const result = await searchProduct(code);
      if (result) {
        setProduct(result);
        addToHistory(result);
      } else {
        setError("Produit introuvable");
      }
    } catch (err: any) {
      setError(err.message || "Erreur lors de la recherche");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRetry = () => {
    if (lastCode) handleScan(lastCode);
  };

  const handleScanNext = () => {
    setProduct(null);
    setError(null);
  };

  const renderContent = () => {
    if (tab === "history") return <HistoryPanel />;
    if (tab === "settings") return <SettingsPanel />;

    // Scanner tab
    if (product) return <ProductCard product={product} onScanNext={handleScanNext} />;

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center flex-1 gap-4 px-6 text-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="text-destructive" size={32} />
          </div>
          <p className="font-semibold text-lg">{error}</p>
          <p className="text-sm text-muted-foreground">Code recherché : {lastCode}</p>
          <div className="flex gap-3">
            <Button variant="outline" onClick={handleRetry} className="touch-target gap-2">
              <RefreshCw size={16} /> Réessayer
            </Button>
            <Button onClick={handleScanNext} className="touch-target">
              Nouveau scan
            </Button>
          </div>
        </div>
      );
    }

    return <BarcodeScanner onScan={handleScan} loading={loading} />;
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-background overflow-hidden">
      <TopBar />
      <main className="flex-1 flex flex-col overflow-hidden">{renderContent()}</main>
      <BottomNav active={tab} onChange={setTab} />
    </div>
  );
};

export default Index;
