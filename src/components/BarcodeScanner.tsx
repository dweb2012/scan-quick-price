import { useState, useRef, useCallback, useEffect } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, Keyboard, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface BarcodeScannerProps {
  onScan: (code: string) => void;
  loading: boolean;
}

const BarcodeScanner = ({ onScan, loading }: BarcodeScannerProps) => {
  const [scanning, setScanning] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<string>("scanner-container");

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {}
      scannerRef.current = null;
    }
    setScanning(false);
  }, []);

  const startScanner = useCallback(async () => {
    setCameraError(null);
    setManualMode(false);
    try {
      const scanner = new Html5Qrcode(containerRef.current);
      scannerRef.current = scanner;
      setScanning(true);
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 280, height: 160 },
          aspectRatio: 1,
        },
        (decodedText) => {
          if (navigator.vibrate) navigator.vibrate(100);
          stopScanner();
          onScan(decodedText);
        },
        () => {}
      );
    } catch (err: any) {
      setScanning(false);
      setCameraError(
        err?.message?.includes("Permission")
          ? "Accès caméra refusé. Veuillez autoriser l'accès dans les paramètres de votre navigateur."
          : "Impossible d'accéder à la caméra. Vérifiez les permissions."
      );
    }
  }, [onScan, stopScanner]);

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, [stopScanner]);

  const handleManualSubmit = () => {
    const val = manualValue.trim();
    if (val) {
      if (navigator.vibrate) navigator.vibrate(50);
      onScan(val);
      setManualValue("");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center flex-1 px-4 py-6 gap-6">
      {/* Scanner viewport */}
      <div className="relative w-full max-w-sm aspect-square rounded-2xl overflow-hidden bg-foreground/5 border-2 border-dashed border-primary/30">
        <div id={containerRef.current} className="w-full h-full" />
        {!scanning && !cameraError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
              <Camera className="text-primary" size={40} />
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
            onClick={() => setManualMode(!manualMode)}
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

      {/* Manual input */}
      {manualMode && !loading && (
        <div className="w-full max-w-sm flex gap-2">
          <Input
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
            placeholder="Code-barres ou référence"
            className="touch-target text-base"
            onKeyDown={(e) => e.key === "Enter" && handleManualSubmit()}
            autoFocus
          />
          <Button
            onClick={handleManualSubmit}
            disabled={!manualValue.trim()}
            className="touch-target px-6"
          >
            OK
          </Button>
        </div>
      )}
    </div>
  );
};

export default BarcodeScanner;
