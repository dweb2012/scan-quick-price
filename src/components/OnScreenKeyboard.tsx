import { Delete, CornerDownLeft, Space } from "lucide-react";
import { Button } from "@/components/ui/button";

interface OnScreenKeyboardProps {
  onKey: (char: string) => void;
  onBackspace: () => void;
  onEnter: () => void;
  onClose?: () => void;
}

const ROWS: string[][] = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["A", "Z", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["Q", "S", "D", "F", "G", "H", "J", "K", "L", "M"],
  ["W", "X", "C", "V", "B", "N", "-", "_", ".", "/"],
];

const OnScreenKeyboard = ({ onKey, onBackspace, onEnter }: OnScreenKeyboardProps) => {
  return (
    <div className="mt-3 w-full bg-card border border-border rounded-xl p-2 shadow-sm select-none">
      {ROWS.map((row, i) => (
        <div key={i} className="flex gap-1 mb-1 justify-center">
          {row.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onKey(k)}
              className="flex-1 min-h-[44px] rounded-md bg-background border border-border text-sm font-semibold active:bg-accent"
            >
              {k}
            </button>
          ))}
        </div>
      ))}
      <div className="flex gap-1 mt-1">
        <button
          type="button"
          onClick={() => onKey(" ")}
          className="flex-[3] min-h-[44px] rounded-md bg-background border border-border flex items-center justify-center active:bg-accent"
          aria-label="Espace"
        >
          <Space size={18} />
        </button>
        <button
          type="button"
          onClick={onBackspace}
          className="flex-1 min-h-[44px] rounded-md bg-background border border-border flex items-center justify-center active:bg-accent"
          aria-label="Effacer"
        >
          <Delete size={18} />
        </button>
        <Button
          type="button"
          onClick={onEnter}
          className="flex-1 min-h-[44px]"
          aria-label="Valider"
        >
          <CornerDownLeft size={18} />
        </Button>
      </div>
    </div>
  );
};

export default OnScreenKeyboard;