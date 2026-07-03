
CREATE POLICY "authenticated users upload cas-e-photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'cas-e-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "authenticated users read own cas-e-photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'cas-e-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "admins read all cas-e-photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'cas-e-photos' AND public.has_role(auth.uid(), 'admin'));
