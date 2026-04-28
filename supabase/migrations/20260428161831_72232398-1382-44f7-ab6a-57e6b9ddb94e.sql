-- 1. PROFILES: restrict SELECT to self or admin
DROP POLICY IF EXISTS "Authenticated users can read profiles" ON public.profiles;

CREATE POLICY "Users can read own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins can read all profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 2. CONNECTION_SETTINGS: restrict writes to admins only (read still authenticated)
DROP POLICY IF EXISTS "Authenticated users can insert settings" ON public.connection_settings;
DROP POLICY IF EXISTS "Authenticated users can update settings" ON public.connection_settings;

CREATE POLICY "Admins can insert settings"
ON public.connection_settings
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update settings"
ON public.connection_settings
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete settings"
ON public.connection_settings
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 3. SUPPLIER_DISCOUNTS: restrict writes to admins only
DROP POLICY IF EXISTS "Authenticated users can insert supplier discounts" ON public.supplier_discounts;
DROP POLICY IF EXISTS "Authenticated users can update supplier discounts" ON public.supplier_discounts;
DROP POLICY IF EXISTS "Authenticated users can delete supplier discounts" ON public.supplier_discounts;

CREATE POLICY "Admins can insert supplier discounts"
ON public.supplier_discounts
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update supplier discounts"
ON public.supplier_discounts
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete supplier discounts"
ON public.supplier_discounts
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 4. has_role: prevent enumeration of other users' roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only allow checking the caller's own roles, unless caller is admin
  IF _user_id <> auth.uid() AND NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'::app_role
  ) THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
END;
$function$;

-- 5. Lock down EXECUTE on has_role: revoke from anon, keep for authenticated
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;