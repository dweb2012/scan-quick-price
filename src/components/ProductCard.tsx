import { DolibarrProduct, getDiscountedPrice, getPriceTTC } from "@/lib/dolibarr";
import { Button } from "@/components/ui/button";
import { ScanLine, Package, Tag, Truck, MapPin } from "lucide-react";

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

const ProductCard = ({ product, onScanNext }: ProductCardProps) => {
  const priceTtc = getPriceTTC(product);
  const discounted = getDiscountedPrice(product);

  const opts = product.array_options || {};
  const marque = opts.options_marque || "";
  const fournisseur = opts.options_fournisseur || "";
  const emplacement = opts.options_emplacement || "";

  const imgSrc = product.imageUrl || product.image;

  return (
    <div className="flex flex-col items-center flex-1 px-4 py-6 gap-5 overflow-y-auto">
      {/* Product image */}
      {imgSrc ? (
        <img
          src={imgSrc}
          alt={product.label}
          className="w-40 h-40 object-contain rounded-xl bg-card shadow"
        />
      ) : (
        <div className="w-40 h-40 rounded-xl bg-card shadow flex items-center justify-center">
          <Package className="text-muted-foreground" size={56} />
        </div>
      )}

      {/* Name & ref */}
      <div className="text-center">
        <h2 className="text-xl font-bold leading-tight">{product.label}</h2>
        <p className="text-sm text-muted-foreground mt-1">Réf: {product.ref}</p>
      </div>

      {/* Extra info: marque, fournisseur, emplacement */}
      {(marque || fournisseur || emplacement) && (
        <div className="w-full max-w-sm bg-card rounded-xl p-3 shadow border border-border space-y-2">
          {marque && <InfoRow icon={Tag} label="Marque" value={marque} />}
          {fournisseur && <InfoRow icon={Truck} label="Fournisseur" value={fournisseur} />}
          {emplacement && <InfoRow icon={MapPin} label="Emplacement" value={emplacement} />}
        </div>
      )}

      {/* Price blocks */}
      <div className="grid grid-cols-2 gap-3 w-full max-w-sm">
        {/* Prix Public */}
        <div className="bg-card rounded-xl p-4 shadow text-center border border-border">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
            Prix Public
          </p>
          <p className="text-2xl font-extrabold text-price-public">
            {formatPrice(priceTtc)}
          </p>
        </div>

        {/* Prix Remisé */}
        <div className="bg-accent/10 rounded-xl p-4 shadow text-center border border-accent/30 relative">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
            Prix Remisé
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

      {/* Stock */}
      <StockBadge stock={product.stock_reel ?? 0} />

      {/* Next scan */}
      <Button onClick={onScanNext} size="lg" className="touch-target text-base font-semibold gap-2 w-full max-w-sm mt-2">
        <ScanLine size={22} />
        Scanner suivant
      </Button>
    </div>
  );
};

export default ProductCard;
