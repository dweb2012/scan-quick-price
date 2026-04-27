import { useEffect, useState } from "react";
import { DolibarrProduct } from "@/lib/dolibarr";
import { generateLabelPdf, getLabelOrientation, LabelOrientation } from "@/lib/labelPdf";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Printer, X } from "lucide-react";

interface Props {
  product: DolibarrProduct;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPrint: () => void;
  printing?: boolean;
}

const LabelPreviewDialog = ({ product, open, onOpenChange, onPrint, printing }: Props) => {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [orientation, setOrientation] = useState<LabelOrientation>(getLabelOrientation());

  useEffect(() => {
    if (!open) return;
    setOrientation(getLabelOrientation());
    let revoked: string | null = null;
    setLoading(true);
    generateLabelPdf(product)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        revoked = url;
        setPdfUrl(url);
      })
      .finally(() => setLoading(false));
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
      setPdfUrl(null);
    };
  }, [open, product.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Aperçu étiquette — {orientation === "landscape" ? "Paysage 57×32 mm" : "Portrait 32×57 mm"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-center bg-muted rounded-lg p-4 min-h-[400px]">
          {loading || !pdfUrl ? (
            <Loader2 className="animate-spin text-muted-foreground" size={32} />
          ) : (
            <iframe
              src={`${pdfUrl}#toolbar=0&navpanes=0&view=FitH`}
              title="Aperçu étiquette"
              className="w-full h-[400px] rounded border border-border bg-white"
            />
          )}
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Réf, libellé, code-barres et prix tels qu'ils seront imprimés sur la DYMO 30334, sans changement de format Windows.
        </p>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="gap-2">
            <X size={16} /> Fermer
          </Button>
          <Button onClick={onPrint} disabled={printing} className="gap-2">
            {printing ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
            Imprimer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LabelPreviewDialog;
