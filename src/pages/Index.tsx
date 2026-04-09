import { useState, useCallback } from "react";
import TopBar from "@/components/TopBar";
import BottomNav from "@/components/BottomNav";
import BarcodeScanner from "@/components/BarcodeScanner";
import ProductCard from "@/components/ProductCard";
import HistoryPanel from "@/components/HistoryPanel";
import SettingsPanel from "@/components/SettingsPanel";
import { searchProduct, DolibarrProduct, getSettings } from "@/lib/dolibarr";
import { addToHistory } from "@/lib/history";
import { cacheProduct, findCachedProduct } from "@/lib/productCache";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

type Tab = "scanner" | "history" | "settings";

const Index = () => {
  const [tab, setTab] = useState<Tab>("scanner");
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState<DolibarrProduct | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string>("");
  const [fromCache, setFromCache] = useState(false);
  const online = useOnlineStatus();

  const handleScan = useCallback(async (code: string) => {
    setLastCode(code);
    setProduct(null);
    setError(null);
    setFromCache(false);
    setLoading(true);

    // Try online first
    if (online) {
      const { baseUrl, apiKey } = await getSettings();
      if (!baseUrl || !apiKey) {
        toast.error("Configurez d'abord l'URL et la clé API dans les paramètres.");
        setTab("settings");
        setLoading(false);
        return;
      }

      try {
        const result = await searchProduct(code);
        if (result) {
          setProduct(result);
          addToHistory(result);
          cacheProduct(result);
          setLoading(false);
          return;
        }
      } catch (err: any) {
        // API failed — try cache fallback
        console.warn("API error, trying cache:", err.message);
      }
    }

    // Offline or API failed — try cache
    const cached = findCachedProduct(code);
    if (cached) {
      setProduct(cached);
      setFromCache(true);
      addToHistory(cached);
      toast.info("Résultat depuis le cache local", { icon: <WifiOff size={16} /> });
    } else {
      setError(online ? "Produit introuvable" : "Hors ligne — produit non trouvé dans le cache");
    }

    setLoading(false);
  }, [online]);

  const handleRetry = () => {
    if (lastCode) handleScan(lastCode);
  };

  const handleScanNext = () => {
    setProduct(null);
    setError(null);
    setFromCache(false);
  };

  const renderContent = () => {
    if (tab === "history") return <HistoryPanel />;
    if (tab === "settings") return <SettingsPanel />;

    if (product) {
      return (
        <div className="flex flex-col flex-1 overflow-hidden">
          {fromCache && (
            <div className="bg-muted px-4 py-2 text-xs text-muted-foreground flex items-center gap-2 justify-center">
              <WifiOff size={14} />
              Données depuis le cache local
            </div>
          )}
          <ProductCard product={product} onScanNext={handleScanNext} />
        </div>
      );
    }

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
      <TopBar online={online} />
      <main className="flex-1 flex flex-col overflow-hidden">{renderContent()}</main>
      <BottomNav active={tab} onChange={setTab} />
    </div>
  );
};

export default Index;
