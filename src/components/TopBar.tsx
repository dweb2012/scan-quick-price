import { Wifi, WifiOff } from "lucide-react";

const TopBar = ({ online = true }: { online?: boolean }) => (
  <header className="bg-topbar text-topbar-foreground px-4 py-3 flex items-center justify-center shadow-md z-50 safe-area-top relative">
    <h1 className="text-lg font-bold tracking-tight">CHR PriceScanner</h1>
    <div className="absolute right-4 top-1/2 -translate-y-1/2">
      {online ? (
        <Wifi size={16} className="text-topbar-foreground/60" />
      ) : (
        <WifiOff size={16} className="text-destructive" />
      )}
    </div>
  </header>
);

export default TopBar;
