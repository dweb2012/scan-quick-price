import { useState, useRef, useCallback, useEffect } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Camera, Keyboard, X, Loader2, Search, Flashlight, FlashlightOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { autocompleteProducts, DolibarrProduct } from "@/lib/dolibarr";
import { parseAisleCode, setActiveAisle, isAislePayload, AISLE_PREFIX } from "@/lib/aisle";
import { toast } from "sonner";

interface BarcodeScannerProps {
  onScan: (code: string) => void;
  loading: boolean;
}

// ---------- Validation helpers ----------
const NUMERIC_FORMATS = new Set([
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
]);

function eanChecksumOk(code: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  // Support EAN-13 (13), UPC-A (12), EAN-8 (8). UPC-E (8 incl. check) handled as-is via 8-digit rule.
  if (![8, 12, 13].includes(code.length)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop() as number;
  // For EAN-13 (12 data digits), weights from right are 3,1,3,1...
  // For UPC-A (11 data digits), weights from right are 3,1,3,1...
  // For EAN-8 (7 data digits), same alternating from right.
  let sum = 0;
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) {
    sum += digits[i] * w;
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === check;
}

function validateDecoded(text: string, format: number | undefined): boolean {
  const t = (text || "").trim();
  if (!t) return false;

  // QR allée : déléguer à parseAisleCode (whitelist).
  if (format === Html5QrcodeSupportedFormats.QR_CODE) {
    if (isAislePayload(t)) return parseAisleCode(t) !== null;
    return t.length >= 1;
  }

  if (format !== undefined && NUMERIC_FORMATS.has(format)) {
    return eanChecksumOk(t);
  }

  // CODE_128 / CODE_39 fallback
  if (t.length < 4) return false;
  return /^[\x20-\x7E]+$/.test(t);
}

// ---------- Camera selection ----------
async function pickBackCameraId(): Promise<string | null> {
  try {
    const cams = await Html5Qrcode.getCameras();
    if (!cams || cams.length === 0) return null;
    const backs = cams.filter((c) => /back|rear|environment|arrière|arriere/i.test(c.label));
    if (backs.length === 0) return cams[cams.length - 1].id; // dernière souvent = principale arrière
    // Éviter ultra grand-angle / téléobjectif (mauvaise mise au point de près).
    const main =
      backs.find((c) => !/wide|ultra|tele|zoom|0\.5x|2x|3x/i.test(c.label)) || backs[0];
    return main.id;
  } catch {
    return null;
  }
}

const BarcodeScanner = ({ onScan, loading }: BarcodeScannerProps) => {
  const [scanning, setScanning] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<DolibarrProduct[]>([]);
  const [autocompleteLoading, setAutocompleteLoading] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<string>("scanner-container");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Anti-doublon + double lecture
  const candidateRef = useRef<{ value: string; count: number; ts: number } | null>(null);
  const lastEmittedRef = useRef<{ value: string; ts: number } | null>(null);
  const rejectStatsRef = useRef<{ count: number; firstTs: number; warned: boolean }>({
    count: 0,
    firstTs: 0,
    warned: false,
  });
  const isStartingRef = useRef(false);

  const stopScanner = useCallback(async () => {
    // Attendre la fin d'un démarrage en cours pour éviter de tuer un scanner non encore prêt.
    if (isStartingRef.current) {
      await new Promise((r) => setTimeout(r, 150));
    }
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {}
      try {
        scannerRef.current.clear();
      } catch {}
      scannerRef.current = null;
    }
    setScanning(false);
    setTorchOn(false);
    setTorchSupported(false);
    candidateRef.current = null;
    rejectStatsRef.current = { count: 0, firstTs: 0, warned: false };
  }, []);

  const emit = useCallback(
    (decoded: string) => {
      const now = Date.now();
      // Anti-doublon global : ignorer même valeur dans 1500ms.
      if (
        lastEmittedRef.current &&
        lastEmittedRef.current.value === decoded &&
        now - lastEmittedRef.current.ts < 1500
      ) {
        return;
      }
      lastEmittedRef.current = { value: decoded, ts: now };

      if (isAislePayload(decoded)) {
        const aisle = parseAisleCode(decoded);
        if (aisle) {
          setActiveAisle(aisle);
          if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
          toast.success(`Allée ${aisle} activée`);
        } else {
          const raw = decoded.trim().slice(AISLE_PREFIX.length).trim();
          toast.error(`Allée inconnue : ${raw || "(vide)"}`);
        }
        return;
      }
      onScan(decoded);
    },
    [onScan]
  );

  const handleDecoded = useCallback(
    (decodedText: string, result: any) => {
      const format: number | undefined = result?.result?.format?.format;
      const text = (decodedText || "").trim();

      if (!validateDecoded(text, format)) {
        // Suivi rejets
        const now = Date.now();
        const s = rejectStatsRef.current;
        if (now - s.firstTs > 3000) {
          s.firstTs = now;
          s.count = 1;
          s.warned = false;
        } else {
          s.count += 1;
          if (s.count >= 8 && !s.warned) {
            s.warned = true;
            toast("Code illisible — rapprochez-vous ou nettoyez l'étiquette", {
              duration: 2500,
            });
          }
        }
        return;
      }

      // QR : accepter immédiatement (CRC interne fiable).
      if (format === Html5QrcodeSupportedFormats.QR_CODE) {
        if (navigator.vibrate) navigator.vibrate(100);
        stopScanner();
        emit(text);
        return;
      }

      // 1D : exiger 2 lectures identiques en <800ms.
      const now = Date.now();
      const cand = candidateRef.current;
      if (cand && cand.value === text && now - cand.ts < 800) {
        cand.count += 1;
        cand.ts = now;
        if (cand.count >= 2) {
          if (navigator.vibrate) navigator.vibrate(100);
          stopScanner();
          emit(text);
        }
      } else {
        candidateRef.current = { value: text, count: 1, ts: now };
      }
    },
    [emit, stopScanner]
  );

  const startScanner = useCallback(async () => {
    setCameraError(null);
    setManualMode(false);
    candidateRef.current = null;
    rejectStatsRef.current = { count: 0, firstTs: 0, warned: false };

    isStartingRef.current = true;
    try {
      const scanner = new Html5Qrcode(containerRef.current, {
        verbose: false,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
        ],
        useBarCodeDetectorIfSupported: true,
      } as any);
      scannerRef.current = scanner;
      setScanning(true);

      const isIOS =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

      const camId = await pickBackCameraId();
      const cameraConfig: any = camId ? { deviceId: { exact: camId } } : { facingMode: "environment" };

      await scanner.start(
        cameraConfig,
        {
          fps: isIOS ? 30 : 15,
          qrbox: (vw: number, vh: number) => {
            const w = Math.min(vw * 0.9, 360);
            const h = Math.min(vh * 0.7, 220);
            return { width: Math.floor(w), height: Math.floor(h) };
          },
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: true,
          },
          videoConstraints: isIOS
            ? {
                facingMode: "environment",
                width: { ideal: 1920 },
                height: { ideal: 1080 },
              }
            : {
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
        } as any,
        (decodedText, result) => handleDecoded(decodedText, result),
        () => {}
      );

      // Vérifier le support de la torche.
      try {
        const caps: any = (scanner as any).getRunningTrackCapabilities?.();
        if (caps && (caps.torch === true || caps.torch === false)) {
          setTorchSupported(true);
        }
      } catch {}
    } catch (err: any) {
      setScanning(false);
      scannerRef.current = null;
      setCameraError(
        err?.message?.includes("Permission") || err?.name === "NotAllowedError"
          ? "Accès caméra refusé. Veuillez autoriser l'accès dans les paramètres de votre navigateur."
          : "Impossible d'accéder à la caméra. Vérifiez les permissions."
      );
    } finally {
      isStartingRef.current = false;
    }
  }, [handleDecoded]);

  const toggleTorch = useCallback(async () => {
    const scanner = scannerRef.current as any;
    if (!scanner) return;
    const next = !torchOn;
    try {
      await scanner.applyVideoConstraints({
        advanced: [{ torch: next }],
      });
      setTorchOn(next);
    } catch {
      toast.error("Lampe non disponible sur cet appareil");
      setTorchSupported(false);
    }
  }, [torchOn]);

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
      // Saisie manuelle : on fait confiance et on émet directement (pas de checksum imposé).
      if (isAislePayload(val)) {
        const aisle = parseAisleCode(val);
        if (aisle) {
          setActiveAisle(aisle);
          toast.success(`Allée ${aisle} activée`);
        } else {
          toast.error("Allée inconnue");
        }
      } else {
        onScan(val);
      }
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
            <>
              <button
                onClick={stopScanner}
                className="absolute top-3 right-3 bg-foreground/70 text-background rounded-full p-2 touch-target"
                aria-label="Fermer le scanner"
              >
                <X size={20} />
              </button>
              {torchSupported && (
                <button
                  onClick={toggleTorch}
                  className="absolute top-3 left-3 bg-foreground/70 text-background rounded-full p-2 touch-target"
                  aria-label={torchOn ? "Éteindre la lampe" : "Allumer la lampe"}
                >
                  {torchOn ? <FlashlightOff size={20} /> : <Flashlight size={20} />}
                </button>
              )}
            </>
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
