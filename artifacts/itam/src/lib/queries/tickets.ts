/**
 * Tickets: paged/searchable list, summary counts, detail, mutations, comments, satisfaction.
 * Part of the Supabase data layer (split from supabase-queries.ts in Phase 4).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import type {
  Ticket, TicketListResponse, TicketWithComments,
  CreateTicketRequest, UpdateTicketRequest, CreateCommentRequest,
} from '../api-types';
import {
  TicketStatus, TicketPriority,
  mapTicket, mapUser, useHasSession,
} from './shared';

// ─── TICKETS ─────────────────────────────────────────────────────────────────

export const TICKET_SELECT = `
  *,
  created_by_profile:profiles!tickets_created_by_fkey(*),
  assigned_to_profile:profiles!tickets_assigned_to_fkey(*),
  asset:assets(*, assigned_to_profile:profiles!assets_assigned_to_fkey(*))
`;

export interface TicketQueryFilters {
  search?: string;
  status?: TicketStatus;
  /** Lifecycle filters spanning statuses: "resolved" = resolved now + closed-after-resolved; "resolved_closed" = either. */
  lifecycle?: 'resolved' | 'resolved_closed';
  priority?: TicketPriority;
  createdBy?: string;
  assignedTo?: string;
  relatedTo?: string;
  unassigned?: boolean;
  page?: number;
  pageSize?: number;
}

export function useGetTickets(opts?: { query?: TicketQueryFilters; enabled?: boolean }) {
  const query = opts?.query;
  const search = query?.search;
  const status = query?.status;
  const lifecycle = query?.lifecycle;
  const priority = query?.priority;
  const createdBy = query?.createdBy;
  const assignedTo = query?.assignedTo;
  const relatedTo = query?.relatedTo;
  const unassigned = query?.unassigned;
  const page = query?.page;
  const pageSize = query?.pageSize;
  const { data: authed } = useHasSession();

  return useQuery<TicketListResponse>({
    queryKey: ['tickets', search, status, lifecycle, priority, createdBy, assignedTo, relatedTo, unassigned, page, pageSize],
    enabled: !!authed && (opts?.enabled ?? true),
    queryFn: async () => {
      // Server-side search: match title / ticket number directly, and
      // requester names via a profile lookup (embedded profile columns
      // cannot be filtered reliably through PostgREST).
      let requesterIds: string[] = [];
      if (search) {
        const likeSafe = search.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id')
          .ilike('full_name', `%${likeSafe}%`)
          .limit(25);
        requesterIds = (profiles ?? []).map((p: { id: string }) => p.id);
      }

      const buildQuery = () => {
        let q = supabase
          .from('tickets')
          .select(TICKET_SELECT, page && pageSize ? { count: 'exact' } : undefined)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false });

        if (lifecycle === 'resolved') {
          // Resolved now, plus closed tickets that were resolved first.
          q = q.or('status.eq.resolved,and(status.eq.closed,resolved_at.not.is.null)');
        } else if (lifecycle === 'resolved_closed') {
          q = q.in('status', ['resolved', 'closed']);
        } else if (status) {
          q = q.eq('status', status);
        }
        if (priority) q = q.eq('priority', priority);
        if (relatedTo) {
          // Personal queue: tickets assigned to the user OR submitted by them.
          q = q.or(`assigned_to.eq.${relatedTo},created_by.eq.${relatedTo}`);
        } else {
          if (createdBy) q = q.eq('created_by', createdBy);
          if (assignedTo) q = q.eq('assigned_to', assignedTo);
        }
        if (unassigned) q = q.is('assigned_to', null);

        if (search) {
          const orSafe = search
            .replace(/\\/g, '\\\\')
            .replace(/%/g, '\\%')
            .replace(/_/g, '\\_')
            .replace(/[,()"]/g, ' ');
          const clauses = [
            `title.ilike.%${orSafe}%`,
            `ticket_number.ilike.%${orSafe}%`,
          ];
          if (requesterIds.length) {
            clauses.push(`created_by.in.(${requesterIds.join(',')})`);
          }
          q = q.or(clauses.join(','));
        }
        return q;
      };

      // Paginated mode: one page plus the real total from PostgREST.
      if (page && pageSize) {
        const start = (page - 1) * pageSize;
        const { data, error, count } = await buildQuery().range(start, start + pageSize - 1);
        if (error) throw error;
        const tickets = (data ?? []).map(mapTicket);
        return { data: tickets, total: count ?? tickets.length, page, limit: pageSize };
      }

      // Full-fetch mode (calendar, reports, pickers): page through in
      // 1,000-row chunks — a single PostgREST response is silently capped
      // at 1,000 rows, which used to truncate these lists without error.
      const rows: any[] = [];
      const CHUNK = 1000;
      for (let start = 0; ; start += CHUNK) {
        const { data, error } = await buildQuery().range(start, start + CHUNK - 1);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < CHUNK) break;
      }
      const tickets = rows.map(mapTicket);
      return { data: tickets, total: tickets.length, page: 1, limit: tickets.length };
    },
  });
}

export interface TicketSummaryCounts {
  total: number;
  open: number;
  inProgress: number;
  onHold: number;
  /** Resolved now + closed-after-resolved (lifecycle count). */
  resolved: number;
  closed: number;
  /** Closed tickets that passed through Resolved first. */
  resolvedBeforeClosed: number;
  /** De-duplicated union of resolved-lifecycle and closed. */
  resolvedClosed: number;
}

/**
 * Queue counts for the Tickets page summary strip, computed with exact
 * head-count queries instead of downloading every matching ticket row.
 */
export function useGetTicketSummary(opts?: {
  query?: Pick<TicketQueryFilters, 'assignedTo' | 'createdBy' | 'relatedTo' | 'unassigned'>;
}) {
  const query = opts?.query;
  const assignedTo = query?.assignedTo;
  const createdBy = query?.createdBy;
  const relatedTo = query?.relatedTo;
  const unassigned = query?.unassigned;
  const { data: authed } = useHasSession();

  return useQuery<TicketSummaryCounts>({
    queryKey: ['ticketSummary', assignedTo, createdBy, relatedTo, unassigned],
    enabled: !!authed,
    queryFn: async () => {
      const applyScope = (q: any) => {
        if (relatedTo) {
          q = q.or(`assigned_to.eq.${relatedTo},created_by.eq.${relatedTo}`);
        } else {
          if (createdBy) q = q.eq('created_by', createdBy);
          if (assignedTo) q = q.eq('assigned_to', assignedTo);
        }
        if (unassigned) q = q.is('assigned_to', null);
        return q;
      };
      const countWith = async (extra?: (q: any) => any): Promise<number> => {
        let q = supabase.from('tickets').select('id', { count: 'exact', head: true });
        q = applyScope(q);
        if (extra) q = extra(q);
        const { count, error } = await q;
        if (error) throw error;
        return count ?? 0;
      };

      const [total, open, inProgress, onHold, resolvedNow, closedAfterResolved, closed, resolvedUnion] =
        await Promise.all([
          countWith(),
          countWith(q => q.eq('status', 'open')),
          countWith(q => q.eq('status', 'in_progress')),
          countWith(q => q.eq('status', 'on_hold')),
          countWith(q => q.eq('status', 'resolved')),
          countWith(q => q.eq('status', 'closed').not('resolved_at', 'is', null)),
          countWith(q => q.eq('status', 'closed')),
          countWith(q => q.in('status', ['resolved', 'closed'])),
        ]);

      return {
        total,
        open,
        inProgress,
        onHold,
        resolved: resolvedNow + closedAfterResolved,
        closed,
        resolvedBeforeClosed: closedAfterResolved,
        resolvedClosed: resolvedUnion,
      };
    },
  });
}

export function useGetTicket(id: string) {
  const { data: authed } = useHasSession();
  return useQuery<TicketWithComments>({
    queryKey: ['ticket', id],
    enabled: !!authed && !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tickets')
        .select(`
          ${TICKET_SELECT},
          comments:ticket_comments(*, created_by_profile:profiles!ticket_comments_created_by_fkey(*))
        `)
        .eq('id', id)
        .single();
      if (error) throw error;
      const ticket = mapTicket(data);
      const comments = (data.comments ?? []).map((c: any) => ({
        id: c.id,
        ticketId: c.ticket_id,
        commentText: c.comment_text,
        // System entries (e.g. auto-close remarks) have no human author.
        isSystem: c.is_system ?? !c.created_by_profile,
        createdBy: c.created_by_profile
          ? mapUser(c.created_by_profile)
          : { id: 'system', email: '', fullName: 'System', role: 'general_user' as const, createdAt: c.created_at, updatedAt: c.created_at, isActive: true, lastSignInAt: null },
        createdAt: c.created_at,
      }));
      return { ...ticket, comments };
    },
  });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ data }: { data: CreateTicketRequest & { type?: string } }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data: row, error } = await supabase.from('tickets').insert({
        title: data.title,
        description: data.description,
        priority: data.priority,
        type: (data as any).type ?? 'other',
        asset_id: data.assetId ?? null,
        created_by: user.id,
        status: 'open',
      }).select().single();
      if (error) throw error;
      return row;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['ticketSummary'] });
      qc.invalidateQueries({ queryKey: ['dashboardStats'] });
    },
  });
}

export function useUpdateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateTicketRequest & { type?: string } }) => {
      const updates: any = { updated_at: new Date().toISOString() };
      if (data.status !== undefined) updates.status = data.status;
      if (data.priority !== undefined) updates.priority = data.priority;
      if ((data as any).type !== undefined) updates.type = (data as any).type;
      if (data.title !== undefined) updates.title = data.title;
      if (data.description !== undefined) updates.description = data.description;
      if ('assignedToId' in data) updates.assigned_to = data.assignedToId ?? null;
      if (data.status === 'closed') {
        // Closing a ticket must never clear its assignee — the assignment is
        // part of the ticket's handling record. Ignore any assignee change
        // bundled with a close transition.
        delete updates.assigned_to;
      }

      // SLA hold tracking
      if (data.status === 'on_hold') {
        // Record when hold started
        updates.on_hold_at = new Date().toISOString();
      } else if (data.status && (data.status as string) !== 'on_hold') {
        // Coming off hold — accumulate hold duration
        const { data: current } = await supabase
          .from('tickets').select('on_hold_at, total_hold_seconds').eq('id', id).single();
        if (current?.on_hold_at) {
          const holdSecs = Math.floor((Date.now() - new Date(current.on_hold_at).getTime()) / 1000);
          updates.total_hold_seconds = (current.total_hold_seconds ?? 0) + holdSecs;
          updates.on_hold_at = null;
        }
      }

      if (data.status === 'resolved') {
        updates.resolved_at = new Date().toISOString();
        updates.closed_at = null;
      }
      if (data.status === 'closed') {
        updates.closed_at = new Date().toISOString();
        // resolved_at is intentionally retained: it records that the ticket
        // was resolved before closing. A closed ticket without resolved_at
        // was closed directly (duplicate, created by mistake, etc.).
      }
      if (data.status === 'open' || data.status === 'in_progress' || data.status === 'on_hold') {
        if (data.status !== 'on_hold') updates.resolved_at = null;
      }
      const { error } = await supabase.from('tickets').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['ticketSummary'] });
      qc.invalidateQueries({ queryKey: ['ticket', id] });
      qc.invalidateQueries({ queryKey: ['dashboardStats'] });
      qc.invalidateQueries({ queryKey: ['staffWorkload'] });
    },
  });
}

export function useAddTicketComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: CreateCommentRequest }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('ticket_comments').insert({
        ticket_id: id,
        comment_text: data.commentText,
        created_by: user.id,
      });
      if (error) throw error;
    },
    // A comment is ticket activity: refresh the ticket (including its
    // last-activity / auto-close timing) and the ticket list.
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ['ticket', id] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['ticketSummary'] });
    },
  });
}

// ─── TICKET SATISFACTION ─────────────────────────────────────────────────────

export function useSubmitSatisfactionRating() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, rating, comment }: { id: string; rating: number; comment?: string }) => {
      const { error } = await supabase
        .from('tickets')
        .update({ satisfaction_rating: rating, satisfaction_comment: comment ?? null })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ['ticket', id] });
      qc.invalidateQueries({ queryKey: ['dashboardStats'] });
    },
  });
}
