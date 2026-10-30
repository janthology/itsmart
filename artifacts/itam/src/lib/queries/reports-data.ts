/**
 * Report data hooks (asset history, user activity, full ticket export feed).
 * Part of the Supabase data layer (split from supabase-queries.ts in Phase 4).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { mapTicket, useHasSession, fetchAllRows } from './shared';

// ─── REPORT DATA HOOKS ────────────────────────────────────────────────────────

export function useGetAssetHistoryAll(opts?: { from?: string; to?: string }) {
  const { data: authed } = useHasSession();
  return useQuery<any[]>({
    queryKey: ['assetHistoryAll', opts?.from, opts?.to],
    enabled: !!authed,
    queryFn: async () => {
      const data = await fetchAllRows<any>(() => {
        let q = supabase
          .from('asset_history')
          .select('*, changed_by_profile:profiles!asset_history_changed_by_fkey(id, full_name), asset:assets(id, asset_tag, name)')
          .order('created_at', { ascending: true })
          .order('id', { ascending: true });
        if (opts?.from) q = q.gte('created_at', opts.from);
        if (opts?.to) q = q.lte('created_at', opts.to + 'T23:59:59');
        return q;
      });
      return data.map((h: any) => ({
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
      const [usersRes, assets, tickets] = await Promise.all([
        supabase.from('profiles').select('*').order('full_name'),
        fetchAllRows<any>(() => supabase.from('assets').select('assigned_to').order('id')),
        fetchAllRows<any>(() => supabase.from('tickets').select('created_by, assigned_to, status').order('id')),
      ]);
      if (usersRes.error) throw usersRes.error;

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
      const data = await fetchAllRows<any>(() =>
        supabase
          .from('tickets')
          .select(`*, created_by_profile:profiles!tickets_created_by_fkey(*), assigned_to_profile:profiles!tickets_assigned_to_fkey(*), asset:assets(id, asset_tag, name, category, status)`)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
      );
      return data.map(mapTicket);
    },
  });
}
