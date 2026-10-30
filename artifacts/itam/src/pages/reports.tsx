import { useState, useMemo } from "react";
import {
  useGetAssets, useGetTickets, useGetAssetHistoryAll, useGetUserActivity, useGetAllTicketsForReport,
  AssetStatus, TicketStatus, TicketPriority,
} from "@/lib/supabase-queries";
import { useAuth } from "@/lib/auth-context";
import { AppLayout } from "@/components/layout/app-layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, MonitorSmartphone, TicketIcon,
  History, Users, PackageX, TrendingDown, Star, Gauge, BarChart3, Filter,
  FileSpreadsheet, CheckCircle2, AlertTriangle, Clock,
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
import { SLA_HOURS } from "@/lib/sla";
import { ReportPreviewTable, PREVIEW_ROWS } from "@/components/reports/report-preview-table";
import { ReportDateRange } from "@/components/reports/report-date-range";
import { ReportExportBar } from "@/components/reports/report-export-bar";
import { ReportNav, type ReportDef, type ReportId, GROUP_LABELS } from "@/components/reports/report-nav";

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  open: "Open", in_progress: "In Progress", on_hold: "On Hold", resolved: "Resolved", closed: "Closed",
};
const PRIORITY_LABEL: Record<string, string> = {
  critical: "Critical - 1", high: "High - 2", medium: "Medium - 3", low: "Low - 4",
};

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

const REPORT_DEFS: ReportDef[] = [
  { id: "asset_inventory", label: "Inventory", icon: MonitorSmartphone, group: "assets", roles: ["administrator", "support_staff"], description: "Full asset list with status, location, assignment, and purchase info." },
  { id: "asset_history", label: "History", icon: History, group: "assets", roles: ["administrator"], description: "Audit trail of assignments, unassignments, and field changes." },
  { id: "asset_unassigned", label: "Unassigned", icon: PackageX, group: "assets", roles: ["administrator"], description: "Assets without an assigned user — useful for utilization reviews." },
  { id: "asset_depreciation", label: "Depreciation", icon: TrendingDown, group: "assets", roles: ["administrator"], description: "Straight-line depreciation over 5 years with estimated current value." },
  { id: "ticket_list", label: "Tickets", icon: TicketIcon, group: "tickets", roles: ["administrator", "support_staff", "general_user"], description: "Support tickets filtered by status, priority, and date." },
  { id: "ticket_performance", label: "Performance", icon: Gauge, group: "tickets", roles: ["administrator", "support_staff"], description: "Resolution time vs SLA target — Met or Breached per ticket." },
  { id: "ticket_satisfaction", label: "Satisfaction", icon: Star, group: "tickets", roles: ["administrator", "support_staff"], description: "User satisfaction ratings with average score and comments." },
  { id: "user_activity", label: "User activity", icon: Users, group: "admin", roles: ["administrator"], description: "Users with role, status, assets assigned, and ticket activity." },
];

// ─── Main component ───────────────────────────────────────────────────────────

export default function Reports() {
  const { toast } = useToast();
  const { user } = useAuth();
  const role = (user?.role ?? "general_user") as "administrator" | "support_staff" | "general_user";
  const isSupport = role === "support_staff";
  const isGeneral = role === "general_user";

  const visibleReports = REPORT_DEFS.filter(r => r.roles.includes(role));
  const [activeId, setActiveId] = useState<ReportId>(visibleReports[0]?.id ?? "ticket_list");
  const active = REPORT_DEFS.find(r => r.id === activeId)!;

  const handleExport = async (fn: () => Promise<void>) => {
    try { await fn(); toast({ title: "Export successful", description: "Your file has been downloaded." }); }
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
  const needsAssets = ["asset_inventory", "asset_unassigned", "asset_depreciation"].includes(activeId);
  const needsTickets = activeId === "ticket_list";
  const needsHistory = activeId === "asset_history";
  const needsAllTickets = ["ticket_performance", "ticket_satisfaction"].includes(activeId);
  const needsUserActivity = activeId === "user_activity";

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
  const { data: allTicketsData = [], isLoading: allTicketsLoading } = useGetAllTicketsForReport({ enabled: needsAllTickets });
  const { data: userActivity = [], isLoading: userActivityLoading } = useGetUserActivity({ enabled: needsUserActivity });

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

  const slaStats = useMemo(() => {
    let met = 0;
    let breached = 0;
    let pending = 0;
    for (const t of perfTickets) {
      const target = SLA_HOURS[t.priority] ?? 24;
      const resMs = t.resolvedAt ? new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime() : null;
      const resH = resMs != null ? resMs / 3600000 : null;
      if (resH == null) pending++;
      else if (resH <= target) met++;
      else breached++;
    }
    return { met, breached, pending };
  }, [perfTickets]);

  const activeCount = useMemo(() => {
    switch (activeId) {
      case "asset_inventory": return assets.length;
      case "asset_history": return historyData.length;
      case "asset_unassigned": return unassignedAssets.length;
      case "asset_depreciation": return depreciationAssets.length;
      case "ticket_list": return tickets.length;
      case "ticket_performance": return perfTickets.length;
      case "ticket_satisfaction": return ratedTickets.length;
      case "user_activity": return userActivity.length;
      default: return 0;
    }
  }, [activeId, assets, historyData, unassignedAssets, depreciationAssets, tickets, perfTickets, ratedTickets, userActivity]);

  const activeLoading = useMemo(() => {
    switch (activeId) {
      case "asset_inventory":
      case "asset_unassigned":
      case "asset_depreciation":
        return assetsLoading;
      case "asset_history": return historyLoading;
      case "ticket_list": return ticketsLoading;
      case "ticket_performance":
      case "ticket_satisfaction":
        return allTicketsLoading;
      case "user_activity": return userActivityLoading;
      default: return false;
    }
  }, [activeId, assetsLoading, historyLoading, ticketsLoading, allTicketsLoading, userActivityLoading]);

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
    t.ticketNumber ?? `#${t.id.substring(0, 8)}`, t.title,
    t.status.replace(/_/g, " "), t.priority,
    t.createdBy?.fullName ?? null, t.assignedTo?.fullName ?? "—",
    format(new Date(t.createdAt), "MMM d, yyyy"),
  ]);

  const perfPreviewCols = ["Ticket No.", "Title", "Priority", "Assigned To", "Created", "Resolved", "Res. Time (h)", "SLA (h)", "SLA Status"];
  const perfPreviewRows = perfTickets.slice(0, PREVIEW_ROWS).map((t: any) => {
    const target = SLA_HOURS[t.priority] ?? 24;
    const resMs = t.resolvedAt ? new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime() : null;
    const resH = resMs != null ? +(resMs / 3600000).toFixed(2) : null;
    return [
      t.ticketNumber ?? `#${t.id.substring(0, 8)}`, t.title, t.priority,
      t.assignedTo?.fullName ?? "—",
      format(new Date(t.createdAt), "MMM d, yyyy"),
      t.resolvedAt ? format(new Date(t.resolvedAt), "MMM d, yyyy") : null,
      resH, target,
      resH == null ? "Pending" : resH <= target ? "Met" : "Breached",
    ];
  });

  const satPreviewCols = ["Ticket No.", "Title", "Priority", "Assigned To", "Rating", "Comment"];
  const satPreviewRows = ratedTickets.slice(0, PREVIEW_ROWS).map((t: any) => [
    t.ticketNumber ?? `#${t.id.substring(0, 8)}`, t.title, t.priority,
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
    const ageYears = +(ageMs / (1000 * 60 * 60 * 24 * 365.25)).toFixed(2);
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
    u.fullName, u.role.replace(/_/g, " "), u.department ?? null,
    u.isActive ? "Active" : "Inactive",
    u.assetsAssigned, u.ticketsCreated, u.ticketsResolved,
  ]);

  const groups = (["assets", "tickets", "admin"] as const).map(g => ({
    key: g,
    label: GROUP_LABELS[g],
    reports: visibleReports.filter(r => r.group === g),
  })).filter(g => g.reports.length > 0);

  const ActiveIcon = active.icon;

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Page hero */}
        <section className="relative overflow-hidden rounded-2xl border border-primary/25 shadow-[0_10px_40px_rgba(53,88,114,0.16)]">
          <div className="absolute inset-0 bg-gradient-to-br from-primary via-[hsl(207_38%_27%)] to-[hsl(207_55%_36%)]" />
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.28]"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.14) 1px, transparent 0)",
              backgroundSize: "20px 20px",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-accent/20 blur-3xl"
          />

          <div className="relative flex flex-col gap-5 p-6 md:flex-row md:items-center md:justify-between md:p-8">
            <div className="flex items-start gap-4 min-w-0">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white ring-1 ring-white/20 shadow-lg backdrop-blur-sm">
                <BarChart3 className="h-7 w-7" />
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl md:text-3xl font-display font-bold tracking-tight text-white leading-tight">
                  Reports &amp; exports
                </h1>
                <p className="mt-1.5 text-sm text-white/75 max-w-xl leading-relaxed">
                  Choose a report, apply filters, preview the data, then download as Excel or PDF.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 backdrop-blur-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/60">Available</p>
                <p className="text-xl font-display font-bold text-white tabular-nums">
                  {visibleReports.length}
                  <span className="text-sm font-medium text-white/70 ml-1">
                    report{visibleReports.length === 1 ? "" : "s"}
                  </span>
                </p>
              </div>
              <div className="hidden sm:flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 backdrop-blur-sm text-white/80">
                <FileSpreadsheet className="h-4 w-4 text-accent" />
                <span className="text-xs font-medium">Excel &amp; PDF export</span>
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(240px,280px)_1fr] gap-6 items-start">
          {/* Report picker */}
          <aside className="lg:sticky lg:top-20">
            <ReportNav groups={groups} activeId={activeId} onSelect={setActiveId} />
          </aside>

          {/* Active report panel */}
          <div className="min-w-0 space-y-5">
            {/* Report header + quick stats */}
            <div className="rounded-2xl border border-border/60 bg-card shadow-[0_4px_24px_rgba(53,88,114,0.06)] overflow-hidden">
              <div className="relative border-b border-border/50 overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.05] via-card to-accent/[0.03]" />
                <div
                  aria-hidden
                  className="absolute inset-0 opacity-[0.35]"
                  style={{
                    backgroundImage:
                      "radial-gradient(circle at 1px 1px, rgba(53,88,114,0.05) 1px, transparent 0)",
                    backgroundSize: "18px 18px",
                  }}
                />

                <div className="relative p-5 md:p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15 shadow-sm">
                      <ActiveIcon className="w-5 h-5" />
                    </div>

                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <h2 className="text-xl font-display font-bold text-foreground tracking-tight">
                          {active.label}
                        </h2>

                        {activeLoading ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-xs text-muted-foreground">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                            Loading…
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/[0.08] px-3 py-1 text-xs font-semibold text-primary tabular-nums">
                            {activeCount} record{activeCount === 1 ? "" : "s"}
                          </span>
                        )}

                        {isGeneral && active.id === "ticket_list" && (
                          <Badge variant="secondary" className="text-[10px] rounded-md">Your tickets only</Badge>
                        )}
                        {isSupport && ["ticket_list", "ticket_performance", "ticket_satisfaction"].includes(active.id) && (
                          <Badge variant="secondary" className="text-[10px] rounded-md">Assigned to you</Badge>
                        )}
                      </div>

                      <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
                        {active.description}
                      </p>
                    </div>
                  </div>

                  {/* Contextual insight chips */}
                  {!activeLoading && activeId === "ticket_performance" && perfTickets.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-5 pt-5 border-t border-border/40">
                      <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-700 border border-emerald-200/60 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {slaStats.met} SLA met
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-700 border border-red-200/60 font-medium">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {slaStats.breached} breached
                      </span>
                      {slaStats.pending > 0 && (
                        <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-slate-500/10 text-slate-600 border border-slate-200/60 font-medium">
                          <Clock className="w-3.5 h-3.5" />
                          {slaStats.pending} pending
                        </span>
                      )}
                    </div>
                  )}
                  {!activeLoading && activeId === "ticket_satisfaction" && avgRating && (
                    <div className="flex items-center gap-3 mt-5 pt-5 border-t border-border/40">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 ring-1 ring-amber-200/50">
                        <Star className="w-5 h-5 text-amber-500 fill-amber-400" />
                      </div>
                      <div>
                        <p className="text-lg font-display font-bold text-foreground">{avgRating}/5.0</p>
                        <p className="text-xs text-muted-foreground">Average from {ratedTickets.length} rated tickets</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="p-5 md:p-6 space-y-5">
                {/* Filters toolbar */}
                {(activeId === "asset_inventory" || activeId === "ticket_list" || activeId === "asset_history" || activeId === "ticket_performance") && (
                  <div className="rounded-xl border border-border/60 bg-gradient-to-br from-muted/30 to-muted/10 p-4 md:p-5 space-y-4">
                    <p className="text-xs font-semibold text-foreground flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Filter className="w-3.5 h-3.5" />
                      </span>
                      Report filters
                    </p>

                    {activeId === "asset_inventory" && (
                      <div className="flex flex-col gap-4">
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-muted-foreground">Status</label>
                          <Select value={assetStatus} onValueChange={setAssetStatus}>
                            <SelectTrigger className="w-full sm:w-[180px] rounded-xl h-9 text-sm border-border/60">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All statuses</SelectItem>
                              {Object.values(AssetStatus).map(s => (
                                <SelectItem key={s} value={s} className="capitalize">
                                  {s.charAt(0).toUpperCase() + s.slice(1)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <ReportDateRange
                          from={assetFrom} to={assetTo}
                          onFrom={setAssetFrom} onTo={setAssetTo}
                          onClear={() => { setAssetFrom(""); setAssetTo(""); }}
                        />
                      </div>
                    )}

                    {activeId === "asset_history" && (
                      <ReportDateRange
                        from={histFrom} to={histTo}
                        onFrom={setHistFrom} onTo={setHistTo}
                        onClear={() => { setHistFrom(""); setHistTo(""); }}
                      />
                    )}

                    {activeId === "ticket_list" && (
                      <div className="space-y-4">
                        <div className="flex flex-wrap gap-3">
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Status</label>
                            <Select value={ticketStatus} onValueChange={setTicketStatus}>
                              <SelectTrigger className="w-[160px] rounded-xl h-9 text-sm border-border/60"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">All statuses</SelectItem>
                                {Object.keys(STATUS_LABEL).map(s => (
                                  <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Priority</label>
                            <Select value={ticketPriority} onValueChange={setTicketPriority}>
                              <SelectTrigger className="w-[160px] rounded-xl h-9 text-sm border-border/60"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">All priorities</SelectItem>
                                {Object.values(TicketPriority).map(p => (
                                  <SelectItem key={p} value={p}>{PRIORITY_LABEL[p]}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <ReportDateRange
                          from={ticketFrom} to={ticketTo}
                          onFrom={setTicketFrom} onTo={setTicketTo}
                          onClear={() => { setTicketFrom(""); setTicketTo(""); }}
                        />
                      </div>
                    )}

                    {activeId === "ticket_performance" && (
                      <ReportDateRange
                        from={perfFrom} to={perfTo}
                        onFrom={setPerfFrom} onTo={setPerfTo}
                        onClear={() => { setPerfFrom(""); setPerfTo(""); }}
                      />
                    )}
                  </div>
                )}

                {/* Preview */}
                <div className="space-y-3">
                  {activeId === "asset_inventory" && (
                    <ReportPreviewTable columns={assetPreviewCols} rows={assetPreviewRows} total={assets.length} loading={assetsLoading} />
                  )}
                  {activeId === "asset_history" && (
                    <ReportPreviewTable columns={histPreviewCols} rows={histPreviewRows} total={historyData.length} loading={historyLoading} />
                  )}
                  {activeId === "asset_unassigned" && (
                    <ReportPreviewTable columns={unassignedPreviewCols} rows={unassignedPreviewRows} total={unassignedAssets.length} loading={assetsLoading} />
                  )}
                  {activeId === "asset_depreciation" && (
                    <ReportPreviewTable columns={depPreviewCols} rows={depPreviewRows} total={depreciationAssets.length} loading={assetsLoading} />
                  )}
                  {activeId === "ticket_list" && (
                    <ReportPreviewTable columns={ticketPreviewCols} rows={ticketPreviewRows} total={tickets.length} loading={ticketsLoading} />
                  )}
                  {activeId === "ticket_performance" && (
                    <ReportPreviewTable columns={perfPreviewCols} rows={perfPreviewRows} total={perfTickets.length} loading={allTicketsLoading} />
                  )}
                  {activeId === "ticket_satisfaction" && (
                    <ReportPreviewTable columns={satPreviewCols} rows={satPreviewRows} total={ratedTickets.length} loading={allTicketsLoading} />
                  )}
                  {activeId === "user_activity" && (
                    <ReportPreviewTable columns={userPreviewCols} rows={userPreviewRows} total={userActivity.length} loading={userActivityLoading} />
                  )}
                </div>

                {/* Export */}
                {activeId === "asset_inventory" && (
                  <ReportExportBar loading={assetsLoading} count={assets.length} label={`asset${assets.length !== 1 ? "s" : ""}`}
                    onXlsx={() => handleExport(() => exportAssetsXlsx(assets))}
                    onPdf={() => handleExport(() => exportAssetsPdf(assets, { status: assetStatus !== "all" ? assetStatus : undefined, from: assetFrom || undefined, to: assetTo || undefined }))} />
                )}
                {activeId === "asset_history" && (
                  <ReportExportBar loading={historyLoading} count={historyData.length} label={`entr${historyData.length !== 1 ? "ies" : "y"}`}
                    onXlsx={() => handleExport(() => exportAssetHistoryXlsx(historyData))}
                    onPdf={() => handleExport(() => exportAssetHistoryPdf(historyData, { from: histFrom || undefined, to: histTo || undefined }))} />
                )}
                {activeId === "asset_unassigned" && (
                  <ReportExportBar loading={assetsLoading} count={unassignedAssets.length} label={`unassigned asset${unassignedAssets.length !== 1 ? "s" : ""}`}
                    onXlsx={() => handleExport(() => exportUnassignedAssetsXlsx(unassignedAssets))}
                    onPdf={() => handleExport(() => exportUnassignedAssetsPdf(unassignedAssets))} />
                )}
                {activeId === "asset_depreciation" && (
                  <ReportExportBar loading={assetsLoading} count={depreciationAssets.length} label={`asset${depreciationAssets.length !== 1 ? "s" : ""} with purchase data`}
                    onXlsx={() => handleExport(() => exportDepreciationXlsx(depreciationAssets))}
                    onPdf={() => handleExport(() => exportDepreciationPdf(depreciationAssets))} />
                )}
                {activeId === "ticket_list" && (
                  <ReportExportBar loading={ticketsLoading} count={tickets.length} label={`ticket${tickets.length !== 1 ? "s" : ""}`}
                    onXlsx={() => handleExport(() => exportTicketsXlsx(tickets))}
                    onPdf={() => handleExport(() => exportTicketsPdf(tickets, { status: ticketStatus !== "all" ? ticketStatus : undefined, priority: ticketPriority !== "all" ? ticketPriority : undefined, from: ticketFrom || undefined, to: ticketTo || undefined }))} />
                )}
                {activeId === "ticket_performance" && (
                  <ReportExportBar loading={allTicketsLoading} count={perfTickets.length} label={`ticket${perfTickets.length !== 1 ? "s" : ""}`}
                    onXlsx={() => handleExport(() => exportTicketPerformanceXlsx(perfTickets))}
                    onPdf={() => handleExport(() => exportTicketPerformancePdf(perfTickets, { from: perfFrom || undefined, to: perfTo || undefined }))} />
                )}
                {activeId === "ticket_satisfaction" && (
                  <ReportExportBar loading={allTicketsLoading} count={ratedTickets.length} label={`rated ticket${ratedTickets.length !== 1 ? "s" : ""}`}
                    onXlsx={() => handleExport(() => exportSatisfactionXlsx(ratedTickets))}
                    onPdf={() => handleExport(() => exportSatisfactionPdf(ratedTickets))} />
                )}
                {activeId === "user_activity" && (
                  <ReportExportBar loading={userActivityLoading} count={userActivity.length} label={`user${userActivity.length !== 1 ? "s" : ""}`}
                    onXlsx={() => handleExport(() => exportUserActivityXlsx(userActivity))}
                    onPdf={() => handleExport(() => exportUserActivityPdf(userActivity))} />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
