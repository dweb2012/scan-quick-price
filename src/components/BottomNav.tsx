import { ScanLine, History, Settings } from "lucide-react";

type Tab = "scanner" | "history" | "settings";

interface BottomNavProps {
  active: Tab;
  onChange: (tab: Tab) => void;
}

const items: { id: Tab; label: string; icon: typeof ScanLine }[] = [
  { id: "scanner", label: "Scanner", icon: ScanLine },
  { id: "history", label: "Historique", icon: History },
  { id: "settings", label: "Paramètres", icon: Settings },
];

const BottomNav = ({ active, onChange }: BottomNavProps) => (
  <nav className="bg-bottomnav border-t border-border flex items-stretch justify-around shadow-[0_-2px_10px_rgba(0,0,0,0.05)] z-50 pb-safe">
    {items.map(({ id, label, icon: Icon }) => {
      const isActive = active === id;
      return (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 touch-target transition-colors ${
            isActive
              ? "text-bottomnav-active"
              : "text-bottomnav-foreground"
          }`}
        >
          <Icon size={24} strokeWidth={isActive ? 2.5 : 1.5} />
          <span className="text-xs font-medium">{label}</span>
        </button>
      );
    })}
  </nav>
);

export default BottomNav;
