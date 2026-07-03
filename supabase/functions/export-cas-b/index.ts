import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SPREADSHEET_ID = '1R0hK3jKIx70WjV3fHhSyaPhuLAMRdJCKpvpFMR2SIQs';
const GATEWAY_URL = 'https://connector-gateway.lovable.dev/google_sheets/v4';
const DRIVE_GATEWAY = 'https://connector-gateway.lovable.dev/google_drive';
const ALLOWED_SHEETS = ['B', 'C', 'D', 'E'] as const;

// Décode une data URL "data:image/jpeg;base64,xxxx" en {mime, bytes}
function decodeDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: m[1], bytes };
}

// Upload une image sur Google Drive (compte du connecteur), la rend lisible
// par lien, et renvoie une URL affichable par la formule =IMAGE().
async function uploadToDrive(
  auth: { lovable: string; drive: string },
  file: { name: string; mime: string; bytes: Uint8Array },
): Promise<string> {
  // 1. Upload multipart (métadonnées + contenu binaire en une requête)
  const boundary = `----lovable${crypto.randomUUID()}`;
  const enc = new TextEncoder();
  const metadata = { name: file.name, mimeType: file.mime };
  const preamble = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\nContent-Type: ${file.mime}\r\n\r\n`,
  );
  const closing = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(preamble.length + file.bytes.length + closing.length);
  body.set(preamble, 0);
  body.set(file.bytes, preamble.length);
  body.set(closing, preamble.length + file.bytes.length);

  const upRes = await fetch(
    `${DRIVE_GATEWAY}/upload/drive/v3/files?uploadType=multipart&fields=id`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.lovable}`,
        'X-Connection-Api-Key': auth.drive,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!upRes.ok) throw new Error(`Drive upload ${upRes.status}: ${(await upRes.text()).slice(0, 300)}`);
  const { id } = await upRes.json();
  if (!id) throw new Error('Drive upload: id manquant');

  // 2. Permission publique (lecture par lien)
  const permRes = await fetch(
    `${DRIVE_GATEWAY}/drive/v3/files/${id}/permissions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.lovable}`,
        'X-Connection-Api-Key': auth.drive,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    },
  );
  if (!permRes.ok) console.warn('Drive permission', permRes.status, await permRes.text());

  // URL affichable par =IMAGE() dans Google Sheets
  return `https://lh3.googleusercontent.com/d/${id}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const GOOGLE_SHEETS_API_KEY = Deno.env.get('GOOGLE_SHEETS_API_KEY');
    const GOOGLE_DRIVE_API_KEY = Deno.env.get('GOOGLE_DRIVE_API_KEY');
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
      if (!GOOGLE_DRIVE_API_KEY) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Google Drive connector not configured' }),
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
      driveImageUrl = await uploadToDrive(
        { lovable: LOVABLE_API_KEY, drive: GOOGLE_DRIVE_API_KEY },
        { name, mime: decoded.mime, bytes: decoded.bytes },
      );
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
          // Mode 4 + 130x130 px : image affichée en grand quelle que soit la taille de la cellule
          driveImageUrl ? `=IMAGE("${driveImageUrl}", 4, 130, 130)` : '',
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
          driveImageUrl ? `=IMAGE("${driveImageUrl}", 4, 130, 130)` : '',
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
                  requests: [{
                    updateDimensionProperties: {
                      range: {
                        sheetId,
                        dimension: 'ROWS',
                        startIndex: rowIndex,
                        endIndex: rowIndex + 1,
                      },
                      properties: { pixelSize: 140 },
                      fields: 'pixelSize',
                    },
                  }],
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