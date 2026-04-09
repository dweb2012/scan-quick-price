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

    const url = `${settings.base_url.replace(/\/+$/, "")}${endpoint}`;
    const fetchOptions: RequestInit = {
      method,
      headers: {
        DOLAPIKEY: settings.api_key,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    };

    if (payload !== undefined && ["POST", "PUT", "DELETE"].includes(method)) {
      fetchOptions.body = JSON.stringify(payload);
    }

    let doliResponse: Response;
    try {
      doliResponse = await fetch(url, fetchOptions);
    } catch (error: any) {
      console.error("dolibarr-proxy upstream fetch error:", error);
      return new Response(
        JSON.stringify({
          ok: false,
          error: error?.message || "Erreur réseau vers Dolibarr",
          diagnostics: {
            stage: "upstream_fetch",
            url,
            method,
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const responseText = await doliResponse.text();
    const contentType = doliResponse.headers.get("content-type") || "application/json";

    if (!doliResponse.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: `Dolibarr a répondu ${doliResponse.status}`,
          diagnostics: {
            stage: "upstream_http",
            url,
            method,
            status: doliResponse.status,
            body: responseText.slice(0, 500),
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
