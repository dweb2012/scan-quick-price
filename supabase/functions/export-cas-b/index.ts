import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const SPREADSHEET_ID = '1R0hK3jKIx70WjV3fHhSyaPhuLAMRdJCKpvpFMR2SIQs';
const GATEWAY_URL = 'https://connector-gateway.lovable.dev/google_sheets/v4';
const PHOTO_BUCKET = 'sheet-photos';
const ALLOWED_SHEETS = ['A', 'B', 'C', 'D', 'E'] as const;

// Décode une data URL "data:image/jpeg;base64,xxxx" en {mime, bytes}
function decodeDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: m[1], bytes };
}

// Upload une image sur Supabase Storage et retourne une URL signée
// longue durée (10 ans) — fiable avec la formule =IMAGE() de Google Sheets
// car l'URL sert directement le binaire avec le bon Content-Type.
async function uploadToStorage(
  supabase: ReturnType<typeof createClient>,
  file: { name: string; mime: string; bytes: Uint8Array },
): Promise<string> {
  const { error: upErr } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(file.name, file.bytes, { contentType: file.mime, upsert: false });
  if (upErr) throw new Error(`Storage upload: ${upErr.message}`);

  const { data, error: signErr } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(file.name, 60 * 60 * 24 * 365 * 10); // 10 ans
  if (signErr || !data?.signedUrl) throw new Error(`Signed URL: ${signErr?.message ?? 'unknown'}`);
  return data.signedUrl;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const GOOGLE_SHEETS_API_KEY = Deno.env.get('GOOGLE_SHEETS_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!LOVABLE_API_KEY || !GOOGLE_SHEETS_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: 'Google Sheets connector not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { ref, label, barcode, stock, emplacement, fournisseur, description, quantite, note, user, imageDataUrl } = body ?? {};
    const sheetName = ALLOWED_SHEETS.includes(body?.sheet) ? body.sheet : 'B';
    const isCasE = sheetName === 'E';
    const isCasD = sheetName === 'D';
    const hasPhotoCol = isCasE || isCasD;
    // D + E : 9 colonnes A→I avec Photo en A
    //   A: Photo | B: Réf | C: Code barre | D: Libellé | E: Marque | F: Stock | G: Emplacement | H: Note | I: Etat
    // B + C : 8 colonnes A→H sans Photo
    //   A: Réf | B: Code barre | C: Libellé | D: Marque | E: Stock | F: Emplacement | G: Note | H: Etat
    const SHEET_RANGE = hasPhotoCol ? `${sheetName}!A:I` : `${sheetName}!A:H`;
    // Dédoublonnage : on lit les colonnes contenant Réf/Code barre.
    //   D/E : Réf en B, Code barre en C → lit A:C (A capte aussi d'anciennes lignes décalées)
    //   B/C : Réf en A, Code barre en B → lit A:B
    const DEDUP_RANGE = hasPhotoCol ? `${sheetName}!A:C` : `${sheetName}!A:B`;

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
    if (isCasD && !imageDataUrl) {
      return new Response(JSON.stringify({ ok: false, error: 'photo required for CAS D' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const now = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });

    // CAS E + CAS D : upload de la photo sur Google Drive avant d'écrire la ligne
    let driveImageUrl = '';
    if ((isCasE || isCasD) && imageDataUrl) {
      if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Supabase storage not configured' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const decoded = decodeDataUrl(imageDataUrl);
      if (!decoded) {
        return new Response(JSON.stringify({ ok: false, error: 'invalid imageDataUrl' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const ext = decoded.mime.split('/')[1] || 'jpg';
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const prefix = isCasE ? 'case' : 'casd';
      const name = `${prefix}-${stamp}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      driveImageUrl = await uploadToStorage(supabase, {
        name,
        mime: decoded.mime,
        bytes: decoded.bytes,
      });
    }

    // Vérification anti-doublon : lit Photo/Réf/Code barre pour couvrir les anciennes lignes décalées et les nouvelles lignes alignées
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
        // On compare chaque code non vide (ref ET barcode) à TOUTES les colonnes A/B/C
        // pour couvrir les anciennes lignes décalées (code en A ou B) et les nouvelles
        // (Réf en B, Code barre en C). Ex : CAS C envoie le code en `barcode` (col C),
        // mais une ancienne ligne peut l'avoir mis en col B (Réf) — il faut quand même
        // détecter le doublon.
        const candidates = [refStr, barcodeStr].filter(Boolean);
        const exists = rows.some((cols) => {
          const cells = [0, 1, 2].map((i) => String(cols?.[i] ?? '').trim()).filter(Boolean);
          return candidates.some((c) => cells.includes(c));
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

    // Onglet E — 9 colonnes alignées sur les entêtes existants :
    //   A: Photo | B: Réf (vide) | C: Code barre (vide) | D: Libellé (= description) |
    //   E: Marque (vide) | F: Stock (= quantité estimée) | G: Emplacement |
    //   H: Note (note + date + utilisateur) | I: Etat
    // Onglet D — 9 colonnes A→I : Photo | Réf | Code barre | Libellé | Marque | Stock | Emplacement | Note | Etat
    // Onglets B/C — 8 colonnes A→H (sans Photo) : Réf | Code barre | Libellé | Marque | Stock | Emplacement | Note | Etat
    const row = isCasE
      ? [
          // Mode 4 + 130x130 px. Le Google Sheet est en locale FR : séparateur d'arguments = point-virgule.
          driveImageUrl ? `=IMAGE("${driveImageUrl}"; 4; 240; 240)` : '',
          '',
          '',
          description ?? '',
          '',
          quantite ?? '',
          emplacement ?? '',
          [note, user, now].filter(Boolean).join(' • '),
          'A traiter',
        ]
      : isCasD
      ? [
          driveImageUrl ? `=IMAGE("${driveImageUrl}"; 4; 240; 240)` : '',
          ref ?? '',
          barcode ?? '',
          label ?? '',
          fournisseur ?? '',
          stock ?? '',
          emplacement ?? '',
          [note, user ? `par ${user}` : '', `Export scan ${now}`].filter(Boolean).join(' • '),
          'A traiter',
        ]
      : [
          // B / C : sans colonne Photo
          ref ?? '',
          barcode ?? '',
          label ?? '',
          fournisseur ?? '',
          stock ?? '',
          emplacement ?? '',
          [note, user ? `par ${user}` : '', `Export scan ${now}`].filter(Boolean).join(' • '),
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

    // Photo présente : agrandit la hauteur de la nouvelle ligne pour rendre la photo lisible
    if (driveImageUrl) try {
      const appendJson = JSON.parse(text);
      const updatedRange: string = appendJson?.updates?.updatedRange ?? '';
      // Format attendu : "E!A5:I5" — on récupère 5
      const rowMatch = /![A-Z]+(\d+):/.exec(updatedRange);
      if (rowMatch) {
        const rowIndex = parseInt(rowMatch[1], 10) - 1; // 0-based pour l'API
        // Récupère le sheetId de l'onglet "E"
        const metaRes = await fetch(
          `${GATEWAY_URL}/spreadsheets/${SPREADSHEET_ID}?fields=sheets(properties(sheetId,title))`,
          { headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'X-Connection-Api-Key': GOOGLE_SHEETS_API_KEY } },
        );
        if (metaRes.ok) {
          const meta = await metaRes.json();
          const sheet = (meta.sheets ?? []).find((s: any) => s?.properties?.title === sheetName);
          const sheetId = sheet?.properties?.sheetId;
          if (typeof sheetId === 'number') {
            await fetch(
              `${GATEWAY_URL}/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${LOVABLE_API_KEY}`,
                  'X-Connection-Api-Key': GOOGLE_SHEETS_API_KEY,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  requests: [
                    {
                      updateDimensionProperties: {
                        range: {
                          sheetId,
                          dimension: 'ROWS',
                          startIndex: rowIndex,
                          endIndex: rowIndex + 1,
                        },
                        properties: { pixelSize: 250 },
                        fields: 'pixelSize',
                      },
                    },
                    {
                      updateDimensionProperties: {
                        range: {
                          sheetId,
                          dimension: 'COLUMNS',
                          startIndex: 0,
                          endIndex: 1,
                        },
                        properties: { pixelSize: 250 },
                        fields: 'pixelSize',
                      },
                    },
                  ],
                }),
              },
            );
          }
        }
      }
    } catch (e) {
      console.warn('row height update failed', e);
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