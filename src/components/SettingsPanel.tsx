import { useState, useEffect } from "react";
import { getSettings, saveSettings, testConnection, getSupplierDiscounts, saveSupplierDiscount, deleteSupplierDiscount, SupplierDiscount } from "@/lib/dolibarr";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Eye, EyeOff, CheckCircle2, XCircle, Loader2, Plus, Trash2, LogOut } from "lucide-react";
import { QrCode } from "lucide-react";
import { generateAisleLabelsPdf, AisleLabelOrientation, AisleLabelPerPage } from "@/lib/aisleLabelsPdf";
import { AISLE_ZONES, expandAisles, getAisleGroups } from "@/lib/aisleCatalog";
import { Checkbox } from "@/components/ui/checkbox";
import { getAutoSendCasB, setAutoSendCasB } from "@/lib/prefs";

const SettingsPanel = () => {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);

  // Compte utilisateur
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // Export options
  const [autoSendCasB, setAutoSendCasBState] = useState<boolean>(() => getAutoSendCasB());

  // Supplier discounts
  const [discounts, setDiscounts] = useState<SupplierDiscount[]>([]);
  const [newName, setNewName] = useState("");
  const [newPercent, setNewPercent] = useState("");
  const [newSocid, setNewSocid] = useState("");

  // Aisle labels
  const [generatingAisles, setGeneratingAisles] = useState(false);
  const [aisleOrientation, setAisleOrientation] = useState<AisleLabelOrientation>("portrait");
  const [aislePerPage, setAislePerPage] = useState<AisleLabelPerPage>(8);
  const [selectedZones, setSelectedZones] = useState<Set<string>>(
    () => new Set(AISLE_ZONES.map((z) => z.code))
  );

  useEffect(() => {
    Promise.all([
      getSettings().then((s) => { setBaseUrl(s.baseUrl); setApiKey(s.apiKey); }),
      loadDiscounts(),
      loadProfile(),
    ]).finally(() => setLoadingSettings(false));
  }, []);

  const loadDiscounts = async () => {
    const data = await getSupplierDiscounts();
    setDiscounts(data);
  };

  const loadProfile = async () => {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) return;
    setEmail(user.email || "");
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", user.id)
      .maybeSingle();
    setDisplayName(profile?.display_name || "");
  };

  const handleSaveProfile = async () => {
    const name = displayName.trim();
    if (name.length > 100) {
      toast.error("Nom trop long (max 100 caractères)");
      return;
    }
    setSavingProfile(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) throw new Error("Non authentifié");
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: name || null })
        .eq("user_id", user.id);
      if (error) throw error;
      toast.success("Nom mis à jour");
    } catch (e: any) {
      toast.error(e?.message || "Erreur");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 6) {
      toast.error("Le mot de passe doit contenir au moins 6 caractères");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Les mots de passe ne correspondent pas");
      return;
    }
    setChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success("Mot de passe modifié");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e: any) {
      toast.error(e?.message || "Erreur");
    } finally {
      setChangingPassword(false);
    }
  };

  const handleSave = async () => {
    await saveSettings({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() });
    toast.success("Paramètres enregistrés");
  };

  const handleTest = async () => {
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

  const handleAddDiscount = async () => {
    const name = newName.trim();
    const percent = parseFloat(newPercent);
    const socid = newSocid.trim();
    if (!name || isNaN(percent) || percent <= 0) {
      toast.error("Nom et pourcentage requis");
      return;
    }
    await saveSupplierDiscount(name, percent, socid);
    setNewName("");
    setNewPercent("");
    setNewSocid("");
    await loadDiscounts();
    toast.success(`Remise ${name} : ${percent}% enregistrée`);
  };

  const handleDeleteDiscount = async (d: SupplierDiscount) => {
    await deleteSupplierDiscount(d.id);
    await loadDiscounts();
    toast.success(`Remise ${d.supplier_name} supprimée`);
  };

  if (loadingSettings) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
      {/* Compte utilisateur */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Mon compte
        </h3>
        {email && (
          <div className="text-xs text-muted-foreground">
            Connecté en tant que <span className="font-semibold text-foreground">{email}</span>
          </div>
        )}
        <div className="space-y-2">
          <label className="text-sm font-semibold">Nom affiché</label>
          <div className="flex gap-2">
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Votre nom"
              maxLength={100}
              className="touch-target text-base flex-1"
            />
            <Button
              onClick={handleSaveProfile}
              disabled={savingProfile}
              className="touch-target"
            >
              {savingProfile ? <Loader2 size={16} className="animate-spin" /> : "Enregistrer"}
            </Button>
          </div>
        </div>

        <div className="space-y-2 pt-2">
          <label className="text-sm font-semibold">Nouveau mot de passe</label>
          <div className="flex gap-2">
            <Input
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              type={showPassword ? "text" : "password"}
              placeholder="Min. 6 caractères"
              minLength={6}
              className="touch-target text-base flex-1"
              autoComplete="new-password"
            />
            <Button
              variant="outline"
              size="icon"
              className="touch-target"
              onClick={() => setShowPassword((s) => !s)}
              type="button"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </Button>
          </div>
          <Input
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            type={showPassword ? "text" : "password"}
            placeholder="Confirmer le mot de passe"
            className="touch-target text-base"
            autoComplete="new-password"
          />
          <Button
            onClick={handleChangePassword}
            disabled={changingPassword || !newPassword || !confirmPassword}
            className="w-full touch-target"
            variant="secondary"
          >
            {changingPassword ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
            Modifier le mot de passe
          </Button>
        </div>
      </div>

      {/* Connection settings */}
      <div className="space-y-2 border-t border-border pt-5">
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

      {/* Export options */}
      <div className="border-t border-border pt-5 space-y-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Export Google Sheets
        </h3>
        <label className="flex items-start gap-3 cursor-pointer touch-target">
          <Checkbox
            checked={autoSendCasB}
            onCheckedChange={(v) => {
              const enabled = v === true;
              setAutoSendCasBState(enabled);
              setAutoSendCasB(enabled);
              toast.success(enabled ? "Envoi auto activé" : "Envoi auto désactivé");
            }}
            className="mt-0.5"
          />
          <div className="flex-1">
            <div className="text-sm font-semibold">Envoyer automatiquement vers l'onglet B</div>
            <p className="text-xs text-muted-foreground">
              Après chaque modification (stock ou emplacement) d'un produit hors BMY,
              une ligne est ajoutée automatiquement à l'onglet B du Google Sheet.
            </p>
          </div>
        </label>
      </div>

      {/* Label format info */}
      <div className="border-t border-border pt-5 space-y-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Format d'étiquette
        </h3>
        <p className="text-xs text-muted-foreground">
          Le PDF est généré en <strong>54 × 70 mm portrait</strong>. Dans le
          pilote d'imprimante, sélectionnez le format 54 × 70 mm en orientation
          portrait et désactivez « adapter à la page » pour éviter l'impression
          sur plusieurs étiquettes.
        </p>
      </div>

      {/* Aisle QR labels */}
      <div className="border-t border-border pt-5 space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Étiquettes QR d'allées
        </h3>
        <p className="text-xs text-muted-foreground">
          Imprimez un QR code par emplacement à coller en rayon. La nomenclature
          officielle (213 emplacements : A1–A22, B1–B22, …, R, X, SW…) est gérée
          automatiquement. Scanner un QR active l'emplacement et pré-remplit le
          champ « Allée » à l'édition produit. Stockage Dolibarr : champ
          emplacement existant au format « Code / Détail » (ex. « H12 / Étagère 3 »).
        </p>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold">
              Zones à imprimer ({Array.from(selectedZones).reduce((acc, code) => {
                const z = AISLE_ZONES.find((zz) => zz.code === code);
                return acc + (z?.range ? z.range[1] - z.range[0] + 1 : 1);
              }, 0)} QR)
            </label>
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setSelectedZones(new Set(AISLE_ZONES.map((z) => z.code)))}
              >
                Tout
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setSelectedZones(new Set())}
              >
                Aucun
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 p-2 rounded-lg border border-border bg-muted/30">
            {AISLE_ZONES.map((z) => {
              const count = z.range ? z.range[1] - z.range[0] + 1 : 1;
              const checked = selectedZones.has(z.code);
              return (
                <label
                  key={z.code}
                  className="flex items-center gap-2 text-xs cursor-pointer touch-target px-1"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => {
                      setSelectedZones((prev) => {
                        const next = new Set(prev);
                        if (v) next.add(z.code);
                        else next.delete(z.code);
                        return next;
                      });
                    }}
                  />
                  <span className="font-semibold">{z.code}</span>
                  <span className="text-muted-foreground truncate">
                    {z.name} ({count})
                  </span>
                </label>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold">Orientation</label>
            <div className="flex gap-1">
              {(["portrait", "landscape"] as AisleLabelOrientation[]).map((o) => (
                <Button
                  key={o}
                  type="button"
                  size="sm"
                  variant={aisleOrientation === o ? "default" : "outline"}
                  className="flex-1 h-9 text-xs"
                  onClick={() => setAisleOrientation(o)}
                >
                  {o === "portrait" ? "Portrait" : "Paysage"}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold">QR par page</label>
            <div className="flex gap-1">
              {([4, 6, 8] as AisleLabelPerPage[]).map((n) => (
                <Button
                  key={n}
                  type="button"
                  size="sm"
                  variant={aislePerPage === n ? "default" : "outline"}
                  className="flex-1 h-9 text-xs"
                  onClick={() => setAislePerPage(n)}
                >
                  {n}
                </Button>
              ))}
            </div>
          </div>
        </div>
        <Button
          onClick={async () => {
            const entries = expandAisles().filter((e) => selectedZones.has(e.zoneCode));
            if (entries.length === 0) {
              toast.error("Sélectionnez au moins une zone");
              return;
            }
            setGeneratingAisles(true);
            try {
              await generateAisleLabelsPdf(entries, {
                orientation: aisleOrientation,
                perPage: aislePerPage,
              });
            } catch (e: any) {
              toast.error(e?.message || "Erreur génération PDF");
            } finally {
              setGeneratingAisles(false);
            }
          }}
          disabled={generatingAisles}
          className="w-full touch-target gap-2"
          variant="outline"
        >
          {generatingAisles ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />}
          Générer le PDF des QR allées
        </Button>
      </div>

      {/* Supplier discounts */}
      <div className="border-t border-border pt-5 space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Remises par fournisseur
        </h3>

        {discounts.length > 0 && (
          <div className="space-y-2">
            {discounts.map((d) => (
              <div key={d.id} className="flex items-center gap-2 bg-card rounded-lg p-3 border border-border">
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-sm block">{d.supplier_name}</span>
                  {d.socid && <span className="text-[11px] text-muted-foreground">ID: {d.socid}</span>}
                </div>
                <span className="text-sm font-bold text-accent">-{d.discount_percent}%</span>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDeleteDiscount(d)}>
                  <Trash2 size={14} className="text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nom fournisseur"
                className="touch-target text-sm"
              />
            </div>
            <div className="w-24">
              <Input
                value={newSocid}
                onChange={(e) => setNewSocid(e.target.value)}
                placeholder="SocID"
                className="touch-target text-sm"
              />
            </div>
            <div className="w-20">
              <Input
                value={newPercent}
                onChange={(e) => setNewPercent(e.target.value)}
                placeholder="%"
                type="number"
                className="touch-target text-sm"
              />
            </div>
            <Button size="icon" className="touch-target h-10 w-10" onClick={handleAddDiscount}>
              <Plus size={18} />
            </Button>
          </div>
        </div>
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

      <Button
        variant="outline"
        onClick={async () => {
          await supabase.auth.signOut();
          toast.success("Déconnecté");
        }}
        className="w-full mt-6 touch-target gap-2 text-destructive border-destructive/30"
      >
        <LogOut size={16} />
        Se déconnecter
      </Button>
    </div>
  );
};

export default SettingsPanel;
