import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SPREADSHEET_ID = '1R0hK3jKIx70WjV3fHhSyaPhuLAMRdJCKpvpFMR2SIQs';
const SHEET_RANGE = 'B!A:H';
const GATEWAY_URL = 'https://connector-gateway.lovable.dev/google_sheets/v4';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const GOOGLE_SHEETS_API_KEY = Deno.env.get('GOOGLE_SHEETS_API_KEY');
    if (!LOVABLE_API_KEY || !GOOGLE_SHEETS_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: 'Google Sheets connector not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { ref, label, barcode, stock, emplacement, fournisseur, photo } = body ?? {};

    if (!ref && !barcode) {
      return new Response(JSON.stringify({ ok: false, error: 'ref or barcode required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const now = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
    // Colonnes du Sheet: Photo | Réf | Code barre | Libellé | Marque | Stock | Emplacement | Note
    const row = [
      photo ?? '',
      ref ?? '',
      barcode ?? '',
      label ?? '',
      fournisseur ?? '',
      stock ?? '',
      emplacement ?? '',
      `Export scan ${now}`,
    ];

    const url = `${GATEWAY_URL}/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_RANGE}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'X-Connection-Api-Key': GOOGLE_SHEETS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [row] }),
    });

    const text = await res.text();
    if (!res.ok) {
      console.error('Google Sheets append failed', res.status, text);
      return new Response(JSON.stringify({ ok: false, status: res.status, error: text.slice(0, 500) }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('export-cas-b error', e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});