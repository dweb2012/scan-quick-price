import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// Proxy public — sert les photos CAS E depuis le bucket privé pour que
// Google Sheets puisse les afficher via =IMAGE(). Pas de CORS restrictif :
// c'est une image publique lisible par tout GET.
Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const path = url.searchParams.get('path');
    if (!path) return new Response('missing path', { status: 400 });

    // Sécurité minimale : forcer le préfixe uuid/uuid.jpg (userId/file.jpg)
    if (!/^[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/i.test(path)) {
      return new Response('bad path', { status: 400 });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data, error } = await admin.storage.from('cas-e-photos').download(path);
    if (error || !data) return new Response('not found', { status: 404 });

    return new Response(data, {
      headers: {
        'Content-Type': data.type || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
});