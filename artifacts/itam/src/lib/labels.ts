/**
 * Shared display labels for statuses, priorities, and roles.
 *
 * These maps used to be copied into individual pages (tickets list,
 * ticket detail, reports, nav, welcome banner) — identical text in five
 * places that could quietly drift apart. Import from here instead.
 */

export const TICKET_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  on_hold: "On Hold",
  resolved: "Resolved",
  closed: "Closed",
};

export const TICKET_PRIORITY_LABEL: Record<string, string> = {
  critical: "Critical - 1",
  high: "High - 2",
  medium: "Medium - 3",
  low: "Low - 4",
};

export const ASSET_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  maintenance: "Maintenance",
  retired: "Retired",
};

export const ROLE_LABEL: Record<string, string> = {
  administrator: "Administrator",
  support_staff: "Support Staff",
  general_user: "General User",
};

/** "support_staff" -> "Support Staff" (fallback for unknown values). */
export function humanizeLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? humanizeLabel(role);
}
