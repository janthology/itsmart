/**
 * Dashboard statistics, staff workload, and ticket trend series.
 * Part of the Supabase data layer (split from supabase-queries.ts in Phase 4).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabase';
import type { DashboardStats } from '../api-types';
import { mapTicket, useHasSession, fetchAllRows } from './shared';
import { TICKET_SELECT } from './tickets';

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

export function useGetDashboardStats() {
  const { data: authed } = useHasSession();
  return useQuery<DashboardStats>({
    queryKey: ['dashboardStats'],
    enabled: !!authed,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const role = user?.app_metadata?.role ?? 'general_user';
      const userId = user?.id;

      // All dashboard numbers come from exact head-count queries — no
      // ticket/asset rows are downloaded just to count them in memory, so
      // the dashboard stays fast as the tables grow. Scoping by role
      // matches what each role's cards show:
      //  - administrator: organization-wide
      //  - support_staff: tickets assigned to them OR submitted by them
      //    (same union as the Tickets page), assets organization-wide
      //  - general_user: only tickets they submitted
      const applyTicketScope = (q: any) => {
        if (role === 'support_staff' && userId) return q.or(`assigned_to.eq.${userId},created_by.eq.${userId}`);
        if (role === 'general_user' && userId) return q.eq('created_by', userId);
        return q;
      };
      const countTickets = async (extra?: (q: any) => any): Promise<number> => {
        let q = supabase.from('tickets').select('id', { count: 'exact', head: true });
        q = applyTicketScope(q);
        if (extra) q = extra(q);
        const { count, error } = await q;
        if (error) throw error;
        return count ?? 0;
      };
      // Unscoped ticket count (used for support's organization-wide open card).
      const countAllTickets = async (extra?: (q: any) => any): Promise<number> => {
        let q = supabase.from('tickets').select('id', { count: 'exact', head: true });
        if (extra) q = extra(q);
        const { count, error } = await q;
        if (error) throw error;
        return count ?? 0;
      };
      const countAssets = async (extra?: (q: any) => any): Promise<number> => {
        let q = supabase.from('assets').select('id', { count: 'exact', head: true });
        if (extra) q = extra(q);
        const { count, error } = await q;
        if (error) throw error;
        return count ?? 0;
      };

      let recentQ = supabase.from('tickets').select(TICKET_SELECT)
        .order('last_activity_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(5);
      recentQ = applyTicketScope(recentQ);

      const [
        totalTickets,
        openTickets,
        inProgressTickets,
        resolvedNow,
        closedAfterResolved,
        closedTickets,
        resolvedClosedTickets,
        recentTicketsRes,
      ] = await Promise.all([
        countTickets(),
        countTickets(q => q.eq('status', 'open')),
        countTickets(q => q.eq('status', 'in_progress')),
        countTickets(q => q.eq('status', 'resolved')),
        countTickets(q => q.eq('status', 'closed').not('resolved_at', 'is', null)),
        countTickets(q => q.eq('status', 'closed')),
        countTickets(q => q.in('status', ['resolved', 'closed'])),
        recentQ,
      ]);
      if (recentTicketsRes.error) throw recentTicketsRes.error;

      // Lifecycle count: a ticket closed after being resolved counts as
      // Resolved as well as Closed; resolvedClosedTickets is the
      // de-duplicated union used by the combined card.
      const resolvedTickets = resolvedNow + closedAfterResolved;

      // Organization-wide open ticket count. Support staff's scoped counts
      // above cover their assigned-or-submitted union, but their dashboard
      // "Open tickets" card covers the whole queue — and their RLS role can
      // already read every ticket, so count directly.
      let allOpenTickets = openTickets;
      if (role === 'support_staff') {
        allOpenTickets = await countAllTickets(q => q.eq('status', 'open'));
      }

      // Asset counts — admin and support staff get org-wide; general users
      // only get their personal assigned count below.
      let totalAssets = 0;
      let availableAssets = 0;
      let assignedAssets = 0;
      let inactiveAssets = 0;
      let inMaintenanceAssets = 0;
      let retiredAssets = 0;
      let userCount = 0;
      if (role === 'administrator' || role === 'support_staff') {
        const [total, active, assigned, inactive, maintenance, retired, users] = await Promise.all([
          countAssets(),
          countAssets(q => q.eq('status', 'active')),
          countAssets(q => q.not('assigned_to', 'is', null)),
          countAssets(q => q.eq('status', 'inactive')),
          countAssets(q => q.eq('status', 'maintenance')),
          countAssets(q => q.eq('status', 'retired')),
          supabase.from('profiles').select('id', { count: 'exact', head: true }),
        ]);
        totalAssets = total;
        availableAssets = active;
        assignedAssets = assigned;
        inactiveAssets = inactive;
        inMaintenanceAssets = maintenance;
        retiredAssets = retired;
        if (users.error) throw users.error;
        userCount = users.count ?? 0;
      }

      // Personal assigned asset count for all roles ("Assets Assigned to Me").
      let myAssignedAssets = 0;
      if (userId) {
        myAssignedAssets = await countAssets(q => q.eq('assigned_to', userId));
      }

      return {
        totalAssets,
        availableAssets,
        assignedAssets,
        inactiveAssets,
        inMaintenanceAssets,
        retiredAssets,
        openTickets,
        inProgressTickets,
        resolvedTickets,
        closedTickets,
        resolvedClosedTickets,
        totalTickets,
        allTickets: totalTickets,  // alias used by admin "All Tickets" card
        allOpenTickets,  // organization-wide open count (support "Open tickets" card)
        myAssignedAssets,
        totalUsers: userCount,
        recentTickets: (recentTicketsRes.data ?? []).map(mapTicket),
        recentAssets: [],
      };
    },
  });
}

// ─── SUPPORT STAFF WORKLOAD ───────────────────────────────────────────────────

export interface StaffWorkload {
  id: string;
  fullName: string;
  openCount: number;
  inProgressCount: number;
  onHoldCount: number;
  totalActive: number;
}

export function useGetStaffWorkload() {
  const { data: authed } = useHasSession();
  return useQuery<StaffWorkload[]>({
    queryKey: ['staffWorkload'],
    enabled: !!authed,
    queryFn: async () => {
      const [staffRes, ticketsRes] = await Promise.all([
        // Assignable staff = active support staff AND administrators (both
        // can be ticket assignees); deactivated accounts are excluded.
        supabase.from('profiles').select('id, full_name')
          .in('role', ['support_staff', 'administrator'])
          .eq('is_active', true)
          .order('full_name'),
        fetchAllRows<any>(() =>
          supabase.from('tickets').select('assigned_to, status').in('status', ['open', 'in_progress', 'on_hold']).order('id')
        ),
      ]);
      if (staffRes.error) throw staffRes.error;
      const tickets = ticketsRes;
      return (staffRes.data ?? [])
        .map((s: any) => {
          const mine = tickets.filter((t: any) => t.assigned_to === s.id);
          return {
            id: s.id,
            fullName: s.full_name,
            openCount: mine.filter((t: any) => t.status === 'open').length,
            inProgressCount: mine.filter((t: any) => t.status === 'in_progress').length,
            onHoldCount: mine.filter((t: any) => t.status === 'on_hold').length,
            totalActive: mine.length,
          };
        })
        // Busiest first so the panel reads as a workload ranking.
        .sort((a, b) => b.totalActive - a.totalActive || a.fullName.localeCompare(b.fullName));
    },
  });
}

// ─── TICKET TREND ─────────────────────────────────────────────────────────────

export interface TicketTrendPoint {
  week: string;   // e.g. "Mar 10"
  opened: number;
  resolved: number;
}

export function useGetTicketTrend(weeks = 8) {
  const { data: authed } = useHasSession();
  return useQuery<TicketTrendPoint[]>({
    queryKey: ['ticketTrend', weeks],
    enabled: !!authed,
    queryFn: async () => {
      // Build week buckets (Mon–Sun) first, ending with the current week, and
      // query exactly from the first bucket's start so no fetched event can
      // fall outside every bucket.
      const startOfWeek = (date: Date) => {
        const d = new Date(date);
        const day = d.getDay();
        d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
        d.setHours(0, 0, 0, 0);
        return d;
      };
      const currentWeekStart = startOfWeek(new Date());
      const buckets: { label: string; start: Date; end: Date }[] = [];
      for (let i = weeks - 1; i >= 0; i--) {
        const start = new Date(currentWeekStart);
        start.setDate(start.getDate() - i * 7);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        buckets.push({ label: `${start.toLocaleString('default', { month: 'short' })} ${start.getDate()}`, start, end });
      }

      const since = buckets[0].start;
      const [openedRows, resolvedRows] = await Promise.all([
        fetchAllRows<{ created_at: string }>(() =>
          supabase.from('tickets').select('created_at').gte('created_at', since.toISOString()).order('created_at').order('id')
        ),
        fetchAllRows<{ resolved_at: string | null }>(() =>
          supabase.from('tickets').select('resolved_at').not('resolved_at', 'is', null).gte('resolved_at', since.toISOString()).order('resolved_at').order('id')
        ),
      ]);

      return buckets.map(({ label, start, end }) => ({
        week: label,
        opened: openedRows.filter(t => {
          const d = new Date(t.created_at);
          return d >= start && d <= end;
        }).length,
        resolved: resolvedRows.filter(t => {
          const d = new Date(t.resolved_at!);
          return d >= start && d <= end;
        }).length,
      }));
    },
  });
}
