import { useEffect, useState } from 'react';
import { Redirect } from 'wouter';
import { History, Loader2 } from 'lucide-react';
import { AppLayout } from '@/components/layout/app-layout';
import { PageHeader } from '@/components/layout/page-header';
import { ListSkeleton, EmptyState, ErrorState } from '@/components/ui/page-states';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { useEntityAuditDetails, useEntityAuditPage } from '@/lib/queries/entity-audit';

const MAX_DISPLAY_CHARS = 30_000;
function displaySnapshot(value: unknown) {
  if (value === null) return '(none)';
  const text = JSON.stringify(value, null, 2) ?? '(unavailable)';
  return text.length > MAX_DISPLAY_CHARS ? `${text.slice(0, MAX_DISPLAY_CHARS)}\n… Display truncated.` : text;
}

export default function AuditLog() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'administrator';
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const cursor = cursors[cursors.length - 1];
  const page = useEntityAuditPage(user?.id ?? null, isAdmin, cursor);
  const details = useEntityAuditDetails(user?.id ?? null, isAdmin, selectedId);
  useEffect(() => { setSelectedId(null); }, [cursor, user?.id]);
  if (!isAdmin) return <Redirect to="/dashboard" />;

  return (
    <AppLayout>
      <div className="space-y-5">
        <PageHeader eyebrow="Administration" title={<>Audit <span className="text-primary">log</span></>} subtitle="Recorded ticket and asset changes. Access is restricted to active administrators." />
        <div className="rounded-2xl border border-border/60 bg-card/70 p-4 text-sm text-muted-foreground">
          This stream starts only when audit recording is enabled; older activity is not backfilled. Entries are ordered by sequence ID, not guaranteed commit time. Refresh to see recent changes; concurrent transactions can affect pagination. An absent actor does not prove a system action.
        </div>
        {page.isPending ? <ListSkeleton rows={5} /> : page.isError ? (
          <ErrorState title="Could not load audit events" message="The audit stream may not be available, or your access may have changed. No empty result is assumed." onRetry={() => void page.refetch()} />
        ) : page.data.rows.length === 0 ? (
          <EmptyState icon={History} title="No audit events on this page" message="Only changes recorded after the audit stream was enabled appear here." />
        ) : (
          <div className="space-y-3">
            {page.data.rows.map(row => (
              <section key={row.id} className="rounded-2xl border border-border/60 bg-card/75 p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <h2 className="font-semibold">{row.entity_type.replaceAll('_', ' ')} · {row.operation.toLowerCase()}</h2>
                    <p className="text-sm text-muted-foreground">{Number.isNaN(Date.parse(row.occurred_at)) ? 'Unknown time' : new Date(row.occurred_at).toLocaleString()} · Event {row.id}</p>
                    <p className="break-all text-xs text-muted-foreground">Record: {row.entity_id} · Actor: {row.actor_id ?? 'not recorded'}</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setSelectedId(selectedId === row.id ? null : row.id)} aria-expanded={selectedId === row.id}>
                    {selectedId === row.id ? 'Hide details' : 'View details'}
                  </Button>
                </div>
                {selectedId === row.id && (
                  <div className="mt-4 space-y-3 border-t border-border/50 pt-4">
                    <p className="text-xs text-muted-foreground">Details may contain sensitive or deleted information. Do not share them unnecessarily.</p>
                    {details.isPending ? <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading details…</p> : details.isError ? (
                      <div role="alert" className="text-sm text-destructive">Could not load this entry. It may have been removed or your access changed. <Button type="button" variant="outline" size="sm" onClick={() => void details.refetch()}>Try again</Button></div>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-2">
                        {([['Before', details.data.old_values], ['After', details.data.new_values]] as const).map(([label, value]) => (
                          <div key={label} className="min-w-0"><h3 className="mb-1 text-sm font-semibold">{label}</h3><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-muted/50 p-3 text-xs">{displaySnapshot(value)}</pre></div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
        {!page.isPending && !page.isError && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" size="sm" onClick={() => { setSelectedId(null); if (cursors.length === 1) void page.refetch(); else setCursors([null]); }}>Refresh latest</Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={cursors.length === 1 || page.isFetching} onClick={() => setCursors(current => current.slice(0, -1))}>Previous</Button>
              <Button variant="outline" size="sm" disabled={!page.data.next || page.isFetching} onClick={() => { if (page.data.next) setCursors(current => [...current, page.data.next]); }}>Older</Button>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
