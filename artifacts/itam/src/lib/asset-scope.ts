/**
 * Visibility rule for the asset list (decision 2026-11-24, migration 20261124064640):
 * administrators and support staff see all assets. General users see only the assets
 * assigned to them, so the "All assets" views are not offered to them.
 */
export function canViewAllAssets(role: string | null | undefined): boolean {
  return role === "administrator" || role === "support_staff";
}
