import { useState, useEffect } from "react";
import { DolibarrProduct, getPriceHT, fetchProductImageBlob, getSupplierDiscountForProduct, getProductPromos, PromoPrice, updateProductStock, updateProductExtrafields, getWarehouses } from "@/lib/dolibarr";
import { updateStockInSheet, isCasB, sendCasB } from "@/lib/exportCasB";
import { getAutoSendCasB } from "@/lib/prefs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanLine, Package, Tag, Truck, MapPin, Loader2, RotateCcw, Edit2, Plus, Minus, Save, X, Warehouse, Printer, AlertTriangle, Send } from "lucide-react";
import { toast } from "sonner";
import { printProductLabel } from "@/lib/labelPdf";
import { useActiveAisle } from "@/hooks/use-active-aisle";
import { parseEmplacement, formatEmplacement } from "@/lib/aisle";
import { expandAisles, getAisleEntry, isValidAisle, formatAisleLabel, getAisleGroups } from "@/lib/aisleCatalog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

const AisleCombobox = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const groups = getAisleGroups();
  const currentEntry = getAisleEntry(value);
  const isOutOfList = !!value && !currentEntry;

  const triggerLabel = !value
    ? "Choisir une allée…"
    : currentEntry
      ? currentEntry.label
      : `${value} (Hors liste)`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between touch-target font-normal",
            !value && "text-muted-foreground",
            isOutOfList && "border-stock-low text-stock-low"
          )}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0 bg-popover z-50"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Rechercher une allée…" className="h-10" />
          <CommandList className="max-h-72">
            <CommandEmpty>Aucune allée trouvée.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__none__"
                onSelect={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                <span className="text-muted-foreground italic">Aucune allée</span>
              </CommandItem>
              {isOutOfList && (
                <CommandItem
                  value={value}
                  onSelect={() => setOpen(false)}
                >
                  <Check className="mr-2 h-4 w-4 opacity-100" />
                  <span className="text-stock-low">{value} (Hors liste — à réassigner)</span>
                </CommandItem>
              )}
            </CommandGroup>
            {groups.map((g) => (
              <CommandGroup key={g.zoneCode} heading={g.zoneName}>
                {g.entries.map((entry) => (
                  <CommandItem
                    key={entry.code}
                    value={`${entry.code} ${entry.zoneName}`}
                    onSelect={() => {
                      onChange(entry.code);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value.toUpperCase() === entry.code.toUpperCase() ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="font-semibold">{entry.code}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{entry.zoneName}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

interface ProductCardProps {
  product: DolibarrProduct;
  onScanNext: () => void;
}

const formatPrice = (n: number) =>
  n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

const StockBadge = ({ stock }: { stock: number }) => {
  const color =
    stock > 5 ? "bg-stock-ok" : stock > 0 ? "bg-stock-low" : "bg-stock-out";
  const label = stock > 0 ? `${stock} en stock` : `Rupture (${stock})`;
  return (
    <span className={`${color} text-white text-xs font-semibold px-3 py-1 rounded-full`}>
      {label}
    </span>
  );
};

const InfoRow = ({ icon: Icon, label, value }: { icon: any; label: string; value: string }) => (
  <div className="flex items-center gap-2 text-sm">
    <Icon size={16} className="text-muted-foreground shrink-0" />
    <span className="text-muted-foreground">{label} :</span>
    <span className="font-medium truncate">{value}</span>
  </div>
);

const ProductImage = ({ product }: { product: DolibarrProduct }) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadImage = async () => {
    setLoading(true);
    setError(false);
    try {
      const url = await fetchProductImageBlob(product);
      if (url) {
        setImageUrl(url);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadImage();
  }, [product.id]);

  useEffect(() => {
    return () => {
      if (imageUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  if (loading) {
    return (
      <div className="w-40 h-40 rounded-xl bg-card shadow flex items-center justify-center">
        <Loader2 className="text-muted-foreground animate-spin" size={32} />
      </div>
    );
  }

  if (error || !imageUrl) {
    return (
      <div className="w-40 h-40 rounded-xl bg-card shadow flex flex-col items-center justify-center gap-2">
        <Package className="text-muted-foreground" size={48} />
        <Button variant="ghost" size="sm" onClick={loadImage} className="text-xs gap-1">
          <RotateCcw size={12} /> Réessayer
        </Button>
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      alt={product.label}
      className="w-40 h-40 object-contain rounded-xl bg-card shadow"
      onError={() => setError(true)}
    />
  );
};

const StockEditor = ({ product }: { product: DolibarrProduct }) => {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState("1");
  const [warehouses, setWarehouses] = useState<{ id: number; label: string }[]>([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [direction, setDirection] = useState<"in" | "out">("in");

  useEffect(() => {
    if (open && warehouses.length === 0) {
      getWarehouses().then((wh) => {
        setWarehouses(wh);
        if (wh.length > 0) setSelectedWarehouse(wh[0].id);
      }).catch(() => toast.error("Impossible de charger les entrepôts"));
    }
  }, [open]);

  const handleSave = async () => {
    const q = parseInt(qty);
    if (!q || q <= 0 || !selectedWarehouse) return;
    setSaving(true);
    try {
      const finalQty = direction === "in" ? q : -q;
      // Mise à jour Dolibarr désactivée temporairement — seul le Google Sheet est mis à jour.
      // await updateProductStock(product.id, finalQty, selectedWarehouse);
      const newStock = (product.stock_reel ?? 0) + finalQty;
      product.stock_reel = newStock;
      await updateStockInSheet(product.ref, newStock);
      toast.success(`Stock mis à jour (${direction === "in" ? "+" : "-"}${q})`);
      if (isCasB(product) && getAutoSendCasB()) {
        sendCasB(product).catch((e) => console.warn("auto CAS B failed", e));
      }
      setOpen(false);
      setQty("1");
    } catch (e: any) {
      toast.error(e.message || "Erreur mise à jour stock");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1 touch-target">
        <Edit2 size={14} /> Modifier stock
      </Button>
    );
  }

  return (
    <div className="w-full max-w-sm bg-card rounded-xl p-4 shadow border border-border space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Mouvement de stock</h3>
        <button onClick={() => setOpen(false)} className="text-muted-foreground">
          <X size={18} />
        </button>
      </div>

      <div className="flex gap-2">
        <Button
          variant={direction === "in" ? "default" : "outline"}
          size="sm"
          onClick={() => setDirection("in")}
          className="flex-1 gap-1 touch-target"
        >
          <Plus size={14} /> Entrée
        </Button>
        <Button
          variant={direction === "out" ? "destructive" : "outline"}
          size="sm"
          onClick={() => setDirection("out")}
          className="flex-1 gap-1 touch-target"
        >
          <Minus size={14} /> Sortie
        </Button>
      </div>

      <Input
        type="number"
        min="1"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        placeholder="Quantité"
        className="touch-target text-base"
      />

      {warehouses.length > 0 && (
        <select
          value={selectedWarehouse ?? ""}
          onChange={(e) => setSelectedWarehouse(parseInt(e.target.value))}
          className="w-full h-12 rounded-lg border border-border bg-background px-3 text-sm"
        >
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.label}</option>
          ))}
        </select>
      )}

      <Button
        onClick={handleSave}
        disabled={saving || !parseInt(qty) || !selectedWarehouse}
        className="w-full touch-target gap-2"
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        Valider
      </Button>
    </div>
  );
};

const LocationEditor = ({
  product,
  open: openProp,
  initialAisle,
  onClose,
}: {
  product: DolibarrProduct;
  open?: boolean;
  initialAisle?: string;
  onClose?: () => void;
}) => {
  const opts = product.array_options || {};
  const activeAisle = useActiveAisle();
  const initialParsed = parseEmplacement(opts.options_emplacement);
  const [open, setOpen] = useState(false);
  const [aisle, setAisle] = useState<string>(
    initialParsed.aisle || activeAisle || ""
  );
  const [saving, setSaving] = useState(false);

  const isOpen = openProp ?? open;

  useEffect(() => {
    if (openProp) {
      if (initialAisle !== undefined) setAisle(initialAisle);
    }
  }, [openProp, initialAisle]);

  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const value = formatEmplacement(aisle, "");
      await updateProductExtrafields(product.id, { options_emplacement: value });
      // Mutation locale pour refléter la nouvelle valeur avant l'envoi Sheet
      product.array_options = {
        ...(product.array_options || {}),
        options_emplacement: value,
      };
      toast.success("Emplacement mis à jour");
      if (isCasB(product) && getAutoSendCasB()) {
        sendCasB(product).catch((e) => console.warn("auto CAS B failed", e));
      }
      handleClose();
    } catch (e: any) {
      toast.error(e.message || "Erreur mise à jour emplacement");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1 touch-target">
        <Edit2 size={14} /> Modifier emplacement
      </Button>
    );
  }

  return (
    <div className="w-full max-w-sm bg-card rounded-xl p-4 shadow border border-border space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Emplacement</h3>
        <button onClick={handleClose} className="text-muted-foreground">
          <X size={18} />
        </button>
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground font-medium">Allée</label>
        <AisleCombobox value={aisle} onChange={setAisle} />
      </div>
      <Button
        onClick={handleSave}
        disabled={saving}
        className="w-full touch-target gap-2"
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        Enregistrer
      </Button>
    </div>
  );
};

const ProductCard = ({ product, onScanNext }: ProductCardProps) => {
  const priceHt = getPriceHT(product);
  const [discounted, setDiscounted] = useState<{ price: number; discount: number } | null>(null);
  const [promos, setPromos] = useState<PromoPrice[]>([]);
  const [printing, setPrinting] = useState(false);
  const activeAisle = useActiveAisle();
  const [aisleEditorOpen, setAisleEditorOpen] = useState(false);
  const [aisleEditorInitialAisle, setAisleEditorInitialAisle] = useState<string>("");
  const [storing, setStoring] = useState(false);
  const [emplacementOverride, setEmplacementOverride] = useState<string | null>(null);
  const [sendingCasB, setSendingCasB] = useState(false);
  const productIsCasB = isCasB(product);

  const handleSendCasB = async () => {
    setSendingCasB(true);
    try {
      await sendCasB(product);
      toast.success("Ajouté à l'onglet B");
    } catch (e: any) {
      toast.error(`Échec: ${e?.message || "erreur"}`);
    } finally {
      setSendingCasB(false);
    }
  };

  const handlePrint = async () => {
    setPrinting(true);
    try {
      await printProductLabel(product);
    } catch (e: any) {
      toast.error(e?.message || "Erreur génération étiquette");
    } finally {
      setPrinting(false);
    }
  };

  useEffect(() => {
    getSupplierDiscountForProduct(product).then(setDiscounted);
    getProductPromos(product.id).then(setPromos);
  }, [product.id]);

  const opts = product.array_options || {};
  const marque = opts.options_marque || "";
  const fournisseur = product.supplierName || opts.options_fournisseur || "";
  const emplacement = emplacementOverride ?? opts.options_emplacement ?? "";
  const parsed = parseEmplacement(emplacement);
  const productAisle = parsed.aisle;
  const productSpot = parsed.spot;
  const aisleMismatch =
    !!productAisle && !!activeAisle && productAisle !== activeAisle;

  const handleStoreHere = async () => {
    if (!activeAisle || storing) return;
    setStoring(true);
    try {
      const value = formatEmplacement(activeAisle, productSpot);
      await updateProductExtrafields(product.id, { options_emplacement: value });
      // Mutation locale pour refléter immédiatement la nouvelle valeur
      product.array_options = {
        ...(product.array_options || {}),
        options_emplacement: value,
      };
      setEmplacementOverride(value);
      toast.success(`Rangé dans ${activeAisle}`);
      if (productIsCasB && getAutoSendCasB()) {
        sendCasB(product).catch((e) => console.warn("auto CAS B failed", e));
      }
    } catch (e: any) {
      toast.error(e?.message || "Erreur mise à jour emplacement");
    } finally {
      setStoring(false);
    }
  };
  const primaryPromo = promos.reduce<PromoPrice | null>((bestPromo, promo) => {
    if (promo.price == null) return bestPromo;
    if (!bestPromo || promo.price < (bestPromo.price ?? Number.POSITIVE_INFINITY)) {
      return promo;
    }
    return bestPromo;
  }, null);
  const highlightedPrice = primaryPromo?.price ?? discounted?.price ?? null;
  const highlightedLabel = primaryPromo ? "Promo HT" : "Remisé HT";
  const highlightedBadge = primaryPromo
    ? primaryPromo.discount != null && primaryPromo.discount > 0
      ? `-${primaryPromo.discount}%`
      : "PROMO"
    : discounted
      ? `-${discounted.discount}%`
      : null;

  return (
    <div className="flex flex-col items-center flex-1 px-4 py-6 gap-5 overflow-y-auto">
      <ProductImage product={product} />

      <div className="text-center">
        <h2 className="text-xl font-bold leading-tight">{product.label}</h2>
        <p className="text-sm text-muted-foreground mt-1">Réf: {product.ref}</p>
      </div>

      {(marque || fournisseur || productAisle || productSpot) && (
        <div className="w-full max-w-sm bg-card rounded-xl p-3 shadow border border-border space-y-2">
          {marque && <InfoRow icon={Tag} label="Marque" value={marque} />}
          {fournisseur && <InfoRow icon={Truck} label="Fournisseur" value={fournisseur} />}
          {productAisle && (
            <div className="flex items-center gap-2 text-sm">
              <MapPin size={16} className="text-primary shrink-0" />
              <span className="text-muted-foreground">Allée :</span>
              <span
                className={
                  isValidAisle(productAisle)
                    ? "font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-md"
                    : "font-bold bg-stock-low/10 text-stock-low px-2 py-0.5 rounded-md"
                }
                title={formatAisleLabel(productAisle) || productAisle}
              >
                {productAisle}
                {!isValidAisle(productAisle) && (
                  <span className="ml-1 text-[10px] uppercase">Hors liste</span>
                )}
              </span>
              {isValidAisle(productAisle) && (
                <span className="text-xs text-muted-foreground">
                  {getAisleEntry(productAisle)?.zoneName}
                </span>
              )}
              {aisleMismatch && (
                <span className="ml-auto inline-flex items-center gap-1 text-xs text-stock-low font-medium">
                  <AlertTriangle size={12} /> Pas dans l'allée scannée
                </span>
              )}
            </div>
          )}
          {productSpot && <InfoRow icon={MapPin} label="Emplacement" value={productSpot} />}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 w-full max-w-sm">
        <div className="bg-card rounded-xl p-4 shadow text-center border border-border">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
            Prix HT
          </p>
          <p className="text-2xl font-extrabold text-price-public">
            {formatPrice(priceHt)}
          </p>
        </div>

        <div className="bg-accent/10 rounded-xl p-4 shadow text-center border border-accent/30 relative">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
            {highlightedLabel}
          </p>
          {highlightedPrice != null ? (
            <>
              <p className="text-2xl font-extrabold text-price-remise">
                {formatPrice(highlightedPrice)}
              </p>
              {highlightedBadge && (
                <span className="absolute -top-2 -right-2 bg-accent text-accent-foreground text-xs font-bold px-2 py-0.5 rounded-full">
                  {highlightedBadge}
                </span>
              )}
            </>
          ) : (
            <p className="text-lg text-muted-foreground">—</p>
          )}
        </div>
      </div>

      {/* Active promos from Dolibarr plugin */}
      {promos.length > 0 && (
        <div className="w-full max-w-sm bg-card rounded-xl p-4 shadow border border-accent/30 space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-accent flex items-center gap-1">
            <Tag size={14} /> Promo active
          </p>
          {promos.map((promo) => (
            <div key={promo.id} className="flex items-center justify-between">
              <div className="text-sm">
                {promo.label && <span className="font-medium">{promo.label}</span>}
                {promo.date_end && (
                  <span className="text-xs text-muted-foreground ml-2">
                    jusqu'au {new Date(promo.date_end).toLocaleDateString("fr-FR")}
                  </span>
                )}
              </div>
              <div className="text-right">
                {promo.price != null && (
                  <span className="text-lg font-extrabold text-price-remise">
                    {formatPrice(promo.price)}
                  </span>
                )}
                {promo.discount != null && promo.discount > 0 && (
                  <span className="ml-2 bg-accent text-accent-foreground text-xs font-bold px-2 py-0.5 rounded-full">
                    -{promo.discount}%
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <StockBadge stock={product.stock_reel ?? 0} />

      {/* Stock & Location editors */}
      <div className="flex gap-2 w-full max-w-sm flex-wrap">
        <StockEditor product={product} />
        <LocationEditor product={product} />
        {activeAisle && productAisle !== activeAisle && (
          <Button
            variant="default"
            size="sm"
            onClick={handleStoreHere}
            disabled={storing}
            className="gap-1 touch-target"
          >
            {storing ? <Loader2 size={14} className="animate-spin" /> : <MapPin size={14} />}
            Ranger dans ({activeAisle})
          </Button>
        )}
      </div>

      {aisleEditorOpen && (
        <LocationEditor
          product={product}
          open={aisleEditorOpen}
          initialAisle={aisleEditorInitialAisle}
          onClose={() => setAisleEditorOpen(false)}
        />
      )}

      <Button
        onClick={handlePrint}
        disabled={printing}
        variant="secondary"
        size="lg"
        className="touch-target text-base font-semibold gap-2 w-full max-w-sm"
      >
        {printing ? <Loader2 size={20} className="animate-spin" /> : <Printer size={20} />}
        Imprimer étiquette (54 × 70 mm)
      </Button>

      {productIsCasB && (
        <Button
          onClick={handleSendCasB}
          disabled={sendingCasB}
          variant="outline"
          size="lg"
          className="touch-target text-base font-semibold gap-2 w-full max-w-sm border-accent text-accent hover:bg-accent/10"
        >
          {sendingCasB ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
          Envoyer à l'onglet B
        </Button>
      )}

      <Button onClick={onScanNext} size="lg" className="touch-target text-base font-semibold gap-2 w-full max-w-sm mt-2">
        <ScanLine size={22} />
        Scanner suivant
      </Button>
    </div>
  );
};

export default ProductCard;