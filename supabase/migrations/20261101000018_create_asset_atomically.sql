-- Locally prepared. The existing direct asset insert path is unchanged for
-- compatibility until an approved coordinated frontend cutover. This RPC
-- creates an asset, allocates its tag, and writes its creation history in one
-- transaction. Review rollout/rollback and existing manual tag writers first.
CREATE TABLE IF NOT EXISTS public.asset_tag_counters (
  tag_year text PRIMARY KEY CHECK (tag_year ~ '^[0-9]{4}$'),
  last_issued bigint NOT NULL CHECK (last_issued > 0)
);
ALTER TABLE public.asset_tag_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.asset_tag_counters FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.asset_creation_requests (
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  payload jsonb NOT NULL,
  asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, request_id)
);
ALTER TABLE public.asset_creation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.asset_creation_requests FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_asset_with_history(p_request_id uuid, p_asset jsonb)
RETURNS public.assets LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  actor uuid := auth.uid();
  actor_role public.user_role := public.get_my_role();
  prior public.asset_creation_requests%ROWTYPE;
  created public.assets%ROWTYPE;
  current_year text := to_char(now() AT TIME ZONE 'Asia/Manila', 'YYYY');
  prefix text := 'DOST02-ITA' || current_year;
  issued bigint;
BEGIN
  IF actor IS NULL OR actor_role NOT IN ('administrator'::public.user_role, 'support_staff'::public.user_role) OR actor_role IS NULL THEN
    RAISE EXCEPTION 'Only active administrators and support staff can create assets';
  END IF;
  IF p_request_id IS NULL OR p_asset IS NULL OR jsonb_typeof(p_asset) <> 'object'
     OR p_asset - ARRAY['name','category','status','assigned_to','purchase_date','purchase_value','notes','serial_number','location','model','last_pm_date','next_pm_date','pm_required'] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Invalid asset creation request';
  END IF;
  IF NULLIF(btrim(p_asset->>'name'), '') IS NULL OR NULLIF(p_asset->>'category', '') IS NULL THEN
    RAISE EXCEPTION 'Asset name and category are required';
  END IF;
  IF actor_role = 'support_staff'::public.user_role AND
     (COALESCE(p_asset->>'status', 'active') <> 'active' OR NULLIF(p_asset->>'assigned_to', '') IS NOT NULL) THEN
    RAISE EXCEPTION 'Only administrators may set asset status or assignment';
  END IF;

  INSERT INTO public.asset_creation_requests(actor_id, request_id, payload)
  VALUES (actor, p_request_id, p_asset) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    SELECT * INTO prior FROM public.asset_creation_requests WHERE actor_id = actor AND request_id = p_request_id;
    IF prior.payload IS DISTINCT FROM p_asset THEN RAISE EXCEPTION 'Request ID already used with different asset data'; END IF;
    SELECT * INTO created FROM public.assets WHERE id = prior.asset_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Previously created asset is no longer available'; END IF;
    RETURN created;
  END IF;

  INSERT INTO public.asset_tag_counters AS counters(tag_year, last_issued)
  VALUES (current_year, COALESCE((
    SELECT MAX(SUBSTRING(a.asset_tag FROM char_length(prefix) + 1)::bigint)
    FROM public.assets a
    WHERE upper(a.asset_tag) ~ ('^' || prefix || '[0-9]+$')
  ), 0) + 1)
  ON CONFLICT (tag_year) DO UPDATE
    SET last_issued = GREATEST(counters.last_issued + 1, EXCLUDED.last_issued)
  RETURNING last_issued INTO issued;

  INSERT INTO public.assets(asset_tag,name,category,status,assigned_to,purchase_date,purchase_value,notes,serial_number,location,model,last_pm_date,next_pm_date,pm_required)
  VALUES (
    prefix || lpad(issued::text, GREATEST(6, length(issued::text)), '0'),
    p_asset->>'name', (p_asset->>'category')::public.asset_category_type,
    COALESCE(p_asset->>'status', 'active')::public.asset_status,
    NULLIF(p_asset->>'assigned_to', '')::uuid, NULLIF(p_asset->>'purchase_date', '')::date,
    NULLIF(p_asset->>'purchase_value', '')::numeric, p_asset->>'notes', p_asset->>'serial_number',
    p_asset->>'location', p_asset->>'model', NULLIF(p_asset->>'last_pm_date', '')::date,
    NULLIF(p_asset->>'next_pm_date', '')::date, COALESCE((p_asset->>'pm_required')::boolean, true)
  ) RETURNING * INTO created;
  INSERT INTO public.asset_history(asset_id,action,field_name,new_value,changed_by)
  VALUES (created.id,'created','Asset',created.asset_tag || ' — ' || created.name,actor);
  UPDATE public.asset_creation_requests SET asset_id = created.id WHERE actor_id = actor AND request_id = p_request_id;
  RETURN created;
END;
$$;
REVOKE ALL ON FUNCTION public.create_asset_with_history(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_asset_with_history(uuid,jsonb) TO authenticated;
