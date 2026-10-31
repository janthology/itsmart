import { supabase } from "./supabase";

/**
 * Best-effort admin audit logging (Phase 5c).
 *
 * Fire-and-forget: failures are swallowed so logging can never block
 * or break the underlying admin action. Rows land in
 * public.admin_audit_log, readable by administrators only (RLS).
 */
export function logAdminAction(
  action: string,
  targetType: string,
  targetId?: string | null,
  details?: Record<string, unknown>,
): void {
  void (async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("admin_audit_log").insert({
        actor_id: user.id,
        action,
        target_type: targetType,
        target_id: targetId ?? null,
        details: details ?? {},
      });
    } catch {
      // Best-effort by design — never surface logging failures.
    }
  })();
}
