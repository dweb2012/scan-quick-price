DROP POLICY IF EXISTS "Authenticated users can read settings" ON public.connection_settings;
CREATE POLICY "Admins can read settings" ON public.connection_settings FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Authenticated users can read supplier discounts" ON public.supplier_discounts;
CREATE POLICY "Signed-in users can read supplier discounts" ON public.supplier_discounts FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);