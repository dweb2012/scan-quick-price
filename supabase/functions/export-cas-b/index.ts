import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SPREADSHEET_ID = '1R0hK3jKIx70WjV3fHhSyaPhuLAMRdJCKpvpFMR2SIQs';
const GATEWAY_URL = 'https://connector-gateway.lovable.dev/google_sheets/v4';
const ALLOWED_SHEETS = ['B', 'C', 'D', 'E'] as const;

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
    const { ref, label, barcode, stock, emplacement, fournisseur, description, quantite, note, user, imageUrl } = body ?? {};
    const sheetName = ALLOWED_SHEETS.includes(body?.sheet) ? body.sheet : 'B';
    const isCasE = sheetName === 'E';
    const SHEET_RANGE = isCasE ? `${sheetName}!A:H` : `${sheetName}!B:I`;
    const DEDUP_RANGE = `${sheetName}!B:C`;

    if (!isCasE && !ref && !barcode) {
      return new Response(JSON.stringify({ ok: false, error: 'ref or barcode required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (isCasE && !description) {
      return new Response(JSON.stringify({ ok: false, error: 'description required for CAS E' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const now = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });

    // Vérification anti-doublon : lit les colonnes Réf + Code barre existantes (sauf CAS E, sans code)
    if (!isCasE) try {
      const checkUrl = `${GATEWAY_URL}/spreadsheets/${SPREADSHEET_ID}/values/${DEDUP_RANGE}`;
      const checkRes = await fetch(checkUrl, {
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          'X-Connection-Api-Key': GOOGLE_SHEETS_API_KEY,
        },
      });
      if (checkRes.ok) {
        const data = await checkRes.json();
        const rows: string[][] = data.values ?? [];
        const refStr = String(ref ?? '').trim();
        const barcodeStr = String(barcode ?? '').trim();
        const exists = rows.some(([r, b]) => {
          const rr = String(r ?? '').trim();
          const bb = String(b ?? '').trim();
          return (refStr && rr === refStr) || (barcodeStr && bb === barcodeStr);
        });
        if (exists) {
          return new Response(JSON.stringify({ ok: true, skipped: 'duplicate' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } else {
        console.warn('Dedup check failed', checkRes.status, await checkRes.text());
      }
    } catch (e) {
      console.warn('Dedup check error', e);
    }

    // Colonnes standard (B→I): Réf | Code barre | Libellé | Marque | Stock | Emplacement | Note | Etat
    // Colonnes CAS E (A→H): Photo | Date | Description | Emplacement | Quantité | Note | Utilisateur | Etat
    const row = isCasE
      ? [
          imageUrl ? `=IMAGE("${String(imageUrl).replace(/"/g, '')}")` : '',
          now,
          description ?? '',
          emplacement ?? '',
          quantite ?? '',
          note ?? '',
          user ?? '',
          'A traiter',
        ]
      : [
          ref ?? '',
          barcode ?? '',
          label ?? '',
          fournisseur ?? '',
          stock ?? '',
          emplacement ?? '',
          `Export scan ${now}`,
          'A traiter',
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