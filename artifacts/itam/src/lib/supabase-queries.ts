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
  Category,
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

function mapUser(u: any): UserProfile & { isActive?: boolean } {
  return {
    id: u.id,
    email: u.email ?? '',
    fullName: u.full_name ?? '',
    role: u.role,
    department: u.department ?? null,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
    isActive: u.is_active ?? true,
  };
}

function mapAsset(a: any): Asset & { serialNumber?: string | null; location?: string | null; model?: string | null; purchaseValue?: number | null } {
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
  };
}

function mapTicket(t: any): Ticket & { ticketNumber?: string; resolvedAt?: string | null; type?: string; satisfactionRating?: number | null; satisfactionComment?: string | null; totalHoldSeconds?: number; onHoldAt?: string | null } {
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
    satisfactionRating: t.satisfaction_rating ?? null,
    satisfactionComment: t.satisfaction_comment ?? null,
    totalHoldSeconds: t.total_hold_seconds ?? 0,
    onHoldAt: t.on_hold_at ?? null,
  };
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
      if (!search) {
        if (status) q = q.eq('status', status);
        if (category) q = q.eq('category', category);
        if (assignedTo) q = q.eq('assigned_to', assignedTo);
      } else {
        // When searching, still apply non-text filters server-side
        if (status) q = q.eq('status', status);
        if (assignedTo) q = q.eq('assigned_to', assignedTo);
      }
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
    mutationFn: async ({ data }: { data: CreateAssetRequest & { serialNumber?: string; location?: string; model?: string; purchaseValue?: number } }) => {
      const { data: row, error } = await supabase.from('assets').insert({
        asset_tag: data.assetTag,
        name: data.name,
        category: data.category,
        status: data.status,
        assigned_to: data.assignedToId ?? null,
        purchase_date: data.purchaseDate ?? null,
        purchase_value: (data as any).purchaseValue ?? null,
        notes: data.notes ?? null,
        serial_number: (data as any).serialNumber ?? null,
        location: (data as any).location ?? null,
        model: (data as any).model ?? null,
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
    mutationFn: async ({ id, data }: { id: string; data: UpdateAssetRequest & { serialNumber?: string; location?: string; model?: string; purchaseValue?: number } }) => {
      const updates: any = { updated_at: new Date().toISOString() };
      if (data.name !== undefined) updates.name = data.name;
      if (data.category !== undefined) updates.category = data.category;
      if (data.status !== undefined) updates.status = data.status;
      if (data.notes !== undefined) updates.notes = data.notes;
      if (data.assignedToId !== undefined) updates.assigned_to = data.assignedToId;
      if (data.purchaseDate !== undefined) updates.purchase_date = data.purchaseDate;
      if ((data as any).purchaseValue !== undefined) updates.purchase_value = (data as any).purchaseValue;
      if ((data as any).serialNumber !== undefined) updates.serial_number = (data as any).serialNumber;
      if ((data as any).location !== undefined) updates.location = (data as any).location;
      if ((data as any).model !== undefined) updates.model = (data as any).model;
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

export function useGetTickets(opts?: { query?: { search?: string; status?: TicketStatus; priority?: TicketPriority; createdBy?: string; assignedTo?: string } }) {
  const search = opts?.query?.search;
  const status = opts?.query?.status;
  const priority = opts?.query?.priority;
  const createdBy = opts?.query?.createdBy;
  const assignedTo = opts?.query?.assignedTo;
  const { data: authed } = useHasSession();

  return useQuery<TicketListResponse>({
    queryKey: ['tickets', search, status, priority, createdBy, assignedTo],
    enabled: !!authed,
    queryFn: async () => {
      let q = supabase.from('tickets').select(TICKET_SELECT).order('created_at', { ascending: false });
      // Server-side filters (search is handled client-side — filtering on joined
      // profile columns via .or() is unreliable in PostgREST with embedded selects)
      if (status) q = q.eq('status', status);
      if (priority) q = q.eq('priority', priority);
      if (createdBy) q = q.eq('created_by', createdBy);
      if (assignedTo) q = q.eq('assigned_to', assignedTo);
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
        createdBy: mapUser(c.created_by_profile),
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
    onSuccess: (_d, { id }) => qc.invalidateQueries({ queryKey: ['ticket', id] }),
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
      let q = supabase.from('profiles_with_email').select('*').order('created_at', { ascending: false });
      if (search) q = q.ilike('full_name', `%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map(mapUser);
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
      const { error } = await supabase.from('profiles').update(updates).eq('id', user.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['currentUser'] }),
  });
}

// ─── CATEGORIES ──────────────────────────────────────────────────────────────

export function useGetCategories() {
  const { data: authed } = useHasSession();
  return useQuery<Category[]>({
    queryKey: ['categories'],
    enabled: !!authed,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((c: any) => ({ id: c.id, name: c.name, type: c.type, createdAt: c.created_at }));
    },
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ data }: { data: { name: string; type: string } }) => {
      const { error } = await supabase.from('categories').insert(data);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { error } = await supabase.from('categories').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

export function useGetDashboardStats() {
  const { data: authed } = useHasSession();
  return useQuery<DashboardStats>({
    queryKey: ['dashboardStats'],
    enabled: !!authed,
    queryFn: async () => {
      const [assetsRes, ticketsRes, usersRes, recentTicketsRes] = await Promise.all([
        supabase.from('assets').select('status, assigned_to'),
        supabase.from('tickets').select('status'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('tickets').select(TICKET_SELECT)
          .order('created_at', { ascending: false }).limit(5),
      ]);

      if (assetsRes.error) throw assetsRes.error;
      if (ticketsRes.error) throw ticketsRes.error;
      if (recentTicketsRes.error) throw recentTicketsRes.error;

      const assets = assetsRes.data ?? [];
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
        resolvedTickets: tickets.filter((t: any) => t.status === 'resolved' || t.status === 'closed').length,
        totalUsers: usersRes.count ?? 0,
        recentTickets: (recentTicketsRes.data ?? []).map(mapTicket),
        recentAssets: [],
      };
    },
  });
}

// ─── Re-export types ──────────────────────────────────────────────────────────
export type { UserProfile, Asset, Ticket, TicketWithComments, Category, DashboardStats };

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
        supabase.from('profiles').select('id, full_name').eq('role', 'support_staff').order('full_name'),
        supabase.from('tickets').select('assigned_to, status').in('status', ['in_progress', 'on_hold']),
      ]);
      if (staffRes.error) throw staffRes.error;
      if (ticketsRes.error) throw ticketsRes.error;
      const tickets = ticketsRes.data ?? [];
      return (staffRes.data ?? []).map((s: any) => {
        const mine = tickets.filter((t: any) => t.assigned_to === s.id);
        return {
          id: s.id,
          fullName: s.full_name,
          openCount: 0,
          inProgressCount: mine.filter((t: any) => t.status === 'in_progress').length,
          onHoldCount: mine.filter((t: any) => t.status === 'on_hold').length,
          totalActive: mine.length,
        };
      });
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
      const since = new Date();
      since.setDate(since.getDate() - weeks * 7);

      const [openedRes, resolvedRes] = await Promise.all([
        supabase.from('tickets').select('created_at').gte('created_at', since.toISOString()),
        supabase.from('tickets').select('resolved_at').not('resolved_at', 'is', null).gte('resolved_at', since.toISOString()),
      ]);
      if (openedRes.error) throw openedRes.error;
      if (resolvedRes.error) throw resolvedRes.error;

      // Build week buckets (Mon–Sun)
      const buckets: { label: string; start: Date; end: Date }[] = [];
      for (let i = weeks - 1; i >= 0; i--) {
        const start = new Date();
        start.setDate(start.getDate() - i * 7 - (start.getDay() === 0 ? 6 : start.getDay() - 1));
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        buckets.push({ label: `${start.toLocaleString('default', { month: 'short' })} ${start.getDate()}`, start, end });
      }

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

export function useGetUserActivity() {
  const { data: authed } = useHasSession();
  return useQuery<any[]>({
    queryKey: ['userActivity'],
    enabled: !!authed,
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

export function useGetAllTicketsForReport() {
  const { data: authed } = useHasSession();
  return useQuery<any[]>({
    queryKey: ['allTicketsReport'],
    enabled: !!authed,
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

