import { useState, useEffect } from "react";
import { getSettings, saveSettings, testConnection } from "@/lib/dolibarr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, EyeOff, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

const SettingsPanel = () => {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);

  useEffect(() => {
    getSettings().then((s) => {
      setBaseUrl(s.baseUrl);
      setApiKey(s.apiKey);
      setLoadingSettings(false);
    });
  }, []);

  const handleSave = async () => {
    await saveSettings({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() });
    toast.success("Paramètres enregistrés");
  };

  const handleTest = async () => {
    // Save first so test uses latest values
    await saveSettings({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() });
    setTesting(true);
    try {
      await testConnection();
      toast.success("Connexion réussie !", {
        icon: <CheckCircle2 className="text-accent" size={18} />,
      });
    } catch (err: any) {
      const msg = err?.message || "Erreur inconnue";
      const isCors = msg.includes("Failed to fetch") || msg.includes("NetworkError");
      toast.error(
        isCors
          ? "Erreur réseau — vérifiez que le serveur Dolibarr autorise les requêtes CORS depuis ce domaine."
          : `Échec : ${msg}`,
        { icon: <XCircle className="text-destructive" size={18} /> }
      );
    } finally {
      setTesting(false);
    }
  };

  if (loadingSettings) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
      <div className="space-y-2">
        <label className="text-sm font-semibold">URL Dolibarr</label>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://erp.monentreprise.fr"
          className="touch-target text-base"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold">Clé API</label>
        <div className="flex gap-2">
          <Input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            type={showKey ? "text" : "password"}
            placeholder="Votre DOLAPIKEY"
            className="touch-target text-base flex-1"
          />
          <Button
            variant="outline"
            size="icon"
            className="touch-target"
            onClick={() => setShowKey(!showKey)}
          >
            {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 pt-2">
        <Button
          variant="outline"
          onClick={handleTest}
          disabled={testing || !baseUrl || !apiKey}
          className="touch-target text-base gap-2"
          size="lg"
        >
          {testing ? <Loader2 size={18} className="animate-spin" /> : null}
          Tester la connexion
        </Button>
        <Button
          onClick={handleSave}
          disabled={!baseUrl || !apiKey}
          className="touch-target text-base font-semibold"
          size="lg"
        >
          Enregistrer
        </Button>
      </div>

      <div className="bg-muted rounded-xl p-4 text-xs text-muted-foreground space-y-1 mt-4">
        <p className="font-semibold text-foreground">ℹ️ Problèmes CORS ?</p>
        <p>
          Si le test échoue avec une erreur réseau, votre serveur Dolibarr doit
          autoriser les requêtes cross-origin. Ajoutez ces en-têtes dans la
          configuration Apache/Nginx du serveur&nbsp;:
        </p>
        <code className="block bg-foreground/5 rounded p-2 text-[11px] leading-relaxed">
          Access-Control-Allow-Origin: *<br />
          Access-Control-Allow-Headers: DOLAPIKEY, Content-Type
        </code>
      </div>
    </div>
  );
};

export default SettingsPanel;
