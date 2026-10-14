import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { callDolibarrAuth } from "@/lib/dolibarrAuth";

const Auth = () => {
  const [mode, setMode] = useState<"dolibarr" | "email">("dolibarr");
  const [login, setLogin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleDolibarr = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const token_hash = await callDolibarrAuth({ mode: "password", login: login.trim(), password });
      const { error } = await supabase.auth.verifyOtp({ token_hash, type: "email" });
      if (error) throw error;
      setPassword("");
      window.history.replaceState(null, "", "/");
    } catch (err: any) {
      toast.error(err.message || "Erreur d'authentification");
    } finally {
      setLoading(false);
    }
  };

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (err: any) {
      toast.error(err.message || "Erreur d'authentification");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <ScanLine className="text-primary" size={32} />
          </div>
          <h1 className="text-2xl font-bold">CHR Elite Scan</h1>
          <p className="text-muted-foreground text-sm">
            {mode === "dolibarr" ? "Se connecter avec Dolibarr" : "Connexion avec un autre compte"}
          </p>
        </div>

        {mode === "dolibarr" ? (
          <form onSubmit={handleDolibarr} className="space-y-4">
            <Input
              placeholder="Identifiant Dolibarr"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              required
              className="touch-target text-base"
            />
            <Input
              type="password"
              placeholder="Mot de passe Dolibarr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="touch-target text-base"
            />
            <Button type="submit" className="w-full touch-target text-base" disabled={loading}>
              {loading && <Loader2 size={16} className="animate-spin mr-2" />}
              Se connecter avec Dolibarr
            </Button>
          </form>
        ) : (
          <form onSubmit={handleEmail} className="space-y-4">
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="touch-target text-base"
            />
            <Input
              type="password"
              placeholder="Mot de passe"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="touch-target text-base"
            />
            <Button type="submit" className="w-full touch-target text-base" disabled={loading}>
              {loading && <Loader2 size={16} className="animate-spin mr-2" />}
              Se connecter
            </Button>
          </form>
        )}

        <button
          type="button"
          className="w-full text-sm text-primary underline touch-target"
          onClick={() => { setMode(mode === "dolibarr" ? "email" : "dolibarr"); setPassword(""); }}
        >
          {mode === "dolibarr" ? "Autre compte" : "Se connecter avec Dolibarr"}
        </button>
      </div>
    </div>
  );
};

export default Auth;
