
-- Drop all existing permissive policies on connection_settings
DROP POLICY IF EXISTS "Anyone can insert settings" ON public.connection_settings;
DROP POLICY IF EXISTS "Anyone can read settings" ON public.connection_settings;
DROP POLICY IF EXISTS "Anyone can update settings" ON public.connection_settings;

-- Create authenticated-only policies for connection_settings
CREATE POLICY "Authenticated users can read settings"
  ON public.connection_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert settings"
  ON public.connection_settings FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update settings"
  ON public.connection_settings FOR UPDATE
  TO authenticated
  USING (true);

-- Drop all existing permissive policies on supplier_discounts
DROP POLICY IF EXISTS "Anyone can delete supplier discounts" ON public.supplier_discounts;
DROP POLICY IF EXISTS "Anyone can insert supplier discounts" ON public.supplier_discounts;
DROP POLICY IF EXISTS "Anyone can read supplier discounts" ON public.supplier_discounts;
DROP POLICY IF EXISTS "Anyone can update supplier discounts" ON public.supplier_discounts;

-- Create authenticated-only policies for supplier_discounts
CREATE POLICY "Authenticated users can read supplier discounts"
  ON public.supplier_discounts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert supplier discounts"
  ON public.supplier_discounts FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update supplier discounts"
  ON public.supplier_discounts FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can delete supplier discounts"
  ON public.supplier_discounts FOR DELETE
  TO authenticated
  USING (true);
