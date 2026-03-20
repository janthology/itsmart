import { useGetDashboardStats } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Monitor, TicketIcon, CheckCircle2, AlertCircle, Loader2, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { StatusBadge } from "@/components/ui/status-badge";
import { format } from "date-fns";
import { Link } from "wouter";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

export default function Dashboard() {
  const { data: stats, isLoading, isError } = useGetDashboardStats();

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
    { title: "Total Assets", value: stats.totalAssets, icon: Monitor, color: "text-blue-500", bg: "bg-blue-500/10" },
    { title: "Available Assets", value: stats.availableAssets, icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { title: "Open Tickets", value: stats.openTickets, icon: AlertCircle, color: "text-amber-500", bg: "bg-amber-500/10" },
    { title: "Resolved Tickets", value: stats.resolvedTickets, icon: TicketIcon, color: "text-purple-500", bg: "bg-purple-500/10" },
  ];

  const pieData = [
    { name: 'Available', value: stats.availableAssets, color: 'hsl(var(--success))' },
    { name: 'Assigned', value: stats.assignedAssets, color: 'hsl(var(--primary))' },
    { name: 'Maintenance', value: stats.inMaintenanceAssets, color: 'hsl(var(--warning))' },
  ].filter(d => d.value > 0);

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
  };

  return (
    <AppLayout>
      <motion.div variants={container} initial="hidden" animate="show" className="space-y-8">
        
        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {statCards.map((stat, i) => (
            <motion.div key={i} variants={item}>
              <Card className="border-0 shadow-lg shadow-black/5 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 rounded-2xl overflow-hidden group">
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

          {/* Asset Distribution */}
          <motion.div variants={item}>
            <Card className="border-border/50 shadow-lg shadow-black/5 rounded-2xl h-full">
              <CardHeader className="border-b border-border/50 px-6 py-5">
                <CardTitle className="text-lg font-display">Asset Status</CardTitle>
              </CardHeader>
              <CardContent className="p-6 flex flex-col items-center justify-center min-h-[300px]">
                {pieData.length > 0 ? (
                  <div className="w-full h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {pieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip 
                          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap justify-center gap-4 mt-4">
                      {pieData.map(d => (
                        <div key={d.name} className="flex items-center gap-2 text-sm font-medium">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                          <span>{d.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center">No asset data available.</p>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>

      </motion.div>
    </AppLayout>
  );
}
