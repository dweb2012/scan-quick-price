import { MapPin, X } from "lucide-react";
import { clearActiveAisle } from "@/lib/aisle";
import { useActiveAisle } from "@/hooks/use-active-aisle";
import { toast } from "sonner";

const AisleBanner = () => {
  const aisle = useActiveAisle();
  if (!aisle) return null;

  return (
    <div className="bg-primary text-primary-foreground px-4 py-2 flex items-center justify-between gap-2 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <MapPin size={16} className="shrink-0" />
        <span className="font-semibold truncate">
          Allée active : <span className="font-bold">{aisle}</span>
        </span>
      </div>
      <button
        onClick={() => {
          clearActiveAisle();
          toast.info("Allée désactivée");
        }}
        className="shrink-0 inline-flex items-center gap-1 bg-primary-foreground/15 hover:bg-primary-foreground/25 rounded-full px-3 py-1 touch-target text-xs font-medium transition-colors"
      >
        <X size={14} /> Quitter
      </button>
    </div>
  );
};

export default AisleBanner;