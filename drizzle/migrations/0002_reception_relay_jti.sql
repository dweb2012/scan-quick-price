CREATE TABLE public.reception_relay_jti (jti text PRIMARY KEY, used_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.reception_relay_jti TO service_role;
ALTER TABLE public.reception_relay_jti ENABLE ROW LEVEL SECURITY;