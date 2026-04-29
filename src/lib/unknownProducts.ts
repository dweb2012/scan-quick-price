import { supabase } from "@/integrations/supabase/client";

const BUCKET = "unknown-product-photos";

export interface UnknownProduct {
  id: string;
  user_id: string;
  barcode: string;
  note: string | null;
  aisle: string | null;
  photo_path: string | null;
  status: "pending" | "resolved";
  created_at: string;
  updated_at: string;
}

export interface UnknownProductWithUser extends UnknownProduct {
  user_email?: string | null;
  user_display_name?: string | null;
}

/**
 * Compresse une image côté client : redimensionne à <= maxSize px sur le côté
 * le plus long, encode en JPEG quality 0.8. Renvoie un Blob.
 */
export async function compressImage(file: File, maxSize = 1024, quality = 0.8): Promise<Blob> {
  if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) {
    throw new Error("Format d'image non supporté (JPEG, PNG ou WebP attendu)");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Image trop volumineuse (max 5 Mo)");
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Lecture image échouée"));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Décodage image échoué"));
    i.src = dataUrl;
  });

  const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas non disponible");
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality)
  );
  if (!blob) throw new Error("Compression image échouée");
  if (blob.size > 2 * 1024 * 1024) {
    throw new Error("Image compressée trop volumineuse (max 2 Mo)");
  }
  return blob;
}

export interface ReportPayload {
  barcode: string;
  note?: string | null;
  aisle?: string | null;
  photo?: File | null;
}

export async function reportUnknown(payload: ReportPayload): Promise<UnknownProduct> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw new Error("Non authentifié");
  const userId = userData.user.id;

  let photoPath: string | null = null;
  if (payload.photo) {
    const compressed = await compressImage(payload.photo);
    const fileName = `${userId}/${crypto.randomUUID()}.jpg`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(fileName, compressed, {
        contentType: "image/jpeg",
        cacheControl: "3600",
      });
    if (upErr) throw new Error(`Upload photo : ${upErr.message}`);
    photoPath = fileName;
  }

  const { data, error } = await supabase
    .from("unknown_products")
    .insert({
      user_id: userId,
      barcode: payload.barcode.trim().slice(0, 200),
      note: payload.note?.trim().slice(0, 500) || null,
      aisle: payload.aisle?.trim().slice(0, 50) || null,
      photo_path: photoPath,
    })
    .select()
    .single();

  if (error) {
    if (photoPath) await supabase.storage.from(BUCKET).remove([photoPath]);
    throw new Error(error.message);
  }
  return data as UnknownProduct;
}

export type UnknownFilter = "pending" | "resolved" | "all";

export async function listMyUnknowns(filter: UnknownFilter = "all"): Promise<UnknownProduct[]> {
  let q = supabase
    .from("unknown_products")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (filter !== "all") q = q.eq("status", filter);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as UnknownProduct[];
}

export async function listAllUnknowns(filter: UnknownFilter = "all"): Promise<UnknownProductWithUser[]> {
  let q = supabase
    .from("unknown_products")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (filter !== "all") q = q.eq("status", filter);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const items = (data ?? []) as UnknownProduct[];
  if (items.length === 0) return [];

  const userIds = Array.from(new Set(items.map((i) => i.user_id)));
  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id,email,display_name")
    .in("user_id", userIds);
  const map = new Map(
    (profiles ?? []).map((p: any) => [p.user_id, p])
  );
  return items.map((i) => ({
    ...i,
    user_email: map.get(i.user_id)?.email ?? null,
    user_display_name: map.get(i.user_id)?.display_name ?? null,
  }));
}

export async function updateUnknown(
  id: string,
  patch: Partial<Pick<UnknownProduct, "note" | "status">>
): Promise<void> {
  const clean: Record<string, unknown> = {};
  if (patch.note !== undefined) clean.note = patch.note?.trim().slice(0, 500) || null;
  if (patch.status !== undefined) clean.status = patch.status;
  const { error } = await supabase.from("unknown_products").update(clean).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteUnknown(item: UnknownProduct): Promise<void> {
  if (item.photo_path) {
    await supabase.storage.from(BUCKET).remove([item.photo_path]);
  }
  const { error } = await supabase.from("unknown_products").delete().eq("id", item.id);
  if (error) throw new Error(error.message);
}

const signedCache = new Map<string, { url: string; expires: number }>();

export async function getSignedPhotoUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const cached = signedCache.get(path);
  if (cached && cached.expires > Date.now()) return cached.url;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600);
  if (error || !data) return null;
  signedCache.set(path, { url: data.signedUrl, expires: Date.now() + 55 * 60 * 1000 });
  return data.signedUrl;
}

/** Encode une chaîne en cellule CSV sûre (RFC 4180 + protection injection formule). */
function csvCell(value: string | null | undefined): string {
  let v = (value ?? "").toString();
  // Anti-injection formule : préfixe ' si commence par = + - @
  if (/^[=+\-@]/.test(v)) v = "'" + v;
  if (/[",\n\r;]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function exportUnknownsCsv(items: UnknownProductWithUser[]): string {
  const header = ["code", "note", "allee", "statut", "utilisateur", "email", "date_creation", "photo_path"];
  const rows = items.map((i) => [
    csvCell(i.barcode),
    csvCell(i.note),
    csvCell(i.aisle),
    csvCell(i.status === "pending" ? "à traiter" : "traité"),
    csvCell(i.user_display_name),
    csvCell(i.user_email),
    csvCell(i.created_at),
    csvCell(i.photo_path),
  ].join(","));
  return "\uFEFF" + [header.join(","), ...rows].join("\r\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}