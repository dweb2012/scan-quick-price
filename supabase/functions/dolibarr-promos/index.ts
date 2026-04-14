import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ ok: false, error: "Non autorisé" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await callerClient.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ ok: false, error: "Non autorisé" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const productId = body?.product_id;

    if (!productId || typeof productId !== "number") {
      return new Response(
        JSON.stringify({ ok: false, error: "product_id (number) requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get Dolibarr base URL from connection_settings
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: settings } = await adminClient
      .from("connection_settings")
      .select("base_url")
      .limit(1)
      .maybeSingle();

    if (!settings?.base_url) {
      return new Response(
        JSON.stringify({ ok: false, error: "URL Dolibarr non configurée" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const promosApiKey = Deno.env.get("DOLIBARR_PROMOS_API_KEY");
    if (!promosApiKey) {
      return new Response(
        JSON.stringify({ ok: false, error: "DOLIBARR_PROMOS_API_KEY non configurée" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call PHP script via GET with query params (PHP reads $_GET)
    const baseUrl = settings.base_url.replace(/\/+$/, "");
    const phpUrl = `${baseUrl}/custom/api_promos.php?product_id=${productId}&api_key=${encodeURIComponent(promosApiKey)}`;

    const res = await fetch(phpUrl, {
      method: "GET",
      headers: { "Accept": "application/json" },
    });

    if (!res.ok) {
      const text = await res.text();
      return new Response(
        JSON.stringify({ ok: false, error: `Erreur PHP (${res.status}): ${text.slice(0, 200)}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const phpData = await res.json();

    return new Response(JSON.stringify({ ok: true, promos: phpData.promos || [] }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("dolibarr-promos error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || "Erreur interne" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
