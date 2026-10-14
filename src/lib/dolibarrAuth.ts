import { supabase } from "@/integrations/supabase/client";

type Body = { mode: "password"; login: string; password: string } | { mode: "hub"; token: string };

/** Appelle la fonction serveur dolibarr-auth et renvoie le token_hash à passer à verifyOtp. */
export async function callDolibarrAuth(body: Body): Promise<string> {
  const { data, error } = await supabase.functions.invoke("dolibarr-auth", { body });
  if (error) {
    let msg = "Connexion impossible, réessayez";
    try {
      const ctx = (error as any).context;
      if (ctx && typeof ctx.json === "function") {
        const parsed = await ctx.json();
        if (parsed?.error) msg = parsed.error;
      }
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  if (!data?.token_hash) throw new Error("Connexion impossible, réessayez");
  return data.token_hash;
}
