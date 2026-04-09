import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Trash2, Shield, User, UserPlus } from "lucide-react";
import { toast } from "sonner";

interface AppUser {
  id: string;
  email: string;
  created_at: string;
  display_name: string | null;
  roles: string[];
}

const AdminUsersPanel = () => {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");

  const callManageUsers = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("manage-users", { body });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const loadUsers = async () => {
    try {
      const data = await callManageUsers({ action: "list" });
      setUsers(data);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleCreate = async () => {
    if (!email || !password) {
      toast.error("Email et mot de passe requis");
      return;
    }
    setCreating(true);
    try {
      await callManageUsers({
        action: "create",
        email: email.trim(),
        password,
        display_name: displayName.trim() || null,
        role,
      });
      toast.success(`Utilisateur ${email} créé`);
      setEmail("");
      setPassword("");
      setDisplayName("");
      setRole("user");
      setShowForm(false);
      await loadUsers();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (user: AppUser) => {
    if (!confirm(`Supprimer ${user.email} ?`)) return;
    try {
      await callManageUsers({ action: "delete", user_id: user.id });
      toast.success(`${user.email} supprimé`);
      await loadUsers();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Utilisateurs ({users.length})
        </h3>
        <Button size="sm" className="touch-target gap-1" onClick={() => setShowForm(!showForm)}>
          <UserPlus size={16} />
          Ajouter
        </Button>
      </div>

      {showForm && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Nom (optionnel)"
            className="touch-target text-base"
          />
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            type="email"
            className="touch-target text-base"
          />
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mot de passe"
            type="password"
            className="touch-target text-base"
          />
          <div className="flex gap-2">
            <Button
              variant={role === "user" ? "default" : "outline"}
              size="sm"
              className="flex-1 touch-target gap-1"
              onClick={() => setRole("user")}
            >
              <User size={14} /> Utilisateur
            </Button>
            <Button
              variant={role === "admin" ? "default" : "outline"}
              size="sm"
              className="flex-1 touch-target gap-1"
              onClick={() => setRole("admin")}
            >
              <Shield size={14} /> Admin
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 touch-target" onClick={() => setShowForm(false)}>
              Annuler
            </Button>
            <Button className="flex-1 touch-target gap-1" onClick={handleCreate} disabled={creating}>
              {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Créer
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-2 bg-card rounded-lg p-3 border border-border">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate">{u.display_name || u.email}</span>
                {u.roles.includes("admin") && (
                  <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-bold uppercase">
                    Admin
                  </span>
                )}
              </div>
              {u.display_name && (
                <span className="text-[11px] text-muted-foreground block truncate">{u.email}</span>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => handleDelete(u)}
            >
              <Trash2 size={14} className="text-destructive" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AdminUsersPanel;
