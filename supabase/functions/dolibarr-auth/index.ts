import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

export async function verifyHubToken(token: string, secret: string, expectedAud: string) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("format");
  const [h, p, s] = parts;
  const b64 = (x: string) =>
    Uint8Array.from(
      atob(x.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((x.length + 3) % 4)),
      (c) => c.charCodeAt(0),
    );
  const header = JSON.parse(new TextDecoder().decode(b64(h)));
  if (header.alg !== "HS256") throw new Error("alg");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify("HMAC", key, b64(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error("signature");
  const payload = JSON.parse(new TextDecoder().decode(b64(p)));
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== "dolibarr-chrhub" || payload.aud !== expectedAud) throw new Error("aud");
  if (typeof payload.exp !== "number" || payload.exp < now || payload.iat > now + 30) throw new Error("expired");
  return payload;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const SECRET = Deno.env.get("CHRHUB_SECRET");
    const APP = Deno.env.get("CHRHUB_APP");
    const VERIFY_URL = Deno.env.get("DOLIBARR_VERIFY_URL");
    if (!SECRET || !APP || !VERIFY_URL) {
      return json({ error: "Connexion Dolibarr non configurée sur le serveur" }, 500);
    }

    const body = await req.json().catch(() => null);
    const mode = body?.mode;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let dolibarrId: number | null = null;

    if (mode === "password") {
      const login = typeof body?.login === "string" ? body.login.trim() : "";
      const password = typeof body?.password === "string" ? body.password : "";
      if (!login || !password || login.length > 255 || password.length > 1024) {
        return json({ error: "Identifiant et mot de passe requis" }, 400);
      }
      let res: Response;
      try {
        res = await fetch(VERIFY_URL, {
          method: "POST",
          headers: { "X-ChrHub-App": APP, "X-ChrHub-Secret": SECRET, "Content-Type": "application/json" },
          body: JSON.stringify({ login, password }),
        });
      } catch (_) {
        return json({ error: "Dolibarr injoignable, réessayez" }, 502);
      }
      if (res.status === 401) return json({ error: "Identifiant ou mot de passe Dolibarr incorrect" }, 401);
      if (res.status === 429) return json({ error: "Trop d'essais, réessayez dans 15 minutes" }, 429);
      if (res.status !== 200) return json({ error: "Dolibarr injoignable, réessayez" }, 502);
      const data = await res.json().catch(() => null);
      const id = Number(data?.user?.id);
      if (!data?.ok || !Number.isInteger(id) || id <= 0) {
        return json({ error: "Dolibarr injoignable, réessayez" }, 502);
      }
      dolibarrId = id;
    } else if (mode === "hub") {
      const token = typeof body?.token === "string" ? body.token : "";
      if (!token || token.length > 4096) return json({ error: "Lien invalide" }, 400);
      let payload: any;
      try {
        payload = await verifyHubToken(token, SECRET, APP);
      } catch (_) {
        return json({ error: "Lien invalide ou expiré, rouvrez l'application depuis Dolibarr" }, 401);
      }
      const jti = typeof payload.jti === "string" ? payload.jti : "";
      if (!jti) return json({ error: "Lien invalide" }, 401);

      await admin.from("sso_used_tokens").delete().lt("used_at", new Date(Date.now() - 86400000).toISOString());
      const { error: insErr } = await admin.from("sso_used_tokens").insert({ jti });
      if (insErr) {
        return json({ error: "Lien déjà utilisé, rouvrez l'application depuis Dolibarr" }, 409);
      }
      const id = Number(payload.sub);
      if (!Number.isInteger(id) || id <= 0) return json({ error: "Lien invalide" }, 401);
      dolibarrId = id;
    } else {
      return json({ error: "Mode inconnu" }, 400);
    }

    const notLinked = "Votre compte Dolibarr n'est relié à aucun utilisateur de cette application. Demandez à un administrateur.";
    const { data: profile } = await admin
      .from("profiles")
      .select("user_id")
      .eq("dolibarr_user_id", dolibarrId)
      .maybeSingle();
    if (!profile?.user_id) return json({ error: notLinked }, 403);

    const { data: userData, error: userErr } = await admin.auth.admin.getUserById(profile.user_id);
    const user = userData?.user;
    if (userErr || !user?.email) return json({ error: notLinked }, 403);
    const bannedUntil = (user as any).banned_until ? Date.parse((user as any).banned_until) : 0;
    if ((bannedUntil && bannedUntil > Date.now()) || (user as any).deleted_at) {
      return json({ error: "Ce compte est désactivé. Contactez un administrateur." }, 403);
    }

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: user.email,
    });
    if (linkErr || !link?.properties?.hashed_token) {
      console.error("dolibarr-auth generateLink failed", linkErr?.message);
      return json({ error: "Connexion impossible, réessayez" }, 500);
    }
    return json({ token_hash: link.properties.hashed_token });
  } catch (err: any) {
    console.error("dolibarr-auth error", err?.message);
    return json({ error: "Erreur interne" }, 500);
  }
});
