ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS dolibarr_user_id integer;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_dolibarr_user_id_unique ON public.profiles (dolibarr_user_id) WHERE dolibarr_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_dolibarr_user_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- server-side (service key) or internal triggers
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.dolibarr_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin') THEN
      RAISE EXCEPTION 'Seuls les administrateurs peuvent définir l''ID Dolibarr';
    END IF;
  ELSIF NEW.dolibarr_user_id IS DISTINCT FROM OLD.dolibarr_user_id THEN
    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin') THEN
      RAISE EXCEPTION 'Seuls les administrateurs peuvent modifier l''ID Dolibarr';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profiles_dolibarr_user_id ON public.profiles;
CREATE TRIGGER guard_profiles_dolibarr_user_id BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_dolibarr_user_id();

CREATE TABLE IF NOT EXISTS public.sso_used_tokens (
  jti text PRIMARY KEY,
  used_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.sso_used_tokens TO service_role;
ALTER TABLE public.sso_used_tokens ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_connection_settings_public()
RETURNS TABLE (base_url text, has_api_key boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT c.base_url, (coalesce(c.api_key, '') <> '') AS has_api_key
  FROM public.connection_settings c
  WHERE EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_connection_settings_public() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_connection_settings_public() TO authenticated;