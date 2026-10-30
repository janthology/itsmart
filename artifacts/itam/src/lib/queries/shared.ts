/**
 * Shared building blocks for the data layer: enums, row mappers,
 * session gate, lifecycle helpers, and the chunked full-table fetcher.
 * Part of the Supabase data layer (split from supabase-queries.ts in Phase 4).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabase';
import type { Asset, Ticket, UserProfile } from '../api-types';

// ─── Enums (defined locally so they're always value exports) ─────────────────

export const AssetStatus = {
  active: 'active',
  inactive: 'inactive',
  maintenance: 'maintenance',
  retired: 'retired',
} as const;
export type AssetStatus = (typeof AssetStatus)[keyof typeof AssetStatus];

export const AssetCategory = {
  laptop: 'laptop', desktop: 'desktop', monitor: 'monitor', phone: 'phone',
  tablet: 'tablet', printer: 'printer', server: 'server', networking: 'networking',
  peripheral: 'peripheral', other: 'other',
} as const;
export type AssetCategory = (typeof AssetCategory)[keyof typeof AssetCategory];

export const TicketStatus = {
  open: 'open', in_progress: 'in_progress', on_hold: 'on_hold',
  resolved: 'resolved', closed: 'closed',
} as const;
export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

export const TicketPriority = {
  low: 'low', medium: 'medium', high: 'high', critical: 'critical',
} as const;
export type TicketPriority = (typeof TicketPriority)[keyof typeof TicketPriority];

export const TicketType = {
  hardware_issue: 'hardware_issue',
  software_issue: 'software_issue',
  network_issue: 'network_issue',
  account_access: 'account_access',
  other: 'other',
} as const;
export type TicketType = (typeof TicketType)[keyof typeof TicketType];

export const TICKET_TYPE_LABEL: Record<string, string> = {
  hardware_issue: 'Hardware Issue',
  software_issue: 'Software Issue',
  network_issue: 'Network Issue',
  account_access: 'Account / Access',
  other: 'Other',
};

export const UserRole = {
  general_user: 'general_user', support_staff: 'support_staff', administrator: 'administrator',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

// ─── Mappers ─────────────────────────────────────────────────────────────────

export function mapUser(u: any): UserProfile & { isActive?: boolean; lastSignInAt?: string | null } {
  return {
    id: u.id,
    email: u.email ?? '',
    fullName: u.full_name ?? '',
    role: u.role,
    department: u.department ?? null,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
    isActive: u.is_active ?? true,
    lastSignInAt: u.last_sign_in_at ?? null,
  };
}

export function mapAsset(a: any): Asset & { serialNumber?: string | null; location?: string | null; model?: string | null; purchaseValue?: number | null; lastPmDate?: string | null; nextPmDate?: string | null } {
  return {
    id: a.id,
    assetTag: a.asset_tag,
    name: a.name,
    category: a.category,
    status: a.status,
    assignedTo: a.assigned_to_profile ? mapUser(a.assigned_to_profile) : null,
    purchaseDate: a.purchase_date ?? null,
    notes: a.notes ?? null,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
    serialNumber: a.serial_number ?? null,
    location: a.location ?? null,
    model: a.model ?? null,
    purchaseValue: a.purchase_value ?? null,
    lastPmDate: a.last_pm_date ?? null,
    nextPmDate: a.next_pm_date ?? null,
  };
}

export function mapTicket(t: any): Ticket & { ticketNumber?: string; resolvedAt?: string | null; lastActivityAt?: string | null; type?: string; satisfactionRating?: number | null; satisfactionComment?: string | null; totalHoldSeconds?: number; onHoldAt?: string | null } {
  return {
    id: t.id,
    ticketNumber: t.ticket_number ?? null,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    type: t.type ?? 'other',
    asset: t.asset ? mapAsset(t.asset) : null,
    createdBy: t.created_by_profile ? mapUser(t.created_by_profile) : { id: '', email: '', fullName: 'Unknown', role: 'general_user', createdAt: '', updatedAt: '' },
    assignedTo: t.assigned_to_profile ? mapUser(t.assigned_to_profile) : null,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    closedAt: t.closed_at ?? null,
    resolvedAt: t.resolved_at ?? null,
    lastActivityAt: t.last_activity_at ?? t.updated_at ?? t.resolved_at ?? t.created_at ?? null,
    satisfactionRating: t.satisfaction_rating ?? null,
    satisfactionComment: t.satisfaction_comment ?? null,
    totalHoldSeconds: t.total_hold_seconds ?? 0,
    onHoldAt: t.on_hold_at ?? null,
  };
}

/** Resolved tickets auto-close after this many days without activity. */
export const RESOLVED_TICKET_AUTO_CLOSE_DAYS = 7;

/**
 * When a resolved ticket will auto-close: 7 days after its last activity
 * (ticket update or comment). Returns null for non-resolved tickets. The
 * database job uses the same rule, based on last_activity_at.
 */
export function getResolvedTicketAutoCloseAt(ticket: {
  status?: string;
  resolvedAt?: string | null;
  lastActivityAt?: string | null;
  updatedAt?: string | null;
}): Date | null {
  if (ticket.status !== 'resolved') return null;
  const base = ticket.lastActivityAt ?? ticket.updatedAt ?? ticket.resolvedAt;
  if (!base) return null;
  const baseDate = new Date(base);
  if (Number.isNaN(baseDate.getTime())) return null;
  return new Date(baseDate.getTime() + RESOLVED_TICKET_AUTO_CLOSE_DAYS * 24 * 60 * 60 * 1000);
}

// ─── Session gate ─────────────────────────────────────────────────────────────

export function useHasSession() {
  return useQuery<boolean>({
    queryKey: ['session'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      return !!session;
    },
    staleTime: Infinity,
  });
}

/**
 * Fetches every row matching a query by paging through in 1,000-row
 * chunks. A single PostgREST response is silently capped at 1,000 rows,
 * so unbounded selects lose data without any error once a table grows
 * past that. The query MUST include a deterministic .order() (with an
 * id tiebreak) so pages never overlap or skip rows.
 */
export async function fetchAllRows<T>(buildQuery: () => any): Promise<T[]> {
  const rows: T[] = [];
  const CHUNK = 1000;
  for (let start = 0; ; start += CHUNK) {
    const { data, error } = await buildQuery().range(start, start + CHUNK - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < CHUNK) break;
  }
  return rows;
}
