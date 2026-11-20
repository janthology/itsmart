-- RESEARCH ONLY; not a migration. Requires operations.sql. An inserted profile
-- starts fail-closed in required state in the SAME transaction as its insert;
-- it cannot use application data merely because Auth account creation succeeded.
-- Existing profiles are not initialized by this trigger. Admin bootstrap,
-- service/cron behavior, rollback and compatibility with actual Auth triggers
-- require separate design and live integration tests. Never apply to production.
CREATE FUNCTION public.prototype_initialize_profile_gate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  INSERT INTO public.password_operation_prototype(user_id,phase,operation_id)
    VALUES (NEW.id,'required',gen_random_uuid());
  UPDATE public.profiles SET must_change_password=true WHERE id=NEW.id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.prototype_initialize_profile_gate() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER prototype_initialize_profile_gate AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prototype_initialize_profile_gate();
