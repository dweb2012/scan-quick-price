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
    // Verify caller is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Non autorisé" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify JWT
    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await callerClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Non autorisé" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { endpoint, method, payload } = body;

    if (!endpoint || !method) {
      return new Response(JSON.stringify({ error: "endpoint et method requis" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const allowedMethods = ["GET", "POST", "PUT", "DELETE"];
    if (!allowedMethods.includes(method.toUpperCase())) {
      return new Response(JSON.stringify({ error: "Méthode non autorisée" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Read Dolibarr settings from DB
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: settings, error: settingsError } = await adminClient
      .from("connection_settings")
      .select("base_url, api_key")
      .limit(1)
      .maybeSingle();

    if (settingsError || !settings || !settings.base_url || !settings.api_key) {
      return new Response(JSON.stringify({ error: "Configuration Dolibarr manquante" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Forward request to Dolibarr
    const url = `${settings.base_url.replace(/\/+$/, "")}${endpoint}`;
    const fetchOptions: RequestInit = {
      method: method.toUpperCase(),
      headers: {
        DOLAPIKEY: settings.api_key,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    };

    if (payload && ["POST", "PUT"].includes(method.toUpperCase())) {
      fetchOptions.body = JSON.stringify(payload);
    }

    const doliResponse = await fetch(url, fetchOptions);
    const responseText = await doliResponse.text();

    return new Response(responseText, {
      status: doliResponse.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("dolibarr-proxy error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
