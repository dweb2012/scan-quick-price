import { useState, useEffect } from "react";
import { DolibarrProduct, getPriceHT, fetchProductImageBlob, getSupplierDiscountForProduct } from "@/lib/dolibarr";
import { Button } from "@/components/ui/button";
import { ScanLine, Package, Tag, Truck, MapPin, Loader2, RotateCcw } from "lucide-react";

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

const ProductCard = ({ product, onScanNext }: ProductCardProps) => {
  const priceHt = getPriceHT(product);
  const [discounted, setDiscounted] = useState<{ price: number; discount: number } | null>(null);

  useEffect(() => {
    getSupplierDiscountForProduct(product).then(setDiscounted);
  }, [product.id]);

  const opts = product.array_options || {};
  const marque = opts.options_marque || "";
  const fournisseur = product.supplierName || opts.options_fournisseur || "";
  const emplacement = opts.options_emplacement || "";

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
            Remisé HT
          </p>
          {discounted ? (
            <>
              <p className="text-2xl font-extrabold text-price-remise">
                {formatPrice(discounted.price)}
              </p>
              <span className="absolute -top-2 -right-2 bg-accent text-accent-foreground text-xs font-bold px-2 py-0.5 rounded-full">
                -{discounted.discount}%
              </span>
            </>
          ) : (
            <p className="text-lg text-muted-foreground">—</p>
          )}
        </div>
      </div>

      <StockBadge stock={product.stock_reel ?? 0} />

      <Button onClick={onScanNext} size="lg" className="touch-target text-base font-semibold gap-2 w-full max-w-sm mt-2">
        <ScanLine size={22} />
        Scanner suivant
      </Button>
    </div>
  );
};

export default ProductCard;
