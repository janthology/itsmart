/**
 * Supabase data layer — replaces @workspace/api-client-react hooks.
 * FK constraint names match the actual schema:
 *   assets_assigned_to_fkey
 *   tickets_created_by_fkey
 *   tickets_assigned_to_fkey
 *   ticket_comments_created_by_fkey
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import type {
  Asset, AssetListResponse,
  Ticket, TicketWithComments, TicketListResponse,
  UserProfile,
  DashboardStats,
  CreateAssetRequest, UpdateAssetRequest,
  CreateTicketRequest, UpdateTicketRequest,
  CreateCommentRequest,
  UpdateUserRequest, UpdateProfileRequest,
} from '@workspace/api-client-react';

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

function mapUser(u: any): UserProfile & { isActive?: boolean; lastSignInAt?: string | null } {
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

function mapAsset(a: any): Asset & { serialNumber?: string | null; location?: string | null; model?: string | null; purchaseValue?: number | null; lastPmDate?: string | null; nextPmDate?: string | null } {
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

function mapTicket(t: any): Ticket & { ticketNumber?: string; resolvedAt?: string | null; lastActivityAt?: string | null; type?: string; satisfactionRating?: number | null; satisfactionComment?: string | null; totalHoldSeconds?: number; onHoldAt?: string | null } {
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

function useHasSession() {
  return useQuery<boolean>({
    queryKey: ['session'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      return !!session;
    },
    staleTime: Infinity,
  });
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────

export async function fetchCurrentUser(): Promise<UserProfile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    if (error || !data) {
      return { id: user.id, email: user.email ?? '', fullName: user.email ?? '', role: 'general_user', department: null, createdAt: '', updatedAt: '' };
    }
    return {
      id: data.id,
      email: user.email ?? '',
      fullName: data.full_name ?? user.email ?? '',
      role: data.role ?? 'general_user',
      department: data.department ?? null,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  } catch {
    return { id: user.id, email: user.email ?? '', fullName: user.email ?? '', role: 'general_user', department: null, createdAt: '', updatedAt: '' };
  }
}

export function useGetCurrentUser() {
  return useQuery<UserProfile | null>({
    queryKey: ['currentUser'],
    queryFn: fetchCurrentUser,
    retry: false,
  });
}

// ─── ASSETS ──────────────────────────────────────────────────────────────────

const ASSET_SELECT = '*, assigned_to_profile:profiles!assets_assigned_to_fkey(*)';

export function useGetAssets(opts?: { query?: { search?: string; status?: AssetStatus; category?: AssetCategory; assignedTo?: string } }) {
  const search = opts?.query?.search;
  const status = opts?.query?.status;
  const category = opts?.query?.category;
  const assignedTo = opts?.query?.assignedTo;
  const { data: authed } = useHasSession();

  return useQuery<AssetListResponse>({
    queryKey: ['assets', search, status, category, assignedTo],
    enabled: !!authed,
    queryFn: async () => {
      let q = supabase.from('assets').select(ASSET_SELECT).order('created_at', { ascending: false });
      // Only apply server-side text filter when NOT searching (search is handled client-side
      // so category enum can be included in the match)
      // Always apply non-text filters server-side
      if (status) q = q.eq('status', status);
      if (assignedTo) q = q.eq('assigned_to', assignedTo);
      // Category is applied server-side when there's no search term; when
      // searching, it's re-applied client-side after the text filter so that
      // both conditions are respected together.
      if (!search && category) q = q.eq('category', category);

      const { data, error } = await q;
      if (error) throw error;
      let assets = (data ?? []).map(mapAsset);
      // Client-side search across name, tag, and category
      if (search) {
        const term = search.toLowerCase();
        assets = assets.filter(a =>
          a.name.toLowerCase().includes(term) ||
          a.assetTag.toLowerCase().includes(term) ||
          a.category.toLowerCase().includes(term)
        );
        // Re-apply category filter when search is also active
        if (category) assets = assets.filter(a => a.category === category);
      }
      return { data: assets, total: assets.length, page: 1, limit: 100 };
    },
  });
}

export function useGetAsset(id: string) {
  const { data: authed } = useHasSession();
  return useQuery<Asset>({
    queryKey: ['asset', id],
    enabled: !!authed && !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets').select(ASSET_SELECT).eq('id', id).single();
      if (error) throw error;
      return mapAsset(data);
    },
  });
}

export function useCreateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ data }: { data: CreateAssetRequest & { serialNumber?: string; location?: string; model?: string; purchaseValue?: number; lastPmDate?: string; nextPmDate?: string } }) => {
      const { data: row, error } = await supabase.from('assets').insert({
        asset_tag: data.assetTag,
        name: data.name,
        category: data.category,
        status: data.status,
        assigned_to: data.assignedToId ?? null,
        purchase_date: data.purchaseDate || null,
        purchase_value: (data as any).purchaseValue ?? null,
        notes: data.notes ?? null,
        serial_number: (data as any).serialNumber ?? null,
        location: (data as any).location ?? null,
        model: (data as any).model ?? null,
        last_pm_date: (data as any).lastPmDate || null,
        next_pm_date: (data as any).nextPmDate || null,
      }).select().single();
      if (error) throw error;
      return row;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assets'] }),
  });
}

export function useUpdateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateAssetRequest & { serialNumber?: string; location?: string; model?: string; purchaseValue?: number; lastPmDate?: string; nextPmDate?: string } }) => {
      const updates: any = { updated_at: new Date().toISOString() };
      if (data.name !== undefined) updates.name = data.name;
      if (data.category !== undefined) updates.category = data.category;
      if (data.status !== undefined) updates.status = data.status;
      if (data.notes !== undefined) updates.notes = data.notes;
      if ('assignedToId' in data) updates.assigned_to = data.assignedToId ?? null;
      if (data.purchaseDate !== undefined) updates.purchase_date = data.purchaseDate;
      if ((data as any).purchaseValue !== undefined) updates.purchase_value = (data as any).purchaseValue;
      if ((data as any).serialNumber !== undefined) updates.serial_number = (data as any).serialNumber;
      if ((data as any).location !== undefined) updates.location = (data as any).location;
      if ((data as any).model !== undefined) updates.model = (data as any).model;
      if ((data as any).lastPmDate !== undefined) updates.last_pm_date = (data as any).lastPmDate || null;
      if ((data as any).nextPmDate !== undefined) updates.next_pm_date = (data as any).nextPmDate || null;
      const { error } = await supabase.from('assets').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ['assets'] });
      qc.invalidateQueries({ queryKey: ['asset', id] });
    },
  });
}

export function useDeleteAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { error } = await supabase.from('assets').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assets'] }),
  });
}

// ─── TICKETS ─────────────────────────────────────────────────────────────────

const TICKET_SELECT = `
  *,
  created_by_profile:profiles!tickets_created_by_fkey(*),
  assigned_to_profile:profiles!tickets_assigned_to_fkey(*),
  asset:assets(*, assigned_to_profile:profiles!assets_assigned_to_fkey(*))
`;

export function useGetTickets(opts?: { query?: { search?: string; status?: TicketStatus; priority?: TicketPriority; createdBy?: string; assignedTo?: string; relatedTo?: string } }) {
  const search = opts?.query?.search;
  const status = opts?.query?.status;
  const priority = opts?.query?.priority;
  const createdBy = opts?.query?.createdBy;
  const assignedTo = opts?.query?.assignedTo;
  const relatedTo = opts?.query?.relatedTo;
  const { data: authed } = useHasSession();

  return useQuery<TicketListResponse>({
    queryKey: ['tickets', search, status, priority, createdBy, assignedTo, relatedTo],
    enabled: !!authed,
    queryFn: async () => {
      let q = supabase.from('tickets').select(TICKET_SELECT).order('created_at', { ascending: false });
      // Server-side filters (search is handled client-side — filtering on joined
      // profile columns via .or() is unreliable in PostgREST with embedded selects)
      if (status) q = q.eq('status', status);
      if (priority) q = q.eq('priority', priority);
      if (relatedTo) {
        // Personal queue: tickets assigned to the user OR submitted by them.
        q = q.or(`assigned_to.eq.${relatedTo},created_by.eq.${relatedTo}`);
      } else {
        if (createdBy) q = q.eq('created_by', createdBy);
        if (assignedTo) q = q.eq('assigned_to', assignedTo);
      }
      const { data, error } = await q;
      if (error) throw error;
      let tickets = (data ?? []).map(mapTicket);
      // Client-side search: title, id prefix, or requester name
      if (search) {
        const term = search.toLowerCase();
        tickets = tickets.filter(t =>
          t.title.toLowerCase().includes(term) ||
          t.id.toLowerCase().startsWith(term) ||
          (t as any).ticketNumber?.toLowerCase().includes(term) ||
          t.createdBy.fullName.toLowerCase().includes(term)
        );
      }
      return { data: tickets, total: tickets.length, page: 1, limit: 100 };
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
    },
  });
}

// ─── USERS ───────────────────────────────────────────────────────────────────

export function useGetSupportStaff() {
  const { data: authed } = useHasSession();
  return useQuery<UserProfile[]>({
    queryKey: ['supportStaff'],
    enabled: !!authed,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'support_staff')
        .order('full_name', { ascending: true });
      if (error) throw error;
      return (data ?? []).map(mapUser);
    },
  });
}

export function useGetUsers(opts?: { query?: { search?: string } }) {
  const search = opts?.query?.search;
  const { data: authed } = useHasSession();
  return useQuery<UserProfile[]>({
    queryKey: ['users', search],
    enabled: !!authed,
    queryFn: async () => {
      // Query profiles directly — email comes from the view if available,
      // falls back to profiles-only if the view is inaccessible
      let data: any[] | null = null;
      let error: any = null;

      // Try the view first (includes email + last_sign_in_at)
      const viewResult = await supabase
        .from('profiles_with_email')
        .select('*')
        .order('created_at', { ascending: false });

      if (!viewResult.error) {
        data = viewResult.data;
      } else {
        // Fallback: query profiles directly (no email/last_sign_in)
        const profilesResult = await supabase
          .from('profiles')
          .select('*')
          .order('created_at', { ascending: false });
        if (profilesResult.error) throw profilesResult.error;
        data = profilesResult.data;
      }

      let users = (data ?? []).map(mapUser);
      if (search) {
        const term = search.toLowerCase();
        users = users.filter(u =>
          u.fullName.toLowerCase().includes(term) ||
          (u.email && u.email.toLowerCase().includes(term))
        );
      }
      return users;
    },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateUserRequest }) => {
      const updates: any = {};
      if (data.role !== undefined) updates.role = data.role;
      if (data.fullName !== undefined) updates.full_name = data.fullName;
      if (data.department !== undefined) updates.department = data.department;
      const { error } = await supabase.from('profiles').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useToggleUserActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase.from('profiles').update({ is_active: isActive }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateMyProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ data }: { data: UpdateProfileRequest }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const updates: any = {};
      if (data.fullName !== undefined) updates.full_name = data.fullName;
      if (data.department !== undefined) updates.department = data.department;
      // Update profiles table
      const { error } = await supabase.from('profiles').update(updates).eq('id', user.id);
      if (error) throw error;
      // Also update user_metadata so the JWT reflects the new name immediately
      await supabase.auth.updateUser({
        data: {
          full_name: data.fullName ?? user.user_metadata?.full_name,
          department: data.department ?? user.user_metadata?.department,
        }
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['currentUser'] }),
  });
}

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

      // Ticket queries scoped by role
      let ticketsQ = supabase.from('tickets').select('status, resolved_at');
      let recentQ = supabase.from('tickets').select(TICKET_SELECT)
        .order('last_activity_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(5);

      if (role === 'support_staff' && userId) {
        // Support "My tickets" scope: assigned to them OR submitted by them
        // (same union as the Tickets page grouping).
        ticketsQ = ticketsQ.or(`assigned_to.eq.${userId},created_by.eq.${userId}`);
        recentQ = recentQ.or(`assigned_to.eq.${userId},created_by.eq.${userId}`);
      } else if (role === 'general_user' && userId) {
        ticketsQ = ticketsQ.eq('created_by', userId);
        recentQ = recentQ.eq('created_by', userId);
      }

      const [ticketsRes, recentTicketsRes] = await Promise.all([ticketsQ, recentQ]);
      if (ticketsRes.error) throw ticketsRes.error;
      if (recentTicketsRes.error) throw recentTicketsRes.error;

      // Asset counts — admin and support staff get org-wide; support/general also get personal assigned count
      let assets: any[] = [];
      let userCount = 0;
      let myAssignedAssets = 0;

      if (role === 'administrator' || role === 'support_staff') {
        const [assetsRes, usersRes] = await Promise.all([
          supabase.from('assets').select('status, assigned_to'),
          supabase.from('profiles').select('id', { count: 'exact', head: true }),
        ]);
        if (assetsRes.error) throw assetsRes.error;
        assets = assetsRes.data ?? [];
        userCount = usersRes.count ?? 0;
      }

      // Personal assigned asset count for all non-admin roles (and admin too for "Assets Assigned to Me")
      if (userId) {
        const { count } = await supabase
          .from('assets').select('id', { count: 'exact', head: true })
          .eq('assigned_to', userId);
        myAssignedAssets = count ?? 0;
      }

      const tickets = ticketsRes.data ?? [];

      return {
        totalAssets: assets.length,
        availableAssets: assets.filter((a: any) => a.status === 'active').length,
        assignedAssets: assets.filter((a: any) => !!a.assigned_to).length,
        inactiveAssets: assets.filter((a: any) => a.status === 'inactive').length,
        inMaintenanceAssets: assets.filter((a: any) => a.status === 'maintenance').length,
        retiredAssets: assets.filter((a: any) => a.status === 'retired').length,
        openTickets: tickets.filter((t: any) => t.status === 'open').length,
        inProgressTickets: tickets.filter((t: any) => t.status === 'in_progress').length,
        // Lifecycle counts: a ticket closed after being resolved counts as
        // Resolved as well as Closed; resolvedClosedTickets stays the
        // de-duplicated union used by the combined card.
        resolvedTickets: tickets.filter(
          (t: any) => t.status === 'resolved' || (t.status === 'closed' && !!t.resolved_at)
        ).length,
        closedTickets: tickets.filter((t: any) => t.status === 'closed').length,
        resolvedClosedTickets: tickets.filter(
          (t: any) => t.status === 'resolved' || t.status === 'closed'
        ).length,
        totalTickets: tickets.length,
        allTickets: tickets.length,  // alias used by admin "All Tickets" card
        myAssignedAssets,
        totalUsers: userCount,
        recentTickets: (recentTicketsRes.data ?? []).map(mapTicket),
        recentAssets: [],
      };
    },
  });
}

// ─── Re-export types ──────────────────────────────────────────────────────────
export type { UserProfile, Asset, Ticket, TicketWithComments, DashboardStats };

// ─── ASSET HISTORY ────────────────────────────────────────────────────────────

export interface AssetHistoryEntry {
  id: string;
  assetId: string;
  action: string;
  fieldName: string | null;
  oldValue: string | null;
  newValue: string | null;
  changedBy: { id: string; fullName: string } | null;
  createdAt: string;
}

export function useGetAssetHistory(assetId: string) {
  const { data: authed } = useHasSession();
  return useQuery<AssetHistoryEntry[]>({
    queryKey: ['assetHistory', assetId],
    enabled: !!authed && !!assetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_history')
        .select('*, changed_by_profile:profiles!asset_history_changed_by_fkey(id, full_name)')
        .eq('asset_id', assetId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((h: any) => ({
        id: h.id,
        assetId: h.asset_id,
        action: h.action,
        fieldName: h.field_name ?? null,
        oldValue: h.old_value ?? null,
        newValue: h.new_value ?? null,
        changedBy: h.changed_by_profile ? { id: h.changed_by_profile.id, fullName: h.changed_by_profile.full_name } : null,
        createdAt: h.created_at,
      }));
    },
  });
}

export function useAddAssetHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ assetId, action, fieldName, oldValue, newValue }: {
      assetId: string; action: string; fieldName?: string; oldValue?: string; newValue?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('asset_history').insert({
        asset_id: assetId,
        action,
        field_name: fieldName ?? null,
        old_value: oldValue ?? null,
        new_value: newValue ?? null,
        changed_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, { assetId }) => qc.invalidateQueries({ queryKey: ['assetHistory', assetId] }),
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
        supabase.from('tickets').select('assigned_to, status').in('status', ['open', 'in_progress', 'on_hold']),
      ]);
      if (staffRes.error) throw staffRes.error;
      if (ticketsRes.error) throw ticketsRes.error;
      const tickets = ticketsRes.data ?? [];
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
      const [openedRes, resolvedRes] = await Promise.all([
        supabase.from('tickets').select('created_at').gte('created_at', since.toISOString()),
        supabase.from('tickets').select('resolved_at').not('resolved_at', 'is', null).gte('resolved_at', since.toISOString()),
      ]);
      if (openedRes.error) throw openedRes.error;
      if (resolvedRes.error) throw resolvedRes.error;

      return buckets.map(({ label, start, end }) => ({
        week: label,
        opened: (openedRes.data ?? []).filter(t => {
          const d = new Date(t.created_at);
          return d >= start && d <= end;
        }).length,
        resolved: (resolvedRes.data ?? []).filter(t => {
          const d = new Date(t.resolved_at!);
          return d >= start && d <= end;
        }).length,
      }));
    },
  });
}

// ─── REPORT DATA HOOKS ────────────────────────────────────────────────────────

export function useGetAssetHistoryAll(opts?: { from?: string; to?: string }) {
  const { data: authed } = useHasSession();
  return useQuery<any[]>({
    queryKey: ['assetHistoryAll', opts?.from, opts?.to],
    enabled: !!authed,
    queryFn: async () => {
      let q = supabase
        .from('asset_history')
        .select('*, changed_by_profile:profiles!asset_history_changed_by_fkey(id, full_name), asset:assets(id, asset_tag, name)')
        .order('created_at', { ascending: true });
      if (opts?.from) q = q.gte('created_at', opts.from);
      if (opts?.to) q = q.lte('created_at', opts.to + 'T23:59:59');
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((h: any) => ({
        id: h.id,
        assetId: h.asset_id,
        assetTag: h.asset?.asset_tag ?? null,
        assetName: h.asset?.name ?? null,
        action: h.action,
        fieldName: h.field_name ?? null,
        oldValue: h.old_value ?? null,
        newValue: h.new_value ?? null,
        changedBy: h.changed_by_profile ? { id: h.changed_by_profile.id, fullName: h.changed_by_profile.full_name } : null,
        createdAt: h.created_at,
      }));
    },
  });
}

export function useGetUserActivity(opts?: { enabled?: boolean }) {
  const { data: authed } = useHasSession();
  return useQuery<any[]>({
    queryKey: ['userActivity'],
    enabled: !!authed && (opts?.enabled ?? true),
    queryFn: async () => {
      const [usersRes, assetsRes, ticketsRes] = await Promise.all([
        supabase.from('profiles').select('*').order('full_name'),
        supabase.from('assets').select('assigned_to'),
        supabase.from('tickets').select('created_by, assigned_to, status'),
      ]);
      if (usersRes.error) throw usersRes.error;
      if (assetsRes.error) throw assetsRes.error;
      if (ticketsRes.error) throw ticketsRes.error;

      const assets = assetsRes.data ?? [];
      const tickets = ticketsRes.data ?? [];

      return (usersRes.data ?? []).map((u: any) => ({
        id: u.id,
        fullName: u.full_name,
        email: '',
        role: u.role,
        department: u.department ?? null,
        isActive: u.is_active ?? true,
        createdAt: u.created_at,
        assetsAssigned: assets.filter((a: any) => a.assigned_to === u.id).length,
        ticketsCreated: tickets.filter((t: any) => t.created_by === u.id).length,
        ticketsResolved: tickets.filter((t: any) => t.assigned_to === u.id && (t.status === 'resolved' || t.status === 'closed')).length,
      }));
    },
  });
}

export function useGetAllTicketsForReport(opts?: { enabled?: boolean }) {
  const { data: authed } = useHasSession();
  return useQuery<any[]>({
    queryKey: ['allTicketsReport'],
    enabled: !!authed && (opts?.enabled ?? true),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tickets')
        .select(`*, created_by_profile:profiles!tickets_created_by_fkey(*), assigned_to_profile:profiles!tickets_assigned_to_fkey(*), asset:assets(id, asset_tag, name, category, status)`)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapTicket);
    },
  });
}


// ─── ASSET ANOMALY DETECTION ──────────────────────────────────────────────────

export type AnomalySeverity = 'warning' | 'critical';

export interface AssetAnomaly {
  assetId: string;
  assetTag: string;
  assetName: string;
  type: 'frequent_reassignment' | 'long_maintenance' | 'inactive_long' | 'end_of_life' | 'pm_overdue';
  severity: AnomalySeverity;
  message: string;
}

// Useful life in years by category (for end-of-life detection)
const USEFUL_LIFE: Record<string, number> = {
  laptop: 4, desktop: 5, monitor: 6, printer: 5,
  server: 6, phone: 3, tablet: 3, networking: 7,
  peripheral: 4, other: 5,
};

export function useGetAssetAnomalies() {
  const { data: authed } = useHasSession();
  return useQuery<AssetAnomaly[]>({
    queryKey: ['assetAnomalies'],
    enabled: !!authed,
    staleTime: 5 * 60 * 1000, // 5 min cache
    queryFn: async () => {
      const now = Date.now();
      const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
      const oneYearAgo = new Date(now - 365 * 24 * 60 * 60 * 1000).toISOString();

      const [assetsRes, historyRes, statusHistoryRes] = await Promise.all([
        supabase.from('assets').select('id, asset_tag, name, status, category, purchase_date, updated_at, last_pm_date, next_pm_date'),
        supabase.from('asset_history')
          .select('asset_id, action, created_at')
          .in('action', ['assigned', 'unassigned'])
          .gte('created_at', thirtyDaysAgo),
        // When each asset entered its current status (for duration-based
        // rules); updated_at alone also moves on unrelated edits.
        supabase.from('asset_history')
          .select('asset_id, new_value, created_at')
          .eq('action', 'status_changed')
          .order('created_at', { ascending: false }),
      ]);

      if (assetsRes.error) throw assetsRes.error;
      if (historyRes.error) throw historyRes.error;
      if (statusHistoryRes.error) throw statusHistoryRes.error;

      const assets = assetsRes.data ?? [];
      const history = historyRes.data ?? [];
      const statusHistory = statusHistoryRes.data ?? [];
      const statusSince = (asset: any) => {
        const latestChange = statusHistory.find((h: any) => h.asset_id === asset.id);
        if (latestChange && latestChange.new_value === asset.status) return latestChange.created_at;
        return asset.updated_at;
      };
      const anomalies: AssetAnomaly[] = [];

      for (const asset of assets) {
        // 1. Frequent reassignment: 3+ assign/unassign events in 30 days
        const recentMoves = history.filter(h => h.asset_id === asset.id).length;
        if (recentMoves >= 3) {
          anomalies.push({
            assetId: asset.id, assetTag: asset.asset_tag, assetName: asset.name,
            type: 'frequent_reassignment', severity: recentMoves >= 5 ? 'critical' : 'warning',
            message: `Reassigned ${recentMoves} times in the last 30 days`,
          });
        }

        // 2. Long maintenance: in maintenance for 30+ days (since entering
        // the status, not since any unrelated edit)
        if (asset.status === 'maintenance') {
          const sinceMs = new Date(statusSince(asset)).getTime();
          const daysSince = Math.floor((now - sinceMs) / (24 * 60 * 60 * 1000));
          if (daysSince >= 30) {
            anomalies.push({
              assetId: asset.id, assetTag: asset.asset_tag, assetName: asset.name,
              type: 'long_maintenance', severity: daysSince >= 60 ? 'critical' : 'warning',
              message: `In maintenance for ${daysSince} days`,
            });
          }
        }

        // 3. Inactive long: inactive/unassigned for 1+ year
        if (asset.status === 'inactive') {
          const sinceMs = new Date(statusSince(asset)).getTime();
          if (sinceMs < new Date(oneYearAgo).getTime()) {
            const months = Math.floor((now - sinceMs) / (30 * 24 * 60 * 60 * 1000));
            anomalies.push({
              assetId: asset.id, assetTag: asset.asset_tag, assetName: asset.name,
              type: 'inactive_long', severity: 'warning',
              message: `Inactive for ${months} months — consider retiring`,
            });
          }
        }

        // 4. End of life: exact purchase date + useful life has passed
        if (asset.purchase_date && asset.status !== 'retired') {
          const usefulLife = USEFUL_LIFE[asset.category] ?? 5;
          const purchaseDate = new Date(asset.purchase_date);
          const eolDate = new Date(purchaseDate);
          eolDate.setFullYear(eolDate.getFullYear() + usefulLife);
          if (now >= eolDate.getTime()) {
            const criticalDate = new Date(eolDate);
            criticalDate.setFullYear(criticalDate.getFullYear() + 1);
            anomalies.push({
              assetId: asset.id, assetTag: asset.asset_tag, assetName: asset.name,
              type: 'end_of_life', severity: now >= criticalDate.getTime() ? 'critical' : 'warning',
              message: `Reached end of life (${usefulLife}-year lifespan, purchased ${purchaseDate.getFullYear()})`,
            });
          }
        }

        // 5. PM overdue: last_pm_date is more than 12 months ago, or next_pm_date is in the past
        if (asset.status !== 'retired') {
          const pmOverdue = asset.next_pm_date
            ? new Date(asset.next_pm_date).getTime() < now
            : asset.last_pm_date
            ? new Date(asset.last_pm_date).getTime() < new Date(now - 365 * 24 * 60 * 60 * 1000).getTime()
            : false;
          if (pmOverdue) {
            const msg = asset.next_pm_date
              ? `Preventive maintenance was due on ${new Date(asset.next_pm_date).toLocaleDateString()}`
              : `No preventive maintenance in over 12 months`;
            anomalies.push({
              assetId: asset.id, assetTag: asset.asset_tag, assetName: asset.name,
              type: 'pm_overdue' as any, severity: 'warning',
              message: msg,
            });
          }
        }
      }

      // Critical alerts first so the dashboard's top entries are the most
      // urgent ones, regardless of asset order.
      return anomalies.sort((a, b) =>
        (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1)
      );
    },
  });
}

// ─── ASSET TAG AUTO-GENERATION ───────────────────────────────────────────────

export async function generateNextAssetTag(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `DOST02-ITA${year}`;

  const { data } = await supabase
    .from('assets')
    .select('asset_tag')
    .ilike('asset_tag', `${prefix}%`)
    .order('asset_tag', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return `${prefix}000001`;

  const last = data[0].asset_tag as string;
  const numPart = last.replace(prefix, '');
  const num = parseInt(numPart, 10);
  const next = isNaN(num) ? 1 : num + 1;
  return `${prefix}${String(next).padStart(6, '0')}`;
}

// ─── ASSET MAINTENANCE LOG ────────────────────────────────────────────────────

export interface MaintenanceLogEntry {
  id: string;
  assetId: string;
  performedBy: { id: string; fullName: string } | null;
  performedAt: string;
  description: string | null;
  createdBy: { id: string; fullName: string } | null;
  createdAt: string;
}

export function useGetMaintenanceLog(assetId: string) {
  const { data: authed } = useHasSession();
  return useQuery<MaintenanceLogEntry[]>({
    queryKey: ['maintenanceLog', assetId],
    enabled: !!authed && !!assetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_maintenance_log')
        .select(`
          *,
          performed_by_profile:profiles!asset_maintenance_log_performed_by_fkey(id, full_name),
          created_by_profile:profiles!asset_maintenance_log_created_by_fkey(id, full_name)
        `)
        .eq('asset_id', assetId)
        .order('performed_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        assetId: r.asset_id,
        performedBy: r.performed_by_profile ? { id: r.performed_by_profile.id, fullName: r.performed_by_profile.full_name } : null,
        performedAt: r.performed_at,
        description: r.description ?? null,
        createdBy: r.created_by_profile ? { id: r.created_by_profile.id, fullName: r.created_by_profile.full_name } : null,
        createdAt: r.created_at,
      }));
    },
  });
}

export function useAddMaintenanceLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ assetId, performedById, performedAt, description }: {
      assetId: string; performedById?: string; performedAt: string; description?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('asset_maintenance_log').insert({
        asset_id: assetId,
        performed_by: performedById ?? null,
        performed_at: performedAt,
        description: description ?? null,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, { assetId }) => {
      qc.invalidateQueries({ queryKey: ['maintenanceLog', assetId] });
      qc.invalidateQueries({ queryKey: ['asset', assetId] });
    },
  });
}
