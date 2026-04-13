import { useGetDashboardStats, useGetStaffWorkload, useGetTicketTrend } from "@/lib/supabase-queries";
import { useAuth } from "@/lib/auth-context";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Monitor, TicketIcon, CheckCircle2, AlertCircle, Loader2, ArrowRight, PackageX, Clock, Users } from "lucide-react";
import { motion } from "framer-motion";
import { StatusBadge } from "@/components/ui/status-badge";
import { format } from "date-fns";
import { Link } from "wouter";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

export default function Dashboard() {
  const { data: stats, isLoading, isError } = useGetDashboardStats();
  const { user } = useAuth();
  const isAdmin = user?.role === 'administrator';
  const { data: staffWorkload = [] } = useGetStaffWorkload();
  const { data: ticketTrend = [] } = useGetTicketTrend(8);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex h-[60vh] items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (isError || !stats) {
    return (
      <AppLayout>
        <div className="text-center text-destructive p-8 bg-destructive/10 rounded-2xl border border-destructive/20">
          Failed to load dashboard statistics.
        </div>
      </AppLayout>
    );
  }

  const statCards = [
    { title: "Total Assets",        value: stats.totalAssets,                    icon: Monitor,       color: "text-indigo-500",  bg: "bg-indigo-500/10",  href: "/assets" },
    { title: "Active Assets",       value: (stats as any).assignedAssets ?? 0,   icon: CheckCircle2,  color: "text-blue-500",    bg: "bg-blue-500/10",    href: "/assets?status=active" },
    { title: "Inactive Assets",     value: (stats as any).inactiveAssets ?? 0,   icon: PackageX,      color: "text-slate-500",   bg: "bg-slate-500/10",   href: "/assets?status=inactive" },
    { title: "Open Tickets",        value: stats.openTickets,                    icon: AlertCircle,   color: "text-amber-500",   bg: "bg-amber-500/10",   href: "/tickets?status=open" },
    { title: "In Progress Tickets", value: (stats as any).inProgressTickets ?? 0,icon: Clock,         color: "text-sky-500",     bg: "bg-sky-500/10",     href: "/tickets?status=in_progress" },
    { title: "Resolved & Closed",   value: stats.resolvedTickets,                icon: TicketIcon,    color: "text-emerald-500", bg: "bg-emerald-500/10", href: "/tickets" },
  ];

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } }
  };

  return (
    <AppLayout>
      <motion.div variants={container} initial="hidden" animate="show" className="space-y-8">
        <PageHeader title="Dashboard" subtitle="Overview of your IT assets and support tickets" />
        
        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {statCards.map((stat, i) => (
            <motion.div key={i} variants={item}>
              <Link href={stat.href}>
                <Card className="border-0 shadow-lg shadow-black/5 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 rounded-2xl overflow-hidden group cursor-pointer">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
                        <p className="text-3xl font-display font-bold text-foreground">{stat.value}</p>
                      </div>
                      <div className={`w-12 h-12 rounded-2xl ${stat.bg} flex items-center justify-center group-hover:scale-110 transition-transform duration-300`}>
                        <stat.icon className={`w-6 h-6 ${stat.color}`} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Recent Tickets */}
          <motion.div variants={item} className="lg:col-span-2">
            <Card className="border-border/50 shadow-lg shadow-black/5 rounded-2xl h-full flex flex-col">
              <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-border/50 px-6 py-5">
                <CardTitle className="text-lg font-display">Recent Tickets</CardTitle>
                <Link href="/tickets" className="text-sm font-medium text-primary hover:text-primary/80 flex items-center gap-1 group">
                  View all <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Link>
              </CardHeader>
              <CardContent className="p-0 flex-1 flex flex-col">
                {stats.recentTickets.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center p-8 text-muted-foreground">
                    No recent tickets found.
                  </div>
                ) : (
                  <div className="divide-y divide-border/50">
                    {stats.recentTickets.map((ticket) => (
                      <Link key={ticket.id} href={`/tickets/${ticket.id}`} className="flex items-center justify-between p-4 px-6 hover:bg-muted/50 transition-colors">
                        <div className="space-y-1 truncate pr-4">
                          <p className="font-semibold text-foreground truncate">{ticket.title}</p>
                          <p className="text-xs text-muted-foreground flex gap-2 items-center">
                            <span>{ticket.createdBy.fullName}</span>
                            <span>•</span>
                            <span>{format(new Date(ticket.createdAt), 'MMM d, yyyy')}</span>
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <StatusBadge status={ticket.priority} className="hidden sm:inline-flex" />
                          <StatusBadge status={ticket.status} />
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Asset Status Breakdown */}
          <motion.div variants={item}>
            <Card className="border-border/50 shadow-lg shadow-black/5 rounded-2xl h-full">
              <CardHeader className="border-b border-border/50 px-6 py-5">
                <CardTitle className="text-lg font-display">Asset Status</CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                {[
                  { label: 'Active',      value: (stats as any).availableAssets ?? 0,    color: 'bg-blue-500',    text: 'text-blue-600' },
                  { label: 'Inactive',    value: (stats as any).inactiveAssets ?? 0,     color: 'bg-slate-400',   text: 'text-slate-500' },
                  { label: 'Maintenance', value: (stats as any).inMaintenanceAssets ?? 0, color: 'bg-amber-500',  text: 'text-amber-600' },
                  { label: 'Retired',     value: (stats as any).retiredAssets ?? 0,      color: 'bg-red-400',     text: 'text-red-500' },
                ].map(({ label, value, color, text }) => {
                  const pct = stats.totalAssets > 0 ? Math.round((value / stats.totalAssets) * 100) : 0;
                  return (
                    <div key={label} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-foreground">{label}</span>
                        <span className={`font-bold ${text}`}>{value} <span className="text-muted-foreground font-normal text-xs">({pct}%)</span></span>
                      </div>
                      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                <div className="pt-3 border-t border-border/50 flex justify-between text-sm">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-bold text-foreground">{stats.totalAssets}</span>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Ticket Trend Chart */}
        <motion.div variants={item}>
          <Card className="border-border/50 shadow-lg shadow-black/5 rounded-2xl">
            <CardHeader className="border-b border-border/50 px-6 py-5">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-display flex items-center gap-2">
                  <TicketIcon className="w-5 h-5 text-primary" /> Ticket Trends
                </CardTitle>
                {ticketTrend.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {ticketTrend[0]?.week} – {ticketTrend[ticketTrend.length - 1]?.week}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-6">
              {ticketTrend.every(p => p.opened === 0 && p.resolved === 0) ? (
                <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                  No ticket data available yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={ticketTrend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }} barCategoryGap="30%">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="week" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ borderRadius: '12px', border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', color: 'hsl(var(--foreground))' }}
                      cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '12px' }} />
                    <Bar dataKey="opened" name="Opened" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="resolved" name="Resolved" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Support Staff Workload — admin only */}
        {isAdmin && staffWorkload.length > 0 && (
          <motion.div variants={item}>
            <Card className="border-border/50 shadow-lg shadow-black/5 rounded-2xl">
              <CardHeader className="border-b border-border/50 px-6 py-5 flex flex-row items-center justify-between">
                <CardTitle className="text-lg font-display flex items-center gap-2">
                  <Users className="w-5 h-5 text-primary" /> Support Staff Workload
                </CardTitle>
                <Link href="/tickets" className="text-sm font-medium text-primary hover:text-primary/80 flex items-center gap-1 group">
                  View tickets <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Link>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border/50">
                  {staffWorkload.map((staff) => {
                    const maxTotal = Math.max(...staffWorkload.map(s => s.totalActive), 1);
                    const pct = Math.round((staff.totalActive / maxTotal) * 100);
                    return (
                      <div key={staff.id} className="flex items-center gap-4 px-6 py-4">
                        <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">
                          {staff.fullName.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm text-foreground truncate">{staff.fullName}</span>
                            <div className="flex items-center gap-2 shrink-0 text-xs">
                              <span className="bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300 px-2 py-0.5 rounded-md border border-sky-200 dark:border-sky-700">
                                {staff.inProgressCount} in progress
                              </span>
                              {staff.onHoldCount > 0 && (
                                <span className="bg-neutral-200 text-neutral-700 dark:bg-neutral-700/30 dark:text-neutral-300 px-2 py-0.5 rounded-md border border-neutral-300 dark:border-neutral-600">
                                  {staff.onHoldCount} on hold
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${staff.totalActive === 0 ? 'bg-muted-foreground/20' : staff.totalActive >= 5 ? 'bg-red-400' : staff.totalActive >= 3 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-sm font-bold text-foreground shrink-0 w-6 text-right">{staff.totalActive}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

      </motion.div>
    </AppLayout>
  );
}
