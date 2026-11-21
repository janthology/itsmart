-- Reviewed rollback for migration 20261101000024 (trusted password gate, Phase 1).
--
-- Safe only if NO Phase 2 handler calls these functions, and no row is in
-- 'resetting' or 'changing'. Check first:
--   SELECT phase, count(*) FROM public.password_gate_state GROUP BY phase;
-- If any row is 'resetting' or 'changing', stop: an in-progress operation has
-- an Auth outcome that is unknown. Resolve it under a separate recovery
-- procedure before dropping anything.
--
-- Drops only the objects that migration 20261101000024 created. It does not
-- touch profiles, Auth users, sessions, policies or any other migration's
-- objects. Dropping the tables deletes gate state and admitted-session rows.
-- That is acceptable only after the check above.

DROP FUNCTION IF EXISTS public.password_gate_admit_session(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.password_gate_finish_change(uuid, uuid);
DROP FUNCTION IF EXISTS public.password_gate_cancel_unattempted_change(uuid, uuid);
DROP FUNCTION IF EXISTS public.password_gate_begin_change(uuid, uuid);
DROP FUNCTION IF EXISTS public.password_gate_finish_reset(uuid, uuid);
DROP FUNCTION IF EXISTS public.password_gate_begin_reset(uuid, uuid);
DROP TABLE IF EXISTS public.password_gate_admitted_sessions;
DROP TABLE IF EXISTS public.password_gate_state;
