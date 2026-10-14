import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { callDolibarrAuth } from "@/lib/dolibarrAuth";

const Sso = () => {
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("t");
    window.history.replaceState(null, "", window.location.pathname);
    (async () => {
      try {
        if (!token) throw new Error("Lien invalide, rouvrez l'application depuis Dolibarr");
        await supabase.auth.signOut();
        const token_hash = await callDolibarrAuth({ mode: "hub", token });
        const { error } = await supabase.auth.verifyOtp({ token_hash, type: "email" });
        if (error) throw error;
        window.location.replace("/");
      } catch (e: any) {
        setError(e?.message || "Connexion impossible");
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 text-center gap-4">
      {error ? (
        <>
          <p className="text-destructive font-medium max-w-sm">{error}</p>
          <a href="/" className="text-primary underline touch-target">Aller à la page de connexion</a>
        </>
      ) : (
        <>
          <Loader2 className="animate-spin text-primary" size={32} />
          <p className="text-muted-foreground text-sm">Connexion avec Dolibarr…</p>
        </>
      )}
    </div>
  );
};

export default Sso;
