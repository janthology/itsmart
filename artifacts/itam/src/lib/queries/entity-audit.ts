import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabase';

export const AUDIT_PAGE_SIZE = 25;
export type AuditKind = 'ticket' | 'asset' | 'ticket_comment' | 'asset_history' | 'asset_maintenance';
export type AuditOperation = 'INSERT' | 'UPDATE' | 'DELETE';
export interface AuditSummary { id: string; occurred_at: string; entity_type: AuditKind; entity_id: string; operation: AuditOperation; actor_id: string | null }
export interface AuditDetails { old_values: unknown; new_values: unknown }
const kinds = new Set(['ticket','asset','ticket_comment','asset_history','asset_maintenance']);
const operations = new Set(['INSERT','UPDATE','DELETE']);
const decimalId = /^[1-9][0-9]*$/;

function normalizeSummary(raw: unknown): AuditSummary {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid audit row');
  const row = raw as Record<string, unknown>;
  // PostgREST casts bigint to text; never silently round large IDs in JS.
  if (typeof row.id !== 'string' || !decimalId.test(row.id) || typeof row.occurred_at !== 'string' ||
      typeof row.entity_type !== 'string' || !kinds.has(row.entity_type) || typeof row.entity_id !== 'string' ||
      typeof row.operation !== 'string' || !operations.has(row.operation) ||
      (row.actor_id !== null && typeof row.actor_id !== 'string')) throw new Error('Invalid audit row');
  return row as unknown as AuditSummary;
}

export async function fetchEntityAuditPage(cursor: string | null): Promise<{rows: AuditSummary[]; next: string | null}> {
  if (cursor !== null && !decimalId.test(cursor)) throw new Error('Invalid audit cursor');
  // Do not download snapshots in the list. Database RLS, not client role, is
  // the authorization boundary. Pagination is by sequence ID, not commit time.
  let query = supabase.from('entity_change_audit')
    .select('id::text,occurred_at,entity_type,entity_id,operation,actor_id')
    .order('id', { ascending: false }).limit(AUDIT_PAGE_SIZE + 1);
  if (cursor !== null) query = query.lt('id', cursor);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []).map(normalizeSummary);
  const shown = rows.slice(0, AUDIT_PAGE_SIZE);
  return { rows: shown, next: rows.length > AUDIT_PAGE_SIZE ? shown[shown.length - 1].id : null };
}

export async function fetchEntityAuditDetails(id: string): Promise<AuditDetails> {
  if (!decimalId.test(id)) throw new Error('Invalid audit ID');
  const { data, error } = await supabase.from('entity_change_audit')
    .select('old_values,new_values').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Audit entry not found or access denied');
  return { old_values: data.old_values, new_values: data.new_values };
}

export function useEntityAuditPage(actorId: string | null, enabled: boolean, cursor: string | null) {
  return useQuery({ queryKey: ['entity-audit', actorId, cursor], enabled: enabled && !!actorId, queryFn: () => fetchEntityAuditPage(cursor), staleTime: 0, gcTime: 0 });
}
export function useEntityAuditDetails(actorId: string | null, enabled: boolean, id: string | null) {
  return useQuery({ queryKey: ['entity-audit-detail', actorId, id], enabled: enabled && !!actorId && !!id, queryFn: () => fetchEntityAuditDetails(id!), staleTime: 0, gcTime: 0, retry: false });
}
