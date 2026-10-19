import { createClient } from "npm:@supabase/supabase-js@2";

const BASE = "https://dolibarr.chrelite.fr/custom/chrhub/api/";
const ALLOWED_ORIGINS = [
  "https://reception.chrelite.fr",
  "https://id-preview--7400a6bb-8552-4cd7-8d98-7f2dc851e7ad.lovable.app",
];
const MAX_BODY = 20 * 1024 * 1024;
const SESSION_TTL = 12 * 3600;

const cors = (origin: string | null): Record<string, string> =>
  origin && ALLOWED_ORIGINS.includes(origin)
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        Vary: "Origin",
      }
    : { Vary: "Origin" };

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64urlDecode = (x: string) =>
  Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((x.length + 3) % 4)), (c) =>
    c.charCodeAt(0),
  );
const b64urlEncode = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const hmacKey = (raw: Uint8Array, usage: KeyUsage[]) =>
  crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, usage);

async function deriveSessionKey(secret: string): Promise<Uint8Array> {
  const k = await hmacKey(enc.encode(secret), ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode("reception-relay-session")));
}

async function verifyJwt(token: string, keyRaw: Uint8Array): Promise<any> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("format");
  const [h, p, s] = parts;
  const header = JSON.parse(dec.decode(b64urlDecode(h)));
  if (header.alg !== "HS256") throw new Error("alg");
  const key = await hmacKey(keyRaw, ["verify"]);
  const ok = await crypto.subtle.verify("HMAC", key, b64urlDecode(s), enc.encode(`${h}.${p}`));
  if (!ok) throw new Error("signature");
  return JSON.parse(dec.decode(b64urlDecode(p)));
}

async function signJwt(payload: Record<string, unknown>, keyRaw: Uint8Array): Promise<string> {
  const h = b64urlEncode(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const p = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const key = await hmacKey(keyRaw, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${h}.${p}`)));
  return `${h}.${p}.${b64urlEncode(sig)}`;
}

const PATH_RE = /^[A-Za-z0-9_\-/{}.]+$/;
const METHODS = ["GET", "POST", "PUT", "DELETE"];
const READ_ACTIONS = ["orders", "order", "products", "warehouses"];

const validCall = (c: any): string | null => {
  if (!c || typeof c !== "object") return "Appel invalide";
  const method = typeof c.method === "string" ? c.method.toUpperCase() : "";
  if (!METHODS.includes(method)) return "Méthode invalide";
  if (typeof c.path !== "string" || !c.path || c.path.length > 500 || !PATH_RE.test(c.path) || c.path.includes(".."))
    return "Chemin invalide";
  if (c.query !== undefined && (typeof c.query !== "object" || c.query === null || Array.isArray(c.query)))
    return "Paramètres invalides";
  return null;
};

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const ch = cors(origin);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...ch, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: ch });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const SECRET = Deno.env.get("RECEPTION_CHRHUB_SECRET");
    if (!SECRET) return json({ ok: false, error: "Relais non configuré sur le serveur" }, 500);

    const len = Number(req.headers.get("content-length") || "0");
    if (len > MAX_BODY) return json({ ok: false, error: "Requête trop volumineuse" }, 413);
    const raw = await req.text();
    if (raw.length > MAX_BODY) return json({ ok: false, error: "Requête trop volumineuse" }, 413);
    let body: any;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ ok: false, error: "JSON invalide" }, 400);
    }
    const op = body?.op;
    const SESSION_KEY = await deriveSessionKey(SECRET);
    const doliHeaders = {
      "X-ChrHub-App": "reception",
      "X-ChrHub-Secret": SECRET,
      "Content-Type": "application/json",
      "User-Agent": "Reception-Relay/1.0",
    };
    const newSession = async (sub: number, name: string) => {
      const iat = Math.floor(Date.now() / 1000);
      return await signJwt({ sub, name, iat, exp: iat + SESSION_TTL }, SESSION_KEY);
    };

    if (op === "login") {
      const login = typeof body.login === "string" ? body.login.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!login || !password || login.length > 255 || password.length > 1024)
        return json({ ok: false, error: "Identifiant et mot de passe requis" }, 400);
      let res: Response;
      try {
        res = await fetch(BASE + "verify.php", {
          method: "POST",
          headers: doliHeaders,
          body: JSON.stringify({ login, password }),
        });
      } catch {
        return json({ ok: false, error: "Dolibarr injoignable, réessayez" }, 502);
      }
      const data = await res.json().catch(() => null);
      if (res.status === 200 && data?.ok && data?.user) {
        const id = Number(data.user.id);
        if (!Number.isInteger(id) || id <= 0) return json({ ok: false, error: "Dolibarr injoignable, réessayez" }, 502);
        const name = String(data.user.name || data.user.login || login);
        return json({ ok: true, session: await newSession(id, name), name });
      }
      if (res.status === 401) return json({ ok: false, error: "Identifiant ou mot de passe Dolibarr incorrect" }, 401);
      if (res.status === 429) return json({ ok: false, error: "Trop d'essais, réessayez dans 15 minutes" }, 429);
      if (res.status === 403 && (data?.chrhub_error === "app_not_allowed" || data?.error === "app_not_allowed"))
        return json({ ok: false, error: String(data?.message || "Application non autorisée") }, 403);
      return json({ ok: false, error: "Dolibarr injoignable, réessayez" }, 502);
    }

    if (op === "hub") {
      const invalid = "Lien invalide ou expiré, rouvrez l'application depuis Dolibarr";
      const token = typeof body.token === "string" ? body.token : "";
      if (!token || token.length > 4096) return json({ ok: false, error: invalid }, 401);
      let payload: any;
      try {
        payload = await verifyJwt(token, enc.encode(SECRET));
      } catch {
        return json({ ok: false, error: invalid }, 401);
      }
      const now = Math.floor(Date.now() / 1000);
      if (
        payload.iss !== "dolibarr-chrhub" ||
        payload.aud !== "reception" ||
        typeof payload.exp !== "number" ||
        payload.exp < now ||
        (typeof payload.iat === "number" && payload.iat > now + 30) ||
        typeof payload.jti !== "string" ||
        !payload.jti
      )
        return json({ ok: false, error: invalid }, 401);
      const id = Number(payload.sub);
      if (!Number.isInteger(id) || id <= 0) return json({ ok: false, error: invalid }, 401);

      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await admin.from("reception_relay_jti").delete().lt("used_at", new Date(Date.now() - 86400000).toISOString());
      const { error: insErr } = await admin.from("reception_relay_jti").insert({ jti: payload.jti });
      if (insErr)
        return json({ ok: false, error: "Lien déjà utilisé, rouvrez l'application depuis Dolibarr" }, 409);
      const name = String(payload.name || payload.login || "");
      return json({ ok: true, session: await newSession(id, name), name });
    }

    // Opérations authentifiées
    const auth = req.headers.get("Authorization") || "";
    const expired = () => json({ error: "Session expirée, reconnectez-vous" }, 401);
    if (!auth.startsWith("Bearer ")) return expired();
    let session: any;
    try {
      session = await verifyJwt(auth.slice(7), SESSION_KEY);
    } catch {
      return expired();
    }
    const now = Math.floor(Date.now() / 1000);
    const sub = Number(session?.sub);
    if (typeof session?.exp !== "number" || session.exp < now || !Number.isInteger(sub) || sub <= 0) return expired();

    let target: string;
    let payload: Record<string, unknown>;
    if (op === "call") {
      const err = validCall(body);
      if (err) return json({ error: err }, 400);
      target = "call.php";
      payload = {
        dolibarr_user_id: sub,
        method: body.method.toUpperCase(),
        path: body.path,
        query: body.query,
        body: body.body,
      };
    } else if (op === "batch") {
      const batch = body.batch;
      if (!Array.isArray(batch) || batch.length < 1 || batch.length > 40)
        return json({ error: "Le lot doit contenir 1 à 40 appels" }, 400);
      for (const c of batch) {
        const err = validCall(c);
        if (err) return json({ error: err }, 400);
      }
      target = "call.php";
      payload = {
        dolibarr_user_id: sub,
        stop_on_error: !!body.stop_on_error,
        batch: batch.map((c: any) => ({ ...c, method: c.method.toUpperCase() })),
      };
    } else if (op === "read") {
      const { op: _op, action, dolibarr_user_id: _ignored, ...params } = body;
      if (!READ_ACTIONS.includes(action)) return json({ error: "Action invalide" }, 400);
      target = "reception.php";
      payload = { ...params, dolibarr_user_id: sub, action };
    } else {
      return json({ error: "Opération inconnue" }, 400);
    }

    let res: Response;
    try {
      res = await fetch(BASE + target, { method: "POST", headers: doliHeaders, body: JSON.stringify(payload) });
    } catch {
      return json({ status: 502, data: { error: "Dolibarr injoignable, réessayez" } });
    }
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch { /* texte brut */ }
    return json({ status: res.status, data });
  } catch (e: any) {
    console.error("reception-relay error", e?.message);
    return json({ error: "Erreur interne" }, 500);
  }
});
