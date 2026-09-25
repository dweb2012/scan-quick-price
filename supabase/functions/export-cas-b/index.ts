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

// Force l'écriture d'un code (réf / code-barres) en texte pour préserver
// les zéros de tête : "09400842" ne doit pas devenir 9400842.
function asTextCode(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return /^0\d*$/.test(s) ? `'${s}` : s;
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
    const action = body?.action as string | undefined;
    const sheetName = ALLOWED_SHEETS.includes(body?.sheet) ? body.sheet : 'B';

    // ────────────────────────────────────────────────────────────────────
    // Action « updateStock » : cherche la ligne correspondante dans les onglets
    // A / B / D et met à jour la colonne Stock. Sans append.
    // Mapping colonnes :
    //   A, B, C → Réf en col A, Stock en col E
    //   D       → Réf en col B, Stock en col F
    // ────────────────────────────────────────────────────────────────────
    // ────────────────────────────────────────────────────────────────────
    // Action « updateEmplacement » : un même produit peut être rangé dans
    // plusieurs emplacements. Pour chaque onglet A/B/D :
    //   - une ligne a déjà cet emplacement → rien
    //   - une ligne a un emplacement vide → on le remplit
    //   - sinon → on ajoute une NOUVELLE ligne (copie) avec le nouvel emplacement
    // ────────────────────────────────────────────────────────────────────
    if (action === 'updateEmplacement') {
      const refStr = String(ref ?? '').trim();
      const newEmpl = String(emplacement ?? '').trim();
      if (!refStr || !newEmpl) {
        return new Response(JSON.stringify({ ok: false, error: 'ref and emplacement required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const norm = (s: unknown) => String(s ?? '').trim().toLocaleUpperCase();
      const nowStr = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
      const targets = [
        { sheet: 'A', off: 0, lastCol: 'H' },
        { sheet: 'B', off: 0, lastCol: 'H' },
        { sheet: 'D', off: 1, lastCol: 'I' },
      ];
      const hdr = {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'X-Connection-Api-Key': GOOGLE_SHEETS_API_KEY,
      };
      let updated = 0, appended = 0, found = 0;
      const failed: string[] = [];
      for (const t of targets) {
        const readRes = await fetch(
          `${GATEWAY_URL}/spreadsheets/${SPREADSHEET_ID}/values/${t.sheet}!A:${t.lastCol}?valueRenderOption=FORMULA`,
          { headers: hdr },
        );
        if (!readRes.ok) {
          console.error('updateEmplacement read failed', t.sheet, readRes.status, await readRes.text());
          failed.push(t.sheet);
          continue;
        }
        const rows: any[][] = (await readRes.json()).values ?? [];
        const emplIdx = 5 + t.off;
        const matches = rows
          .map((cols, idx) => ({ cols, rowNumber: idx + 1 }))
          .filter(({ cols, rowNumber }) => rowNumber > 1 && norm(cols?.[t.off]) === norm(refStr));
        if (matches.length === 0) continue;
        found++;
        if (matches.some((m) => norm(m.cols?.[emplIdx]) === norm(newEmpl))) continue;
        const empty = matches.find((m) => !norm(m.cols?.[emplIdx]));
        const emplCol = String.fromCharCode(65 + emplIdx);
        if (empty) {
          const putRes = await fetch(
            `${GATEWAY_URL}/spreadsheets/${SPREADSHEET_ID}/values/${t.sheet}!${emplCol}${empty.rowNumber}?valueInputOption=RAW`,
            { method: 'PUT', headers: { ...hdr, 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [[newEmpl]] }) },
          );
          if (putRes.ok) updated++;
          else { console.error('updateEmplacement put failed', t.sheet, putRes.status, await putRes.text()); failed.push(t.sheet); }
          continue;
        }
        // Nouvelle ligne : copie de la première ligne trouvée avec le nouvel emplacement
        const width = t.off + 8;
        const copy = Array.from({ length: width }, (_, i) => matches[0].cols?.[i] ?? '');
        copy[t.off] = asTextCode(copy[t.off]);
        copy[t.off + 1] = asTextCode(copy[t.off + 1]);
        copy[emplIdx] = newEmpl;
        copy[t.off + 6] = [user ? `par ${user}` : '', `Autre emplacement ${nowStr}`].filter(Boolean).join(' • ');
        copy[t.off + 7] = 'A traiter';
        const usedR = await fetch(`${GATEWAY_URL}/spreadsheets/${SPREADSHEET_ID}/values/${t.sheet}!A:Z`, { headers: hdr });
        let nr = 2;
        if (usedR.ok) {
          const vals: string[][] = (await usedR.json())?.values ?? [];
          let last = 0;
          vals.forEach((r, i) => { if (r.some((c) => String(c ?? '').trim() !== '')) last = i + 1; });
          nr = Math.max(2, last + 1);
        }
        const appRes = await fetch(
          `${GATEWAY_URL}/spreadsheets/${SPREADSHEET_ID}/values/${t.sheet}!A${nr}:${t.lastCol}${nr}?valueInputOption=USER_ENTERED`,
          { method: 'PUT', headers: { ...hdr, 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [copy] }) },
        );
        if (appRes.ok) appended++;
        else { console.error('updateEmplacement append failed', t.sheet, appRes.status, await appRes.text()); failed.push(t.sheet); }
      }
      return new Response(JSON.stringify({ ok: true, updated, appended, found, failed }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'updateStock') {
      const isEmpl = false;
      const refStr = String(ref ?? '').trim();
      if (!refStr) {
        return new Response(JSON.stringify({ ok: false, error: 'ref required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const stockValue = isEmpl ? (emplacement ?? '') : (stock ?? '');
      const targets: Array<{ sheet: string; refCol: 0 | 1; stockCol: string; readRange: string }> = isEmpl
        ? [
            { sheet: 'A', refCol: 0, stockCol: 'F', readRange: 'A!A:A' },
            { sheet: 'B', refCol: 0, stockCol: 'F', readRange: 'B!A:A' },
            { sheet: 'D', refCol: 1, stockCol: 'G', readRange: 'D!B:B' },
          ]
        : [
            { sheet: 'A', refCol: 0, stockCol: 'E', readRange: 'A!A:A' },
            { sheet: 'B', refCol: 0, stockCol: 'E', readRange: 'B!A:A' },
            { sheet: 'D', refCol: 1, stockCol: 'F', readRange: 'D!B:B' },
          ];
      const updates: Array<{ range: string; values: any[][] }> = [];
      const readFailures: string[] = [];
      for (const t of targets) {
        try {
          const readUrl = `${GATEWAY_URL}/spreadsheets/${SPREADSHEET_ID}/values/${t.readRange}`;
          const readRes = await fetch(readUrl, {
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              'X-Connection-Api-Key': GOOGLE_SHEETS_API_KEY,
            },
          });
          if (!readRes.ok) {
            const errorText = await readRes.text();
            console.error('Sheet lookup failed', t.sheet, readRes.status, errorText);
            readFailures.push(`${t.sheet}: ${readRes.status}`);
            continue;
          }
          const data = await readRes.json();
          const rows: string[][] = data.values ?? [];
          rows.forEach((cols, idx) => {
            const cell = String(cols?.[0] ?? '').trim();
            if (cell && cell.toLocaleUpperCase() === refStr.toLocaleUpperCase()) {
              // idx est 0-based sur la plage ; rowNumber Sheets = idx + 1
              const rowNumber = idx + 1;
              updates.push({
                range: `${t.sheet}!${t.stockCol}${rowNumber}`,
                values: [[stockValue]],
              });
            }
          });
        } catch (e) {
          console.warn('updateStock read failed', t.sheet, e);
          readFailures.push(t.sheet);
        }
      }

      if (readFailures.length > 0) {
        return new Response(
          JSON.stringify({ ok: false, error: `Lecture Google Sheet impossible (${readFailures.join(', ')})` }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      if (updates.length === 0) {
        return new Response(JSON.stringify({ ok: true, updated: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const batchUrl = `${GATEWAY_URL}/spreadsheets/${SPREADSHEET_ID}/values:batchUpdate`;
      const batchRes = await fetch(batchUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          'X-Connection-Api-Key': GOOGLE_SHEETS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: updates }),
      });
      const batchText = await batchRes.text();
      if (!batchRes.ok) {
        console.error('updateStock batchUpdate failed', batchRes.status, batchText);
        return new Response(
          JSON.stringify({ ok: false, status: batchRes.status, error: batchText.slice(0, 500) }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ ok: true, updated: updates.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ────────────────────────────────────────────────────────────────────
    // Actions « listRows » / « updateRow » : consultation et modification des
    // lignes déjà présentes dans les onglets A→E.
    // Mapping : A/B/C sans colonne Photo (offset 0), D/E avec Photo en A (offset 1)
    //   Réf | Code barre | Libellé | Marque | Stock | Emplacement | Note | Etat
    // ────────────────────────────────────────────────────────────────────
    const colOffset = (s: string) => (s === 'D' || s === 'E' ? 1 : 0);
    const colLetter = (i: number) => String.fromCharCode(65 + i);
    const sheetsApi = async (path: string, init?: RequestInit) =>
      fetch(`${GATEWAY_URL}/spreadsheets/${SPREADSHEET_ID}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          'X-Connection-Api-Key': GOOGLE_SHEETS_API_KEY,
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init?.headers ?? {}),
        },
      });

    if (action === 'listRows') {
      const q = String(body?.query ?? '').trim().toLocaleLowerCase();
      const out: any[] = [];
      for (const s of ALLOWED_SHEETS) {
        const res = await sheetsApi(`/values/${s}!A:I`);
        if (!res.ok) {
          console.warn('listRows read failed', s, res.status, await res.text());
          continue;
        }
        const data = await res.json();
        const rows: string[][] = data.values ?? [];
        const o = colOffset(s);
        rows.forEach((cols, idx) => {
          if (idx === 0) return; // entête
          const get = (i: number) => String(cols?.[o + i] ?? '').trim();
          const item = {
            sheet: s,
            row: idx + 1,
            ref: get(0),
            barcode: get(1),
            label: get(2),
            fournisseur: get(3),
            stock: get(4),
            emplacement: get(5),
            note: get(6),
            etat: get(7),
          };
          if (!item.ref && !item.barcode && !item.label) return;
          if (q) {
            const hay = `${item.ref} ${item.barcode} ${item.label} ${item.fournisseur}`.toLocaleLowerCase();
            if (!hay.includes(q)) return;
          }
          out.push(item);
        });
      }
      return new Response(JSON.stringify({ ok: true, rows: out.slice(0, 500) }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'updateRow') {
      const s = String(body?.sheet ?? '');
      const rowNumber = Number(body?.row);
      if (!ALLOWED_SHEETS.includes(s as any) || !Number.isInteger(rowNumber) || rowNumber < 2) {
        return new Response(JSON.stringify({ ok: false, error: 'sheet/row invalides' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const o = colOffset(s);
      const fieldIndex: Record<string, number> = {
        ref: 0, barcode: 1, label: 2, fournisseur: 3, stock: 4, emplacement: 5, note: 6,
      };
      const updates: Array<{ range: string; values: any[][] }> = [];
      for (const [key, i] of Object.entries(fieldIndex)) {
        const v = body?.[key];
        if (v === undefined) continue;
        const value = key === 'ref' || key === 'barcode' ? String(v ?? '') : (v ?? '');
        updates.push({ range: `${s}!${colLetter(o + i)}${rowNumber}`, values: [[value]] });
      }
      if (updates.length === 0) {
        return new Response(JSON.stringify({ ok: true, updated: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const res = await sheetsApi('/values:batchUpdate', {
        method: 'POST',
        body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
      });
      const txt = await res.text();
      if (!res.ok) {
        console.error('updateRow failed', res.status, txt);
        return new Response(JSON.stringify({ ok: false, status: res.status, error: txt.slice(0, 500) }), {
          status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true, updated: updates.length }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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
          asTextCode(ref),
          asTextCode(barcode),
          label ?? '',
          fournisseur ?? '',
          stock ?? '',
          emplacement ?? '',
          [note, user ? `par ${user}` : '', `Export scan ${now}`].filter(Boolean).join(' • '),
          'A traiter',
        ]
      : [
          // B / C : sans colonne Photo
          asTextCode(ref),
          asTextCode(barcode),
          label ?? '',
          fournisseur ?? '',
          stock ?? '',
          emplacement ?? '',
          [note, user ? `par ${user}` : '', `Export scan ${now}`].filter(Boolean).join(' • '),
          'A traiter',
        ];


    // Écriture à une ligne explicite (dernière ligne remplie + 1) au lieu de ":append",
    // dont la détection de « tableau » de Google décale parfois les colonnes.
    const [tabName, colSpan] = SHEET_RANGE.split('!');
    const lastColLetter = (colSpan.split(':')[1] || 'I').replace(/\d+/g, '');
    const gHeaders = {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      'X-Connection-Api-Key': GOOGLE_SHEETS_API_KEY,
    };
    let nextRow = 2;
    const usedRes = await fetch(`${GATEWAY_URL}/spreadsheets/${SPREADSHEET_ID}/values/${tabName}!A:Z`, { headers: gHeaders });
    if (usedRes.ok) {
      const vals: string[][] = (await usedRes.json())?.values ?? [];
      let last = 0;
      vals.forEach((r, i) => { if (r.some((c) => String(c ?? '').trim() !== '')) last = i + 1; });
      nextRow = Math.max(2, last + 1);
    }
    const url = `${GATEWAY_URL}/spreadsheets/${SPREADSHEET_ID}/values/${tabName}!A${nextRow}:${lastColLetter}${nextRow}?valueInputOption=USER_ENTERED`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...gHeaders, 'Content-Type': 'application/json' },
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
      const updatedRange: string = appendJson?.updates?.updatedRange ?? appendJson?.updatedRange ?? '';
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