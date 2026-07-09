import { ScanLine, History, Settings, Users, ClipboardList } from "lucide-react";

export type Tab = "scanner" | "history" | "unknown" | "settings" | "admin";

interface BottomNavProps {
  active: Tab;
  onChange: (tab: Tab) => void;
  showAdmin?: boolean;
  unknownPendingCount?: number;
}

const BottomNav = ({ active, onChange, showAdmin, unknownPendingCount = 0 }: BottomNavProps) => {
  const items: { id: Tab; label: string; icon: typeof ScanLine }[] = [
    { id: "scanner", label: "Scanner", icon: ScanLine },
    { id: "settings", label: "Paramètres", icon: Settings },
  ];

  if (showAdmin) {
    items.push({ id: "admin", label: "Utilisateurs", icon: Users });
  }

  return (
    <nav className="bg-bottomnav border-t border-border flex items-stretch justify-around shadow-[0_-2px_10px_rgba(0,0,0,0.05)] z-50 pb-safe">
      {items.map(({ id, label, icon: Icon }) => {
        const isActive = active === id;
        const showBadge = id === "unknown" && unknownPendingCount > 0;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={`relative flex-1 flex flex-col items-center justify-center gap-1 py-3 touch-target transition-colors ${
              isActive
                ? "text-bottomnav-active"
                : "text-bottomnav-foreground"
            }`}
          >
            <div className="relative">
              <Icon size={24} strokeWidth={isActive ? 2.5 : 1.5} />
              {showBadge && (
                <span className="absolute -top-1.5 -right-2 bg-stock-low text-white text-[10px] font-bold leading-none min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center">
                  {unknownPendingCount > 99 ? "99+" : unknownPendingCount}
                </span>
              )}
            </div>
            <span className="text-xs font-medium">{label}</span>
          </button>
        );
      })}
    </nav>
  );
};

export default BottomNav;
