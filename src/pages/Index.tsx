import { useState, useCallback, useEffect } from "react";
import TopBar from "@/components/TopBar";
import BottomNav, { type Tab } from "@/components/BottomNav";
import BarcodeScanner from "@/components/BarcodeScanner";
import ProductCard from "@/components/ProductCard";
import HistoryPanel from "@/components/HistoryPanel";
import SettingsPanel from "@/components/SettingsPanel";
import AdminUsersPanel from "@/components/AdminUsersPanel";
import AisleBanner from "@/components/AisleBanner";
import UnknownProductsPanel from "@/components/UnknownProductsPanel";
import ReportUnknownDialog from "@/components/ReportUnknownDialog";
import ReportCasEDialog from "@/components/ReportCasEDialog";
import ReportCasDDialog from "@/components/ReportCasDDialog";
import ReportCasCDialog from "@/components/ReportCasCDialog";
import { searchProduct, DolibarrProduct, getSettings } from "@/lib/dolibarr";
import { addToHistory } from "@/lib/history";
import { cacheProduct, findCachedProduct } from "@/lib/productCache";
import { isCasB, sendCasA, sendCasB, sendCasC } from "@/lib/exportCasB";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { listMyUnknowns } from "@/lib/unknownProducts";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw, WifiOff, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";

const Index = () => {
  const [tab, setTab] = useState<Tab>("scanner");
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState<DolibarrProduct | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string>("");
  const [fromCache, setFromCache] = useState(false);
  const online = useOnlineStatus();
  const { isAdmin } = useIsAdmin();
  const [reportOpen, setReportOpen] = useState(false);
  const [casEOpen, setCasEOpen] = useState(false);
  const [casDOpen, setCasDOpen] = useState(false);
  const [casCOpen, setCasCOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const refreshPendingCount = useCallback(async () => {
    try {
      const items = await listMyUnknowns("pending");
      setPendingCount(items.length);
    } catch {
      // silencieux : badge purement informatif
    }
  }, []);

  useEffect(() => {
    refreshPendingCount();
  }, [refreshPendingCount]);

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
          if (isCasB(result)) {
            toast("Produit hors BMY détecté", {
              description: `${result.ref} — ${result.label}`,
              duration: 10000,
              action: {
                label: "Envoyer au Sheet",
                onClick: () => {
                  toast.promise(sendCasB(result), {
                    loading: "Envoi vers le Sheet…",
                    success: "Ajouté à l'onglet B",
                    error: (e) => `Échec: ${e.message}`,
                  });
                },
              },
            });
          } else {
            // CAS A : produit BMY nominal — envoi silencieux à l'onglet A
            // (le dédoublonnage côté edge function évite les répétitions)
            sendCasA(result).catch((e) => console.warn("CAS A export failed", e));
          }
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
    if (tab === "unknown") return <UnknownProductsPanel />;
    if (tab === "settings") return <SettingsPanel />;
    if (tab === "admin") return <AdminUsersPanel />;

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
          <div className="flex flex-col gap-2 w-full max-w-xs">
            <Button
              variant="default"
              onClick={() => setReportOpen(true)}
              className="touch-target gap-2"
            >
              <ClipboardList size={16} /> Signaler à traiter
            </Button>
            {online && lastCode && (
              <Button
                variant="secondary"
                onClick={() => setCasCOpen(true)}
                className="touch-target gap-2"
              >
                Envoyer au Sheet (onglet C)
              </Button>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleRetry} className="flex-1 touch-target gap-1">
                <RefreshCw size={14} /> Réessayer
              </Button>
              <Button variant="outline" onClick={handleScanNext} className="flex-1 touch-target">
                Nouveau scan
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <BarcodeScanner onScan={handleScan} loading={loading} />
        <div className="px-4 pb-3 pt-2 border-t border-border bg-background grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={() => setCasDOpen(true)}
            className="touch-target gap-2"
          >
            <ClipboardList size={16} /> Sans code (CAS D)
          </Button>
          <Button
            variant="outline"
            onClick={() => setCasEOpen(true)}
            className="touch-target gap-2"
          >
            <ClipboardList size={16} /> Inconnu (CAS E)
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-[100dvh] bg-background overflow-hidden">
      <TopBar online={online} />
      <AisleBanner />
      <main className="flex-1 flex flex-col overflow-hidden">{renderContent()}</main>
      <BottomNav
        active={tab}
        onChange={(t) => {
          setTab(t);
          if (t === "unknown") refreshPendingCount();
        }}
        showAdmin={isAdmin}
        unknownPendingCount={pendingCount}
      />
      <ReportUnknownDialog
        open={reportOpen}
        barcode={lastCode}
        onClose={() => setReportOpen(false)}
        onReported={refreshPendingCount}
      />
      <ReportCasEDialog open={casEOpen} onClose={() => setCasEOpen(false)} />
      <ReportCasDDialog open={casDOpen} onClose={() => setCasDOpen(false)} />
      <ReportCasCDialog open={casCOpen} barcode={lastCode} onClose={() => setCasCOpen(false)} />
    </div>
  );
};

export default Index;
