
-- Create a table for connection settings (shared across all devices)
CREATE TABLE public.connection_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  base_url TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.connection_settings ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read settings (internal warehouse app, no auth)
CREATE POLICY "Anyone can read settings"
  ON public.connection_settings FOR SELECT
  USING (true);

-- Allow anyone to insert settings
CREATE POLICY "Anyone can insert settings"
  ON public.connection_settings FOR INSERT
  WITH CHECK (true);

-- Allow anyone to update settings
CREATE POLICY "Anyone can update settings"
  ON public.connection_settings FOR UPDATE
  USING (true);

-- Create trigger for automatic timestamp updates
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_connection_settings_updated_at
  BEFORE UPDATE ON public.connection_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
