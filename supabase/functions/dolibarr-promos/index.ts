import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { connect } from "https://deno.land/x/mysql@v2.12.1/mod.ts";

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

    // Connect to Dolibarr MySQL
    const dbHost = Deno.env.get("DOLIBARR_DB_HOST");
    const dbPort = parseInt(Deno.env.get("DOLIBARR_DB_PORT") || "3306");
    const dbName = Deno.env.get("DOLIBARR_DB_NAME");
    const dbUser = Deno.env.get("DOLIBARR_DB_USER");
    const dbPassword = Deno.env.get("DOLIBARR_DB_PASSWORD");

    if (!dbHost || !dbName || !dbUser) {
      return new Response(
        JSON.stringify({ ok: false, error: "Configuration MySQL Dolibarr manquante" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const client = await connect({
      hostname: dbHost,
      port: dbPort,
      db: dbName,
      username: dbUser,
      password: dbPassword || "",
    });

    try {
      // Query active promos for this product (where today is between date_begin and date_end)
      const rows = await client.execute(
        `SELECT rowid, label, discount, price, price_ttc, date_begin, date_end
         FROM llx_discountprice_product
         WHERE fk_product = ?
           AND (date_begin IS NULL OR date_begin <= CURDATE())
           AND (date_end IS NULL OR date_end >= CURDATE())
         ORDER BY price ASC
         LIMIT 5`,
        [productId]
      );

      const promos = (rows.rows || []).map((row: any) => ({
        id: row.rowid,
        label: row.label || "",
        discount: row.discount ?? null,
        price: row.price ?? null,
        price_ttc: row.price_ttc ?? null,
        date_begin: row.date_begin || null,
        date_end: row.date_end || null,
      }));

      return new Response(JSON.stringify({ ok: true, promos }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } finally {
      await client.close();
    }
  } catch (err: any) {
    console.error("dolibarr-promos error:", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: err?.message || "Erreur interne",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
