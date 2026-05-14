import { useState, useMemo } from "react";
import {
  useGetAssets, useGetTickets, useGetAssetHistoryAll, useGetUserActivity, useGetAllTicketsForReport,
  AssetStatus, TicketStatus, TicketPriority,
} from "@/lib/supabase-queries";
import { useAuth } from "@/lib/auth-context";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, FileSpreadsheet, FileText, MonitorSmartphone, TicketIcon, X,
  History, Users, PackageX, TrendingDown, Star, Gauge,
} from "lucide-react";
import {
  exportAssetsXlsx, exportAssetsPdf,
  exportTicketsXlsx, exportTicketsPdf,
  exportAssetHistoryXlsx, exportAssetHistoryPdf,
  exportTicketPerformanceXlsx, exportTicketPerformancePdf,
  exportUserActivityXlsx, exportUserActivityPdf,
  exportUnassignedAssetsXlsx, exportUnassignedAssetsPdf,
  exportDepreciationXlsx, exportDepreciationPdf,
  exportSatisfactionXlsx, exportSatisfactionPdf,
} from "@/lib/reports";
import { useToast } from "@/hooks/use-toast";
import { isWithinInterval, parseISO, startOfDay, endOfDay, format } from "date-fns";
import { cn } from "@/lib/utils";
import { SLA_HOURS } from "@/lib/sla";
import { PageHeader } from "@/components/ui/page-header";

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  open: "Open", in_progress: "In Progress", on_hold: "On Hold", resolved: "Resolved", closed: "Closed",
};
const PRIORITY_LABEL: Record<string, string> = {
  critical: "Critical - 1", high: "High - 2", medium: "Medium - 3", low: "Low - 4",
};
const PREVIEW_ROWS = 10;

// ─── PreviewTable ─────────────────────────────────────────────────────────────

function PreviewTable({ columns, rows, total, loading }: {
  columns: string[];
  rows: (string | number | null)[][];
  total: number;
  loading: boolean;
}) {
  if (loading) return (
    <div className="flex items-center justify-center py-10 text-muted-foreground gap-2 text-sm">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading preview...
    </div>
  );
  if (rows.length === 0) return (
    <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
      No data matches the current filters.
    </div>
  );
  return (
    <div className="rounded-xl border border-border/50 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/40 border-b border-border/50">
              {columns.map(c => (
                <th key={c} className="text-left px-3 py-2.5 font-semibold text-foreground/70 whitespace-nowrap">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {rows.map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-2 text-foreground/80 whitespace-nowrap max-w-[180px] truncate" title={String(cell ?? "")}>
                    {cell ?? <span className="text-muted-foreground/50">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > PREVIEW_ROWS && (
        <div className="px-3 py-2 border-t border-border/50 bg-muted/20 text-xs text-muted-foreground">
          Showing {PREVIEW_ROWS} of {total} rows — export to see all
        </div>
      )}
    </div>
  );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function applyDateFilter<T extends { createdAt: string }>(items: T[], from: string, to: string): T[] {
  if (!from && !to) return items;
  return items.filter(item => {
    const d = parseISO(item.createdAt);
    if (from && to) return isWithinInterval(d, { start: startOfDay(parseISO(from)), end: endOfDay(parseISO(to)) });
    if (from) return d >= startOfDay(parseISO(from));
    if (to) return d <= endOfDay(parseISO(to));
    return true;
  });
}

function DateRange({ from, to, onFrom, onTo, onClear }: {
  from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void; onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">From</p>
        <Input type="date" value={from} onChange={e => onFrom(e.target.value)} className="h-9 w-[148px] rounded-lg text-sm" />
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">To</p>
        <Input type="date" value={to} onChange={e => onTo(e.target.value)} className="h-9 w-[148px] rounded-lg text-sm" />
      </div>
      {(from || to) && (
        <Button variant="ghost" size="sm" className="h-9 px-2 rounded-lg text-muted-foreground" onClick={onClear}>
          <X className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  );
}

function ExportRow({ loading, count, label, onXlsx, onPdf }: {
  loading: boolean; count: number; label: string; onXlsx: () => void; onPdf: () => void;
}) {
  const disabled = loading || count === 0;
  return (
    <div className="flex items-center justify-between gap-4 pt-2 border-t border-border/50">
      <div className="text-sm text-muted-foreground">
        {loading
          ? <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading...</span>
          : <><span className="font-semibold text-foreground">{count}</span> {label}</>}
      </div>
      <div className="flex gap-2 shrink-0">
        <Button size="sm" variant="outline" className="rounded-lg gap-1.5 h-9" disabled={disabled} onClick={onXlsx}>
          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" /> Excel
        </Button>
        <Button size="sm" variant="outline" className="rounded-lg gap-1.5 h-9" disabled={disabled} onClick={onPdf}>
          <FileText className="w-3.5 h-3.5 text-red-500" /> PDF
        </Button>
      </div>
    </div>
  );
}

// ─── Report definitions ───────────────────────────────────────────────────────

type ReportId =
  | "asset_inventory" | "asset_history" | "asset_unassigned" | "asset_depreciation"
  | "ticket_list" | "ticket_performance" | "ticket_satisfaction" | "user_activity";

interface ReportDef {
  id: ReportId; label: string; icon: React.ElementType;
  group: "assets" | "tickets" | "admin";
  roles: ("administrator" | "support_staff" | "general_user")[];
  description: string;
}

const REPORT_DEFS: ReportDef[] = [
  { id: "asset_inventory",    label: "Inventory",    icon: MonitorSmartphone, group: "assets",  roles: ["administrator","support_staff"],                  description: "Full asset list with status, location, assignment, and purchase info." },
  { id: "asset_history",      label: "History",      icon: History,           group: "assets",  roles: ["administrator"],                                  description: "Audit trail of every assignment, unassignment, and field change." },
  { id: "asset_unassigned",   label: "Unassigned",   icon: PackageX,          group: "assets",  roles: ["administrator"],                                  description: "Assets currently without an assigned user — for utilization reviews." },
  { id: "asset_depreciation", label: "Depreciation", icon: TrendingDown,      group: "assets",  roles: ["administrator"],                                  description: "Straight-line depreciation over 5 years with current estimated value." },
  { id: "ticket_list",        label: "Tickets",      icon: TicketIcon,        group: "tickets", roles: ["administrator","support_staff","general_user"],   description: "Ticket list filtered by status, priority, and date." },
  { id: "ticket_performance", label: "Performance",  icon: Gauge,             group: "tickets", roles: ["administrator","support_staff"],                  description: "Resolution time vs SLA target per ticket, Met / Breached status." },
  { id: "ticket_satisfaction",label: "Satisfaction", icon: Star,              group: "tickets", roles: ["administrator","support_staff"],                  description: "User satisfaction ratings with average score and distribution." },
  { id: "user_activity",      label: "User Activity",icon: Users,             group: "admin",   roles: ["administrator"],                                  description: "All users with role, status, assets assigned, and tickets created/resolved." },
];

const GROUP_LABELS = { assets: "Assets", tickets: "Tickets", admin: "Admin" };

// ─── Main component ───────────────────────────────────────────────────────────

export default function Reports() {
  const { toast } = useToast();
  const { user } = useAuth();
  const role = (user?.role ?? "general_user") as "administrator" | "support_staff" | "general_user";
  const isAdmin = role === "administrator";
  const isSupport = role === "support_staff";
  const isGeneral = role === "general_user";

  const visibleReports = REPORT_DEFS.filter(r => r.roles.includes(role));
  const [activeId, setActiveId] = useState<ReportId>(visibleReports[0]?.id ?? "ticket_list");
  const active = REPORT_DEFS.find(r => r.id === activeId)!;

  const handleExport = (fn: () => void) => {
    try { fn(); toast({ title: "Export successful", description: "Your file has been downloaded." }); }
    catch { toast({ variant: "destructive", title: "Export failed", description: "Could not generate the file." }); }
  };

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [assetStatus, setAssetStatus] = useState("all");
  const [assetFrom, setAssetFrom] = useState(""); const [assetTo, setAssetTo] = useState("");
  const [ticketStatus, setTicketStatus] = useState("all");
  const [ticketPriority, setTicketPriority] = useState("all");
  const [ticketFrom, setTicketFrom] = useState(""); const [ticketTo, setTicketTo] = useState("");
  const [histFrom, setHistFrom] = useState(""); const [histTo, setHistTo] = useState("");
  const [perfFrom, setPerfFrom] = useState(""); const [perfTo, setPerfTo] = useState("");

  // ── Data (lazy) ──────────────────────────────────────────────────────────────
  const needsAssets = ["asset_inventory","asset_unassigned","asset_depreciation"].includes(activeId);
  const needsTickets = activeId === "ticket_list";
  const needsHistory = activeId === "asset_history";

  const { data: assetsData, isLoading: assetsLoading } = useGetAssets({
    query: needsAssets ? { status: assetStatus !== "all" ? assetStatus as AssetStatus : undefined } : {},
  });
  const ticketQuery: any = {
    status: ticketStatus !== "all" ? ticketStatus as TicketStatus : undefined,
    priority: ticketPriority !== "all" ? ticketPriority as TicketPriority : undefined,
  };
  if (isGeneral) ticketQuery.createdBy = user?.id;
  if (isSupport) ticketQuery.assignedTo = user?.id;
  const { data: ticketsData, isLoading: ticketsLoading } = useGetTickets({ query: needsTickets ? ticketQuery : {} });
  const { data: historyData = [], isLoading: historyLoading } = useGetAssetHistoryAll(needsHistory ? { from: histFrom || undefined, to: histTo || undefined } : {});
  const { data: allTicketsData = [], isLoading: allTicketsLoading } = useGetAllTicketsForReport();
  const { data: userActivity = [], isLoading: userActivityLoading } = useGetUserActivity();

  // ── Derived ──────────────────────────────────────────────────────────────────
  const assets = useMemo(() => applyDateFilter(assetsData?.data ?? [], assetFrom, assetTo), [assetsData, assetFrom, assetTo]);
  const tickets = useMemo(() => applyDateFilter(ticketsData?.data ?? [], ticketFrom, ticketTo), [ticketsData, ticketFrom, ticketTo]);
  const unassignedAssets = useMemo(() => (assetsData?.data ?? []).filter((a: any) => !a.assignedTo), [assetsData]);
  const depreciationAssets = useMemo(() => (assetsData?.data ?? []).filter((a: any) => a.purchaseValue != null && a.purchaseDate), [assetsData]);
  const perfTickets = useMemo(() => {
    let base = allTicketsData;
    if (isSupport) base = base.filter((t: any) => t.assignedTo?.id === user?.id);
    return applyDateFilter(base, perfFrom, perfTo);
  }, [allTicketsData, perfFrom, perfTo, isSupport, user?.id]);
  const ratedTickets = useMemo(() => {
    let base = allTicketsData.filter((t: any) => t.satisfactionRating != null);
    if (isSupport) base = base.filter((t: any) => t.assignedTo?.id === user?.id);
    return base;
  }, [allTicketsData, isSupport, user?.id]);
  const avgRating = ratedTickets.length
    ? (ratedTickets.reduce((s: number, t: any) => s + t.satisfactionRating, 0) / ratedTickets.length).toFixed(1)
    : null;

  // ── Preview row builders ──────────────────────────────────────────────────────
  const assetPreviewCols = ["Tag", "Name", "Category", "Status", "Serial No.", "Location", "Assigned To", "Purchase Date", "Value (₱)"];
  const assetPreviewRows = assets.slice(0, PREVIEW_ROWS).map((a: any) => [
    a.assetTag, a.name + (a.model ? ` / ${a.model}` : ""), a.category, a.status,
    a.serialNumber ?? null, a.location ?? null, a.assignedTo?.fullName ?? "Unassigned",
    a.purchaseDate ? format(new Date(a.purchaseDate), "MMM d, yyyy") : null,
    a.purchaseValue != null ? `₱${Number(a.purchaseValue).toLocaleString()}` : null,
  ]);

  const histPreviewCols = ["Asset Tag", "Asset Name", "Action", "Field", "Old Value", "New Value", "Changed By", "Date"];
  const histPreviewRows = historyData.slice(0, PREVIEW_ROWS).map((h: any) => [
    h.assetTag, h.assetName, h.action, h.fieldName, h.oldValue, h.newValue,
    h.changedBy?.fullName ?? null, format(new Date(h.createdAt), "MMM d, yyyy HH:mm"),
  ]);

  const ticketPreviewCols = ["Ticket No.", "Title", "Status", "Priority", "Requester", "Assigned To", "Created"];
  const ticketPreviewRows = tickets.slice(0, PREVIEW_ROWS).map((t: any) => [
    t.ticketNumber ?? `#${t.id.substring(0,8)}`, t.title,
    t.status.replace(/_/g," "), t.priority,
    t.createdBy?.fullName ?? null, t.assignedTo?.fullName ?? "—",
    format(new Date(t.createdAt), "MMM d, yyyy"),
  ]);

  const perfPreviewCols = ["Ticket No.", "Title", "Priority", "Assigned To", "Created", "Resolved", "Res. Time (h)", "SLA (h)", "SLA Status"];
  const perfPreviewRows = perfTickets.slice(0, PREVIEW_ROWS).map((t: any) => {
    const target = SLA_HOURS[t.priority] ?? 24;
    const resMs = t.resolvedAt ? new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime() : null;
    const resH = resMs != null ? +(resMs / 3600000).toFixed(2) : null;
    return [
      t.ticketNumber ?? `#${t.id.substring(0,8)}`, t.title, t.priority,
      t.assignedTo?.fullName ?? "—",
      format(new Date(t.createdAt), "MMM d, yyyy"),
      t.resolvedAt ? format(new Date(t.resolvedAt), "MMM d, yyyy") : null,
      resH, target,
      resH == null ? "Pending" : resH <= target ? "✅ Met" : "❌ Breached",
    ];
  });

  const satPreviewCols = ["Ticket No.", "Title", "Priority", "Assigned To", "Rating", "Comment"];
  const satPreviewRows = ratedTickets.slice(0, PREVIEW_ROWS).map((t: any) => [
    t.ticketNumber ?? `#${t.id.substring(0,8)}`, t.title, t.priority,
    t.assignedTo?.fullName ?? "—",
    `${"★".repeat(t.satisfactionRating)}${"☆".repeat(5 - t.satisfactionRating)} ${t.satisfactionRating}/5`,
    t.satisfactionComment ?? null,
  ]);

  const unassignedPreviewCols = ["Tag", "Name", "Category", "Status", "Serial No.", "Location", "Purchase Date"];
  const unassignedPreviewRows = unassignedAssets.slice(0, PREVIEW_ROWS).map((a: any) => [
    a.assetTag, a.name, a.category, a.status,
    a.serialNumber ?? null, a.location ?? null,
    a.purchaseDate ? format(new Date(a.purchaseDate), "MMM d, yyyy") : null,
  ]);

  const depPreviewCols = ["Tag", "Name", "Category", "Purchase Date", "Purchase Value (₱)", "Age (yrs)", "Current Value (₱)", "% Dep."];
  const depPreviewRows = depreciationAssets.slice(0, PREVIEW_ROWS).map((a: any) => {
    const ageMs = Date.now() - new Date(a.purchaseDate).getTime();
    const ageYears = +(ageMs / (1000*60*60*24*365.25)).toFixed(2);
    const annual = Number(a.purchaseValue) / 5;
    const accumulated = Math.min(annual * ageYears, Number(a.purchaseValue));
    const current = Math.max(Number(a.purchaseValue) - accumulated, 0);
    const pct = Math.min(Math.round((accumulated / Number(a.purchaseValue)) * 100), 100);
    return [
      a.assetTag, a.name, a.category,
      format(new Date(a.purchaseDate), "MMM d, yyyy"),
      `₱${Number(a.purchaseValue).toLocaleString()}`,
      ageYears, `₱${current.toLocaleString()}`, `${pct}%`,
    ];
  });

  const userPreviewCols = ["Full Name", "Role", "Department", "Status", "Assets", "Tickets Created", "Tickets Resolved"];
  const userPreviewRows = userActivity.slice(0, PREVIEW_ROWS).map((u: any) => [
    u.fullName, u.role.replace(/_/g," "), u.department ?? null,
    u.isActive ? "Active" : "Inactive",
    u.assetsAssigned, u.ticketsCreated, u.ticketsResolved,
  ]);

  // ── Groups ────────────────────────────────────────────────────────────────────
  const groups = (["assets","tickets","admin"] as const).map(g => ({
    key: g, label: GROUP_LABELS[g],
    reports: visibleReports.filter(r => r.group === g),
  })).filter(g => g.reports.length > 0);

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageHeader title="Reports" subtitle="Export and analyze asset and ticket data" />
        <div className="flex gap-6 items-start">

          {/* Left nav */}
          <div className="w-48 shrink-0 space-y-4">
            {groups.map((g, gi) => (
              <div key={g.key}>
                {gi > 0 && <div className="border-t border-border/40 my-3" />}
                <p className="text-sm font-bold text-primary uppercase tracking-wider px-3 mb-1.5">{g.label}</p>
                <div className="space-y-0.5">
                  {g.reports.map(r => {
                    const Icon = r.icon;
                    const isActive = activeId === r.id;
                    return (
                      <button key={r.id} onClick={() => setActiveId(r.id)}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors text-left",
                          isActive
                            ? "bg-primary text-primary-foreground shadow-sm border-l-2 border-primary-foreground/50"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        )}>
                        <Icon className="w-4 h-4 shrink-0" />{r.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Report panel */}
          <div className="flex-1 min-w-0">
            <Card className="border-border/50 shadow-lg shadow-black/5 rounded-2xl overflow-hidden">

              {/* Header */}
              <div className="px-6 py-5 border-b border-border/50 bg-muted/20">
                <div className="flex items-center gap-2 mb-1">
                  <active.icon className="w-5 h-5 text-primary" />
                  <h2 className="text-lg font-display font-semibold text-foreground">{active.label} Report</h2>
                  {isGeneral && active.id === "ticket_list" && <Badge variant="secondary" className="text-xs">Your tickets</Badge>}
                  {isSupport && ["ticket_list","ticket_performance","ticket_satisfaction"].includes(active.id) && <Badge variant="secondary" className="text-xs">Assigned to you</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{active.description}</p>
              </div>

              <CardContent className="p-6 space-y-4">

                {/* ── Asset Inventory ── */}
                {activeId === "asset_inventory" && (<>
                  <div className="flex flex-wrap gap-3 items-end">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</p>
                      <Select value={assetStatus} onValueChange={setAssetStatus}>
                        <SelectTrigger className="w-[140px] rounded-lg h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Statuses</SelectItem>
                          {Object.values(AssetStatus).map(s => <SelectItem key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase()+s.slice(1)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <DateRange from={assetFrom} to={assetTo} onFrom={setAssetFrom} onTo={setAssetTo} onClear={() => { setAssetFrom(""); setAssetTo(""); }} />
                  </div>
                  <PreviewTable columns={assetPreviewCols} rows={assetPreviewRows} total={assets.length} loading={assetsLoading} />
                  <ExportRow loading={assetsLoading} count={assets.length} label={`asset${assets.length!==1?"s":""}`}
                    onXlsx={() => handleExport(() => exportAssetsXlsx(assets))}
                    onPdf={() => handleExport(() => exportAssetsPdf(assets, { status: assetStatus!=="all"?assetStatus:undefined, from: assetFrom||undefined, to: assetTo||undefined }))} />
                </>)}

                {/* ── Asset History ── */}
                {activeId === "asset_history" && (<>
                  <DateRange from={histFrom} to={histTo} onFrom={setHistFrom} onTo={setHistTo} onClear={() => { setHistFrom(""); setHistTo(""); }} />
                  <PreviewTable columns={histPreviewCols} rows={histPreviewRows} total={historyData.length} loading={historyLoading} />
                  <ExportRow loading={historyLoading} count={historyData.length} label={`entr${historyData.length!==1?"ies":"y"}`}
                    onXlsx={() => handleExport(() => exportAssetHistoryXlsx(historyData))}
                    onPdf={() => handleExport(() => exportAssetHistoryPdf(historyData, { from: histFrom||undefined, to: histTo||undefined }))} />
                </>)}

                {/* ── Unassigned Assets ── */}
                {activeId === "asset_unassigned" && (<>
                  <PreviewTable columns={unassignedPreviewCols} rows={unassignedPreviewRows} total={unassignedAssets.length} loading={assetsLoading} />
                  <ExportRow loading={assetsLoading} count={unassignedAssets.length} label={`unassigned asset${unassignedAssets.length!==1?"s":""}`}
                    onXlsx={() => handleExport(() => exportUnassignedAssetsXlsx(unassignedAssets))}
                    onPdf={() => handleExport(() => exportUnassignedAssetsPdf(unassignedAssets))} />
                </>)}

                {/* ── Asset Depreciation ── */}
                {activeId === "asset_depreciation" && (<>
                  <PreviewTable columns={depPreviewCols} rows={depPreviewRows} total={depreciationAssets.length} loading={assetsLoading} />
                  <ExportRow loading={assetsLoading} count={depreciationAssets.length} label={`asset${depreciationAssets.length!==1?"s":""} with purchase data`}
                    onXlsx={() => handleExport(() => exportDepreciationXlsx(depreciationAssets))}
                    onPdf={() => handleExport(() => exportDepreciationPdf(depreciationAssets))} />
                </>)}

                {/* ── Ticket List ── */}
                {activeId === "ticket_list" && (<>
                  <div className="flex flex-wrap gap-3 items-end">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</p>
                      <Select value={ticketStatus} onValueChange={setTicketStatus}>
                        <SelectTrigger className="w-[140px] rounded-lg h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Statuses</SelectItem>
                          {Object.keys(STATUS_LABEL).map(s => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Priority</p>
                      <Select value={ticketPriority} onValueChange={setTicketPriority}>
                        <SelectTrigger className="w-[140px] rounded-lg h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Priorities</SelectItem>
                          {Object.values(TicketPriority).map(p => <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <DateRange from={ticketFrom} to={ticketTo} onFrom={setTicketFrom} onTo={setTicketTo} onClear={() => { setTicketFrom(""); setTicketTo(""); }} />
                  </div>
                  <PreviewTable columns={ticketPreviewCols} rows={ticketPreviewRows} total={tickets.length} loading={ticketsLoading} />
                  <ExportRow loading={ticketsLoading} count={tickets.length} label={`ticket${tickets.length!==1?"s":""}`}
                    onXlsx={() => handleExport(() => exportTicketsXlsx(tickets))}
                    onPdf={() => handleExport(() => exportTicketsPdf(tickets, { status: ticketStatus!=="all"?ticketStatus:undefined, priority: ticketPriority!=="all"?ticketPriority:undefined, from: ticketFrom||undefined, to: ticketTo||undefined }))} />
                </>)}

                {/* ── Ticket Performance ── */}
                {activeId === "ticket_performance" && (<>
                  <DateRange from={perfFrom} to={perfTo} onFrom={setPerfFrom} onTo={setPerfTo} onClear={() => { setPerfFrom(""); setPerfTo(""); }} />
                  <PreviewTable columns={perfPreviewCols} rows={perfPreviewRows} total={perfTickets.length} loading={allTicketsLoading} />
                  <ExportRow loading={allTicketsLoading} count={perfTickets.length} label={`ticket${perfTickets.length!==1?"s":""}`}
                    onXlsx={() => handleExport(() => exportTicketPerformanceXlsx(perfTickets))}
                    onPdf={() => handleExport(() => exportTicketPerformancePdf(perfTickets, { from: perfFrom||undefined, to: perfTo||undefined }))} />
                </>)}

                {/* ── Ticket Satisfaction ── */}
                {activeId === "ticket_satisfaction" && (<>
                  {avgRating && (
                    <div className="flex items-center gap-2 text-sm bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 px-4 py-2.5 rounded-xl">
                      <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                      <span className="font-semibold text-foreground">{avgRating}/5.0</span>
                      <span className="text-muted-foreground">average across {ratedTickets.length} rated ticket{ratedTickets.length!==1?"s":""}</span>
                    </div>
                  )}
                  <PreviewTable columns={satPreviewCols} rows={satPreviewRows} total={ratedTickets.length} loading={allTicketsLoading} />
                  <ExportRow loading={allTicketsLoading} count={ratedTickets.length} label={`rated ticket${ratedTickets.length!==1?"s":""}`}
                    onXlsx={() => handleExport(() => exportSatisfactionXlsx(ratedTickets))}
                    onPdf={() => handleExport(() => exportSatisfactionPdf(ratedTickets))} />
                </>)}

                {/* ── User Activity ── */}
                {activeId === "user_activity" && (<>
                  <PreviewTable columns={userPreviewCols} rows={userPreviewRows} total={userActivity.length} loading={userActivityLoading} />
                  <ExportRow loading={userActivityLoading} count={userActivity.length} label={`user${userActivity.length!==1?"s":""}`}
                    onXlsx={() => handleExport(() => exportUserActivityXlsx(userActivity))}
                    onPdf={() => handleExport(() => exportUserActivityPdf(userActivity))} />
                </>)}

              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

