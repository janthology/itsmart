/**
 * Assets: CRUD, history, anomaly detection, tag generation, maintenance log.
 * Part of the Supabase data layer (split from supabase-queries.ts in Phase 4).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import type {
  Asset, AssetListResponse,
  CreateAssetRequest, UpdateAssetRequest,
} from '../api-types';
import {
  AssetStatus, AssetCategory,
  mapAsset, useHasSession, fetchAllRows,
} from './shared';

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
      // Fetch in 1,000-row pages: a single PostgREST response is silently
      // capped at 1,000 rows, so an unbounded select would lose assets
      // without any error once the table grows past that.
      const buildQuery = () => {
        let q = supabase.from('assets').select(ASSET_SELECT).order('created_at', { ascending: false }).order('id', { ascending: false });
        // Always apply non-text filters server-side
        if (status) q = q.eq('status', status);
        if (assignedTo) q = q.eq('assigned_to', assignedTo);
        // Category is applied server-side when there's no search term; when
        // searching, it's re-applied client-side after the text filter so that
        // both conditions are respected together.
        if (!search && category) q = q.eq('category', category);
        return q;
      };

      const rows: any[] = [];
      const CHUNK = 1000;
      for (let start = 0; ; start += CHUNK) {
        const { data, error } = await buildQuery().range(start, start + CHUNK - 1);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < CHUNK) break;
      }
      let assets = rows.map(mapAsset);
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
      return { data: assets, total: assets.length, page: 1, limit: assets.length };
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
