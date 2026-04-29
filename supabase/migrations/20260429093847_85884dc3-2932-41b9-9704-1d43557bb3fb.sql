-- Table : produits non identifiés
CREATE TABLE public.unknown_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  barcode text NOT NULL CHECK (length(barcode) BETWEEN 1 AND 200),
  note text CHECK (note IS NULL OR length(note) <= 500),
  aisle text CHECK (aisle IS NULL OR length(aisle) <= 50),
  photo_path text CHECK (photo_path IS NULL OR length(photo_path) <= 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_unknown_products_user_created ON public.unknown_products(user_id, created_at DESC);
CREATE INDEX idx_unknown_products_status ON public.unknown_products(status);

ALTER TABLE public.unknown_products ENABLE ROW LEVEL SECURITY;

-- RLS : user voit le sien, admin voit tout
CREATE POLICY "Users can view own unknown products"
ON public.unknown_products FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can insert own unknown products"
ON public.unknown_products FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users and admins can update unknown products"
ON public.unknown_products FOR UPDATE TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users and admins can delete unknown products"
ON public.unknown_products FOR DELETE TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

-- Trigger updated_at
CREATE TRIGGER update_unknown_products_updated_at
BEFORE UPDATE ON public.unknown_products
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Bucket privé pour photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('unknown-product-photos', 'unknown-product-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies : owner OU admin
CREATE POLICY "Users can upload own unknown product photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'unknown-product-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users and admins can read unknown product photos"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'unknown-product-photos'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.has_role(auth.uid(), 'admin'::app_role)
  )
);

CREATE POLICY "Users and admins can delete unknown product photos"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'unknown-product-photos'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.has_role(auth.uid(), 'admin'::app_role)
  )
);