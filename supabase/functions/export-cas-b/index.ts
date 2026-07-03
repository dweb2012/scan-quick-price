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

    // CAS E : upload de la photo sur Google Drive avant d'écrire la ligne
    let driveImageUrl = '';
    if (isCasE && imageDataUrl) {
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
      const name = `case-${stamp}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
      driveImageUrl = await uploadToDrive(
        { lovable: LOVABLE_API_KEY, drive: GOOGLE_DRIVE_API_KEY },
        { name, mime: decoded.mime, bytes: decoded.bytes },
      );
    }

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
          driveImageUrl ? `=IMAGE("${driveImageUrl}")` : '',
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