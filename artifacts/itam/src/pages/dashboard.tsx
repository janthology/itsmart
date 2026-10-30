import { useState } from "react";
import {
  useGetDashboardStats,
  useGetStaffWorkload,
  useGetTicketTrend,
  useGetAssetAnomalies,
  type Ticket,
} from "@/lib/supabase-queries";
import { useAuth } from "@/lib/auth-context";
import { AppLayout } from "@/components/layout/app-layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  TicketIcon,
  Users,
  AlertTriangle,
  Wrench,
  Archive,
  Zap,
  TrendingUp,
  ChevronRight,
} from "lucide-react";
import { motion } from "framer-motion";
import { StatusBadge } from "@/components/ui/status-badge";
import { format } from "date-fns";
import { Link } from "wouter";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { WelcomeBanner } from "@/components/dashboard/welcome-banner";
import { MetricGrid, buildDashboardMetrics, motionItem } from "@/components/dashboard/metric-cards";
import { AssetStatusPanel } from "@/components/dashboard/asset-status-panel";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { DashboardPanel } from "@/components/dashboard/dashboard-panel";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

const ticketTrendConfig = {
  opened: { label: "Opened", color: "hsl(var(--primary))" },
  resolved: { label: "Resolved", color: "hsl(var(--accent))" },
};

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

function getInitials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function priorityAccent(priority: string) {
  if (priority === "critical") return "bg-red-500";
  if (priority === "high") return "bg-amber-500";
  if (priority === "medium") return "bg-sky-500";
  return "bg-slate-300";
}

function workloadLabel(count: number) {
  if (count >= 5) return { text: "High load", className: "text-red-600 bg-red-50 border-red-100" };
  if (count >= 3) return { text: "Moderate", className: "text-amber-700 bg-amber-50 border-amber-100" };
  if (count > 0) return { text: "Normal", className: "text-emerald-700 bg-emerald-50 border-emerald-100" };
  return { text: "Available", className: "text-muted-foreground bg-muted/50 border-border" };
}

export default function Dashboard() {
  const { data: stats, isLoading, isError } = useGetDashboardStats();
  const { user } = useAuth();
  const isAdmin = user?.role === "administrator";
  const isGeneral = user?.role === "general_user";
  const { data: staffWorkload = [] } = useGetStaffWorkload();
  const [trendWeeks, setTrendWeeks] = useState(8);
  const { data: ticketTrend = [] } = useGetTicketTrend(trendWeeks);
  const { data: assetAnomalies = [] } = useGetAssetAnomalies();

  if (isLoading || !user) return <DashboardSkeleton />;

  if (isError || !stats) {
    return (
      <AppLayout>
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-8 text-center text-destructive">
          Failed to load dashboard. Please refresh the page.
        </div>
      </AppLayout>
    );
  }

  const statsRecord = stats as unknown as Record<string, number>;
  const metrics = buildDashboardMetrics(statsRecord, user.role);

  const ticketsTitle = isGeneral ? "My recent tickets" : "Recent tickets";
  const hasTrendData = !ticketTrend.every((p) => p.opened === 0 && p.resolved === 0);
  const showAdminGrid = isAdmin && (staffWorkload.length > 0 || assetAnomalies.length > 0);

  return (
    <AppLayout>
      <motion.div variants={container} initial="hidden" animate="show" className="space-y-6 md:space-y-8">
        <motion.div variants={motionItem}>
          <WelcomeBanner user={user} />
        </motion.div>

        <motion.div variants={motionItem}>
          <MetricGrid metrics={metrics} />
        </motion.div>

        <div className={cn("grid gap-5", !isGeneral && "lg:grid-cols-5")}>
          <motion.div variants={motionItem} className={!isGeneral ? "lg:col-span-3" : ""}>
            <DashboardPanel
              title={ticketsTitle}
              description="Latest activity in your scope"
              icon={<TicketIcon className="h-4 w-4" />}
              action={{ label: "All tickets", href: "/tickets" }}
              className="h-full"
            >
              {stats.recentTickets.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/[0.06] ring-1 ring-primary/10 mb-4">
                    <TicketIcon className="h-7 w-7 text-primary/40" />
                  </div>
                  <p className="text-sm font-display font-semibold text-foreground">No tickets yet</p>
                  <p className="text-xs text-muted-foreground mt-1.5 max-w-xs leading-relaxed">
                    New support requests will show up here for quick access.
                  </p>
                  <Link
                    href="/tickets"
                    className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    Go to tickets
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>
              ) : (
                <div className="p-2">
                  {stats.recentTickets.map((ticket: Ticket) => (
                    <Link
                      key={ticket.id}
                      href={`/tickets/${ticket.id}`}
                      className="group flex items-stretch rounded-xl transition-colors hover:bg-primary/[0.04]"
                    >
                      <div className={cn("w-1 shrink-0 rounded-full my-2 ml-1", priorityAccent(ticket.priority))} />
                      <div className="flex flex-1 items-center gap-3 px-3 py-3 min-w-0">
                        <Avatar className="h-9 w-9 shrink-0 hidden sm:flex ring-1 ring-border/50">
                          <AvatarFallback className="bg-primary/[0.08] text-primary text-[10px] font-semibold">
                            {getInitials(ticket.createdBy.fullName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                            {ticket.title}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {ticket.createdBy.fullName} · Updated {format(new Date((ticket as any).lastActivityAt ?? ticket.updatedAt ?? ticket.createdAt), "MMM d, yyyy")}
                          </p>
                        </div>
                        {ticket.status === "closed" && (ticket as any).resolvedAt ? (
                          <span className="flex shrink-0 items-center gap-1.5">
                            <StatusBadge status="resolved" />
                            <StatusBadge status="closed" />
                          </span>
                        ) : (
                          <StatusBadge status={ticket.status} />
                        )}
                        <ChevronRight className="h-4 w-4 text-muted-foreground/25 group-hover:text-primary shrink-0 hidden sm:block transition-colors" />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </DashboardPanel>
          </motion.div>

          {!isGeneral && (
            <motion.div variants={motionItem} className="lg:col-span-2">
              <AssetStatusPanel
                totalAssets={stats.totalAssets}
                availableAssets={statsRecord.availableAssets ?? 0}
                inactiveAssets={statsRecord.inactiveAssets ?? 0}
                inMaintenanceAssets={statsRecord.inMaintenanceAssets ?? 0}
                retiredAssets={statsRecord.retiredAssets ?? 0}
              />
            </motion.div>
          )}
        </div>

        <motion.div variants={motionItem}>
            <DashboardPanel
              title="Ticket trends"
              description="Opened vs resolved over time"
              icon={<TrendingUp className="h-4 w-4" />}
              headerExtra={
                <Select value={String(trendWeeks)} onValueChange={(v) => setTrendWeeks(Number(v))}>
                  <SelectTrigger className="h-8 w-[118px] rounded-lg text-xs border-border/60 bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="4">4 weeks</SelectItem>
                    <SelectItem value="8">8 weeks</SelectItem>
                    <SelectItem value="12">3 months</SelectItem>
                    <SelectItem value="24">6 months</SelectItem>
                  </SelectContent>
                </Select>
              }
            >
              {hasTrendData ? (
                <div className="px-5 pb-5 pt-1">
                  <ChartContainer config={ticketTrendConfig} className="h-[252px] w-full aspect-auto">
                    <BarChart
                      data={ticketTrend}
                      margin={{ top: 8, right: 8, left: -8, bottom: 0 }}
                      barCategoryGap="26%"
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/40" />
                      <XAxis dataKey="week" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickMargin={10} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
                      <ChartTooltip content={<ChartTooltipContent />} cursor={{ opacity: 0.25 }} />
                      <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "14px" }} />
                      <Bar dataKey="opened" fill="var(--color-opened)" radius={[5, 5, 0, 0]} maxBarSize={38} />
                      <Bar dataKey="resolved" fill="var(--color-resolved)" radius={[5, 5, 0, 0]} maxBarSize={38} />
                    </BarChart>
                  </ChartContainer>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
                  <TrendingUp className="h-6 w-6 text-primary/30" />
                  <p className="mt-3 text-sm font-display font-semibold text-foreground">No trend data in this period</p>
                  <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                    No tickets were opened or resolved in the selected range. Try a longer period above.
                  </p>
                </div>
              )}
            </DashboardPanel>
          </motion.div>

        {showAdminGrid && (
          <div className="grid gap-5 lg:grid-cols-2">
            {staffWorkload.length > 0 && (
              <motion.div variants={motionItem}>
                <DashboardPanel
                  title="Team workload"
                  description="Active tickets per assignee (support staff and administrators)"
                  icon={<Users className="h-4 w-4" />}
                  action={{ label: "Tickets", href: "/tickets" }}
                >
                  <div className="divide-y divide-border/50">
                    {staffWorkload.map((staff) => {
                      const max = Math.max(...staffWorkload.map((s) => s.totalActive), 1);
                      const pct = Math.round((staff.totalActive / max) * 100);
                      const load = workloadLabel(staff.totalActive);
                      const barColor =
                        staff.totalActive >= 5
                          ? "bg-red-500"
                          : staff.totalActive >= 3
                            ? "bg-amber-500"
                            : "bg-emerald-500";

                      return (
                        <div key={staff.id} className="flex items-center gap-3 px-4 py-3.5">
                          <Avatar className="h-9 w-9 shrink-0 ring-1 ring-border/50">
                            <AvatarFallback className="bg-primary/[0.08] text-primary text-xs font-bold">
                              {staff.fullName.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium truncate">{staff.fullName}</span>
                              <div className="flex items-center gap-2 shrink-0">
                                <span
                                  className={cn(
                                    "text-[10px] font-semibold px-2 py-0.5 rounded-md border",
                                    load.className
                                  )}
                                >
                                  {load.text}
                                </span>
                                <span className="text-sm font-display font-bold tabular-nums w-5 text-right">
                                  {staff.totalActive}
                                </span>
                              </div>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted/80 overflow-hidden">
                              <div
                                className={cn("h-full rounded-full transition-all duration-700", barColor)}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </DashboardPanel>
              </motion.div>
            )}

            {assetAnomalies.length > 0 && (
              <motion.div variants={motionItem}>
                <DashboardPanel
                  title={`Asset alerts (${assetAnomalies.length})`}
                  description="Items requiring review"
                  icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
                  action={{ label: "Assets", href: "/assets" }}
                  accent="warning"
                >
                  <div className="divide-y divide-border/50 max-h-[300px] overflow-y-auto">
                    {assetAnomalies.slice(0, 6).map((anomaly) => {
                      const icons = {
                        frequent_reassignment: Zap,
                        long_maintenance: Wrench,
                        inactive_long: Archive,
                        end_of_life: AlertTriangle,
                        pm_overdue: Wrench,
                      };
                      const Icon = icons[anomaly.type];
                      const critical = anomaly.severity === "critical";

                      return (
                        <Link
                          key={`${anomaly.assetId}-${anomaly.type}`}
                          href={`/assets/${anomaly.assetId}`}
                          className="flex items-start gap-3 px-4 py-3.5 hover:bg-muted/30 transition-colors group"
                        >
                          <div
                            className={cn(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg mt-0.5",
                              critical ? "bg-red-500/10" : "bg-amber-500/10"
                            )}
                          >
                            <Icon
                              className={cn(
                                "h-4 w-4",
                                critical ? "text-red-500" : "text-amber-600"
                              )}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                              {anomaly.assetName}
                              {critical && (
                                <span className="ml-2 text-[10px] font-bold uppercase text-red-500">
                                  Critical
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                              {anomaly.message}
                            </p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground/25 group-hover:text-primary shrink-0 mt-1" />
                        </Link>
                      );
                    })}
                  </div>
                </DashboardPanel>
              </motion.div>
            )}
          </div>
        )}
      </motion.div>
    </AppLayout>
  );
}
