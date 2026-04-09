
CREATE TABLE public.supplier_discounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_name TEXT NOT NULL UNIQUE,
  discount_percent NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_discounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read supplier discounts" ON public.supplier_discounts FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can insert supplier discounts" ON public.supplier_discounts FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Anyone can update supplier discounts" ON public.supplier_discounts FOR UPDATE TO public USING (true);
CREATE POLICY "Anyone can delete supplier discounts" ON public.supplier_discounts FOR DELETE TO public USING (true);

CREATE TRIGGER update_supplier_discounts_updated_at
BEFORE UPDATE ON public.supplier_discounts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.supplier_discounts (supplier_name, discount_percent) VALUES ('Hendi', 15);
