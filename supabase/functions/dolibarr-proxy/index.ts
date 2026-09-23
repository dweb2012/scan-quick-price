import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: "Non autorisé" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await callerClient.auth.getUser();

    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: "Non autorisé" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
    const method = typeof body?.method === "string" ? body.method.toUpperCase() : "";
    const payload = body?.payload;

    if (!endpoint || !method) {
      return new Response(JSON.stringify({ ok: false, error: "endpoint et method requis" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Server-side validation: endpoint must target the Dolibarr API path and stay
    // within a reasonable size, blocking attempts to call arbitrary upstream URLs.
    if (!endpoint.startsWith("/api/index.php/") || endpoint.length > 2000) {
      console.warn("dolibarr-proxy rejected endpoint:", endpoint);
      return new Response(
        JSON.stringify({ ok: false, error: "Endpoint invalide" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Defense in depth: inspect any sqlfilters query param. After URL-decoding,
    // values between single quotes must NOT contain quotes, semicolons, backslashes,
    // or SQL comment markers — those indicate a SQL injection attempt.
    try {
      const qIndex = endpoint.indexOf("?");
      if (qIndex >= 0) {
        const qs = new URLSearchParams(endpoint.slice(qIndex + 1));
        const sqlFilters = qs.get("sqlfilters");
        if (sqlFilters) {
          const innerValues = [...sqlFilters.matchAll(/'([^']*)'/g)].map((m) => m[1]);
          for (const v of innerValues) {
            if (/['"\\;]|--|\/\*|\*\//.test(v)) {
              console.warn("dolibarr-proxy rejected sqlfilters payload:", sqlFilters);
              return new Response(
                JSON.stringify({ ok: false, error: "Filtre invalide" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
              );
            }
          }
        }
      }
    } catch (_) {
      // If parsing fails, fall through — upstream will surface its own error.
    }

    const allowedMethods = ["GET", "POST", "PUT", "DELETE"];
    if (!allowedMethods.includes(method)) {
      return new Response(JSON.stringify({ ok: false, error: "Méthode non autorisée" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: settings, error: settingsError } = await adminClient
      .from("connection_settings")
      .select("base_url, api_key")
      .limit(1)
      .maybeSingle();

    if (settingsError || !settings?.base_url || !settings?.api_key) {
      return new Response(JSON.stringify({ ok: false, error: "Configuration Dolibarr manquante" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = settings.base_url.replace(/\/+$/, "");
    const apiKey = settings.api_key;

    const callDoli = async (
      ep: string,
      m: string,
      body?: unknown
    ): Promise<{ status: number; ok: boolean; text: string; contentType: string }> => {
      const res = await fetch(`${baseUrl}${ep}`, {
        method: m,
        headers: {
          DOLAPIKEY: apiKey,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body:
          body !== undefined && ["POST", "PUT", "DELETE"].includes(m)
            ? JSON.stringify(body)
            : undefined,
      });
      return {
        status: res.status,
        ok: res.ok,
        text: await res.text(),
        contentType: res.headers.get("content-type") || "application/json",
      };
    };

    /** Normalise une référence : casse, espaces, tirets et underscores ignorés. */
    const normalizeRef = (ref: string) =>
      String(ref || "").toUpperCase().replace(/[\s_\-.]+/g, "");

    /** Date de création exploitable pour comparer l'ancienneté. */
    const creationTime = (p: any): number => {
      const raw = p?.date_creation || p?.import_key || "";
      const t = Date.parse(String(raw).replace(" ", "T"));
      return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
    };

    /**
     * Quand Dolibarr refuse une modification à cause d'une référence en double,
     * on renomme automatiquement le produit le plus ancien en « <REF> ANCIENNE »
     * pour libérer la référence, puis on relance la modification d'origine.
     */
    const resolveDuplicateRef = async (
      productId: string
    ): Promise<{ renamed?: string; error?: string }> => {
      const current = await callDoli(`/api/index.php/products/${productId}`, "GET");
      if (!current.ok) return { error: "Produit introuvable dans Dolibarr" };
      const product = JSON.parse(current.text);
      const ref = String(product?.ref || "");
      if (!ref) return { error: "Référence introuvable" };

      // '_' est un joker SQL : il retrouve aussi bien "PA-2000C TAP" que "PA-2000C_TAP".
      const pattern = ref.replace(/['"\\;%]/g, "").replace(/[\s_\-.]/g, "_");
      const search = await callDoli(
        `/api/index.php/products?sqlfilters=${encodeURIComponent(
          `(ref:like:'${pattern}')`
        )}&limit=20`,
        "GET"
      );
      if (!search.ok) return { error: "Recherche des doublons impossible" };

      let candidates: any[] = [];
      try {
        const parsed = JSON.parse(search.text);
        if (Array.isArray(parsed)) candidates = parsed;
      } catch (_) {
        return { error: "Recherche des doublons impossible" };
      }

      const duplicates = candidates.filter(
        (p) => normalizeRef(p?.ref) === normalizeRef(ref)
      );
      if (duplicates.length < 2) return { error: "Aucun doublon identifié" };

      const oldest = duplicates.reduce((a, b) =>
        creationTime(a) <= creationTime(b) ? a : b
      );
      // On ne renomme jamais le produit que l'utilisateur est en train de traiter.
      const target =
        String(oldest?.id) === String(productId)
          ? duplicates.find((p) => String(p?.id) !== String(productId))
          : oldest;
      if (!target) return { error: "Aucun doublon à renommer" };

      const newRef = `${String(target.ref)} ANCIENNE`;
      const rename = await callDoli(
        `/api/index.php/products/${target.id}`,
        "PUT",
        { ref: newRef }
      );
      if (!rename.ok) {
        console.warn("dolibarr-proxy rename failed", rename.status, rename.text.slice(0, 300));
        return { error: "Renommage du doublon refusé par Dolibarr" };
      }
      console.log("dolibarr-proxy renamed duplicate", { id: target.id, newRef });
      return { renamed: newRef };
    };

    let attempt: { status: number; ok: boolean; text: string; contentType: string };
    try {
      attempt = await callDoli(endpoint, method, payload);
    } catch (error: any) {
      console.error("dolibarr-proxy upstream fetch error:", error);
      return new Response(
        JSON.stringify({
          ok: false,
          error: error?.message || "Erreur réseau vers Dolibarr",
          diagnostics: { stage: "upstream_fetch", url: `${baseUrl}${endpoint}`, method },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let autoFix: { renamed?: string; error?: string } | undefined;
    const productIdMatch = endpoint.match(/^\/api\/index\.php\/products\/(\d+)(?:\?|$)/);

    if (
      !attempt.ok &&
      method === "PUT" &&
      productIdMatch &&
      attempt.text.includes("ErrorProductAlreadyExists")
    ) {
      autoFix = await resolveDuplicateRef(productIdMatch[1]);
      if (autoFix.renamed) {
        attempt = await callDoli(endpoint, method, payload);
      }
    }

    const responseText = attempt.text;
    const contentType = attempt.contentType;

    if (method === "PUT") {
      console.log("dolibarr-proxy PUT", {
        url: `${baseUrl}${endpoint}`,
        status: attempt.status,
        payload: JSON.stringify(payload).slice(0, 500),
        response: responseText.slice(0, 500),
      });
    }

    if (!attempt.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: responseText.includes("ErrorBarCodeRequired")
            ? "Dolibarr refuse la modification : ce produit n'a pas de code-barres (obligatoire dans Dolibarr). Ajoutez-lui un code-barres dans Dolibarr puis réessayez."
            : responseText.includes("ErrorProductAlreadyExists")
            ? `Dolibarr refuse la modification : un autre produit porte déjà la même référence${
                autoFix?.error ? ` (${autoFix.error})` : ""
              }. Corrigez la référence en double dans Dolibarr puis réessayez.`
            : `Dolibarr a répondu ${attempt.status}`,
          diagnostics: {
            stage: "upstream_http",
            url: `${baseUrl}${endpoint}`,
            method,
            status: attempt.status,
            body: responseText.slice(0, 500),
            autoFix,
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(responseText, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
      },
    });
  } catch (err: any) {
    console.error("dolibarr-proxy runtime error:", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: err?.message || "Erreur interne proxy Dolibarr",
        diagnostics: {
          stage: "runtime_error",
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
