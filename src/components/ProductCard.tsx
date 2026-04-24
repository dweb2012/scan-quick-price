import { useState, useEffect } from "react";
import { DolibarrProduct, getPriceHT, fetchProductImageBlob, getSupplierDiscountForProduct, getProductPromos, PromoPrice, updateProductStock, updateProductExtrafields, getWarehouses } from "@/lib/dolibarr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanLine, Package, Tag, Truck, MapPin, Loader2, RotateCcw, Edit2, Plus, Minus, Save, X, Warehouse, Printer } from "lucide-react";
import { toast } from "sonner";
import { printProductLabel } from "@/lib/labelPdf";

interface ProductCardProps {
  product: DolibarrProduct;
  onScanNext: () => void;
}

const formatPrice = (n: number) =>
  n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

const StockBadge = ({ stock }: { stock: number }) => {
  const color =
    stock > 5 ? "bg-stock-ok" : stock > 0 ? "bg-stock-low" : "bg-stock-out";
  const label = stock > 0 ? `${stock} en stock` : "Rupture de stock";
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
      await updateProductStock(product.id, finalQty, selectedWarehouse);
      toast.success(`Stock mis à jour (${direction === "in" ? "+" : "-"}${q})`);
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

const LocationEditor = ({ product }: { product: DolibarrProduct }) => {
  const opts = product.array_options || {};
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(opts.options_emplacement || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProductExtrafields(product.id, { options_emplacement: value });
      toast.success("Emplacement mis à jour");
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message || "Erreur mise à jour emplacement");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
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
        <button onClick={() => setOpen(false)} className="text-muted-foreground">
          <X size={18} />
        </button>
      </div>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ex: Allée 3, Étagère B2"
        className="touch-target text-base"
        autoFocus
      />
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
  const emplacement = opts.options_emplacement || "";
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

      {(marque || fournisseur || emplacement) && (
        <div className="w-full max-w-sm bg-card rounded-xl p-3 shadow border border-border space-y-2">
          {marque && <InfoRow icon={Tag} label="Marque" value={marque} />}
          {fournisseur && <InfoRow icon={Truck} label="Fournisseur" value={fournisseur} />}
          {emplacement && <InfoRow icon={MapPin} label="Emplacement" value={emplacement} />}
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
      <div className="flex gap-2 w-full max-w-sm">
        <StockEditor product={product} />
        <LocationEditor product={product} />
      </div>

      <Button
        onClick={handlePrint}
        disabled={printing}
        variant="secondary"
        size="lg"
        className="touch-target text-base font-semibold gap-2 w-full max-w-sm"
      >
        {printing ? <Loader2 size={20} className="animate-spin" /> : <Printer size={20} />}
        Imprimer étiquette (57×32 mm)
      </Button>

      <Button onClick={onScanNext} size="lg" className="touch-target text-base font-semibold gap-2 w-full max-w-sm mt-2">
        <ScanLine size={22} />
        Scanner suivant
      </Button>
    </div>
  );
};

export default ProductCard;