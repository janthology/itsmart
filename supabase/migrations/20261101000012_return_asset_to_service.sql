-- Return to service changes status and history together, retaining assignment.
CREATE OR REPLACE FUNCTION public.return_asset_to_service(p_asset_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.assets%ROWTYPE;
BEGIN
  IF public.get_my_role() IS DISTINCT FROM 'administrator'::public.user_role THEN
    RAISE EXCEPTION 'Only active administrators may return assets to service';
  END IF;
  SELECT * INTO a FROM public.assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asset not found'; END IF;
  IF a.status <> 'maintenance' THEN RAISE EXCEPTION 'Asset is not in maintenance'; END IF;
  UPDATE public.assets SET status='active', updated_at=now() WHERE id=p_asset_id;
  INSERT INTO public.asset_history(asset_id,action,field_name,old_value,new_value,changed_by)
    VALUES(p_asset_id,'status_changed','Status','maintenance','active',auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.return_asset_to_service(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.return_asset_to_service(uuid) TO authenticated;
