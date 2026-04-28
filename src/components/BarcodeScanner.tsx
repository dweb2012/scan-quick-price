import { useState, useRef, useCallback, useEffect } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, Keyboard, X, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { autocompleteProducts, DolibarrProduct } from "@/lib/dolibarr";
import { parseAisleCode, setActiveAisle } from "@/lib/aisle";
import { toast } from "sonner";

interface BarcodeScannerProps {
  onScan: (code: string) => void;
  loading: boolean;
}

const BarcodeScanner = ({ onScan, loading }: BarcodeScannerProps) => {
  const [scanning, setScanning] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<DolibarrProduct[]>([]);
  const [autocompleteLoading, setAutocompleteLoading] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<string>("scanner-container");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {}
      scannerRef.current = null;
    }
    setScanning(false);
  }, []);

  const handleDecoded = useCallback(
    (decoded: string) => {
      const aisle = parseAisleCode(decoded);
      if (aisle) {
        setActiveAisle(aisle);
        if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
        toast.success(`Allée ${aisle} activée`);
        return;
      }
      onScan(decoded);
    },
    [onScan]
  );

  const startScanner = useCallback(() => {
    setCameraError(null);
    setManualMode(false);
    try {
      const scanner = new Html5Qrcode(containerRef.current);
      scannerRef.current = scanner;
      setScanning(true);

      // iOS iPhones with multi-lens need higher resolution + native BarcodeDetector
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

      scanner.start(
        { facingMode: "environment" },
        {
          fps: isIOS ? 30 : 10,
          qrbox: { width: 280, height: 160 },
          ...(isIOS ? {} : { aspectRatio: 1 }),
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: true,
          },
          videoConstraints: isIOS ? {
            facingMode: "environment",
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          } : undefined,
        } as any,
        (decodedText) => {
          if (navigator.vibrate) navigator.vibrate(100);
          stopScanner();
          handleDecoded(decodedText);
        },
        () => {}
      ).catch((err: any) => {
        setScanning(false);
        setCameraError(
          err?.message?.includes("Permission")
            ? "Accès caméra refusé. Veuillez autoriser l'accès dans les paramètres de votre navigateur."
            : "Impossible d'accéder à la caméra. Vérifiez les permissions."
        );
      });
    } catch (err: any) {
      setScanning(false);
      setCameraError(
        err?.message?.includes("Permission")
          ? "Accès caméra refusé. Veuillez autoriser l'accès dans les paramètres de votre navigateur."
          : "Impossible d'accéder à la caméra. Vérifiez les permissions."
      );
    }
  }, [handleDecoded, stopScanner]);

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, [stopScanner]);

  // Autocomplete debounce
  const handleInputChange = (val: string) => {
    setManualValue(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setAutocompleteLoading(true);
      try {
        const results = await autocompleteProducts(val.trim());
        setSuggestions(results);
      } catch {
        setSuggestions([]);
      } finally {
        setAutocompleteLoading(false);
      }
    }, 300);
  };

  const handleSelectSuggestion = (product: DolibarrProduct) => {
    setSuggestions([]);
    setManualValue("");
    if (navigator.vibrate) navigator.vibrate(50);
    onScan(product.ref);
  };

  const handleManualSubmit = () => {
    const val = manualValue.trim();
    if (val) {
      setSuggestions([]);
      if (navigator.vibrate) navigator.vibrate(50);
      handleDecoded(val);
      setManualValue("");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center flex-1 px-4 py-6 gap-6">
      {/* Scanner viewport — hidden in manual mode */}
      {!manualMode && (
        <div className="relative w-full max-w-sm aspect-[16/9] rounded-2xl overflow-hidden bg-foreground/5 border-2 border-dashed border-primary/30">
          <div id={containerRef.current} className="w-full h-full" />
          {!scanning && !cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Camera className="text-primary" size={32} />
              </div>
              <p className="text-muted-foreground text-sm text-center px-4">
                Appuyez sur le bouton pour scanner un code-barres
              </p>
            </div>
          )}
          {scanning && (
            <button
              onClick={stopScanner}
              className="absolute top-3 right-3 bg-foreground/70 text-background rounded-full p-2 touch-target"
            >
              <X size={20} />
            </button>
          )}
        </div>
      )}

      {cameraError && (
        <div className="bg-destructive/10 text-destructive rounded-xl p-4 text-sm text-center w-full max-w-sm">
          {cameraError}
        </div>
      )}

      {/* Action buttons */}
      {!scanning && !loading && (
        <div className="flex flex-col gap-3 w-full max-w-sm">
          <Button
            onClick={startScanner}
            className="touch-target text-base font-semibold gap-2"
            size="lg"
          >
            <Camera size={22} />
            Scanner un code-barres
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setManualMode(!manualMode);
              setSuggestions([]);
            }}
            className="touch-target text-base gap-2"
            size="lg"
          >
            <Keyboard size={20} />
            Saisie manuelle
          </Button>
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="animate-spin text-primary" size={36} />
          <p className="text-muted-foreground text-sm">Recherche du produit…</p>
        </div>
      )}

      {/* Manual input with autocomplete */}
      {manualMode && !loading && (
        <div className="w-full max-w-sm relative">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={manualValue}
                onChange={(e) => handleInputChange(e.target.value)}
                placeholder="Référence ou nom du produit"
                className="touch-target text-base pl-9"
                onKeyDown={(e) => e.key === "Enter" && handleManualSubmit()}
                autoFocus
              />
            </div>
            <Button
              onClick={handleManualSubmit}
              disabled={!manualValue.trim()}
              className="touch-target px-6"
            >
              OK
            </Button>
          </div>

          {/* Autocomplete dropdown */}
          {(suggestions.length > 0 || autocompleteLoading) && (
            <div className="absolute z-50 left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-lg max-h-64 overflow-y-auto">
              {autocompleteLoading && (
                <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" />
                  Recherche…
                </div>
              )}
              {suggestions.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSelectSuggestion(p)}
                  className="w-full text-left px-4 py-3 hover:bg-accent/50 active:bg-accent transition-colors border-b border-border last:border-0 touch-target"
                >
                  <div className="font-semibold text-sm">{p.ref}</div>
                  <div className="text-xs text-muted-foreground truncate">{p.label}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BarcodeScanner;
