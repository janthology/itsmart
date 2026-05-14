import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useGetAssets, useGetTickets } from "@/lib/supabase-queries";
import { useAuth } from "@/lib/auth-context";
import { AppLayout } from "@/components/layout/app-layout";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft, ChevronRight, Wrench, TicketIcon,
  AlertTriangle, Clock, CheckCircle2,
} from "lucide-react";
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, subMonths, isSameMonth, isSameDay, isToday,
  addDays, parseISO,
} from "date-fns";
import { SLA_HOURS } from "@/lib/sla";
import { cn } from "@/lib/utils";

// ─── Event types ──────────────────────────────────────────────────────────────

type CalendarEventType =
  | 'ticket_open'
  | 'ticket_due'       // SLA deadline
  | 'ticket_resolved'
  | 'pm_due'           // next_pm_date
  | 'asset_eol';       // end of life

interface CalendarEvent {
  id: string;
  date: Date;
  type: CalendarEventType;
  title: string;
  subtitle?: string;
  href: string;
}

const EVENT_STYLES: Record<CalendarEventType, { dot: string; badge: string; icon: React.ElementType }> = {
  ticket_open:     { dot: 'bg-amber-400',   badge: 'bg-amber-100 text-amber-800 border-amber-200',   icon: TicketIcon },
  ticket_due:      { dot: 'bg-red-500',     badge: 'bg-red-100 text-red-800 border-red-200',         icon: Clock },
  ticket_resolved: { dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-800 border-emerald-200', icon: CheckCircle2 },
  pm_due:          { dot: 'bg-blue-500',    badge: 'bg-blue-100 text-blue-800 border-blue-200',      icon: Wrench },
  asset_eol:       { dot: 'bg-orange-500',  badge: 'bg-orange-100 text-orange-800 border-orange-200', icon: AlertTriangle },
};

const USEFUL_LIFE: Record<string, number> = {
  laptop: 4, desktop: 5, monitor: 6, printer: 5,
  server: 6, phone: 3, tablet: 3, networking: 7,
  peripheral: 4, other: 5,
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function CalendarPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'administrator';
  const isSupport = user?.role === 'support_staff';
  const [, setLocation] = useLocation();

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  // Fetch data
  const ticketQuery: any = {};
  if (!isAdmin && !isSupport) ticketQuery.createdBy = user?.id;
  if (isSupport) ticketQuery.assignedTo = user?.id;
  const { data: ticketsData } = useGetTickets({ query: ticketQuery });
  const { data: assetsData } = useGetAssets();

  // Build events
  const events = useMemo<CalendarEvent[]>(() => {
    const evts: CalendarEvent[] = [];
    const tickets = ticketsData?.data ?? [];
    const assets = assetsData?.data ?? [];

    for (const t of tickets) {
      // Ticket created
      evts.push({
        id: `t-open-${t.id}`,
        date: parseISO(t.createdAt),
        type: 'ticket_open',
        title: t.title,
        subtitle: `${t.priority} priority`,
        href: `/tickets/${t.id}`,
      });

      // SLA deadline (only for open/in-progress)
      if (!['resolved', 'closed', 'on_hold'].includes(t.status)) {
        const targetHours = SLA_HOURS[t.priority] ?? 24;
        const deadline = new Date(parseISO(t.createdAt).getTime() + targetHours * 60 * 60 * 1000);
        evts.push({
          id: `t-due-${t.id}`,
          date: deadline,
          type: 'ticket_due',
          title: `SLA: ${t.title}`,
          subtitle: `Due ${format(deadline, 'h:mm a')}`,
          href: `/tickets/${t.id}`,
        });
      }

      // Resolved date
      if ((t as any).resolvedAt) {
        evts.push({
          id: `t-res-${t.id}`,
          date: parseISO((t as any).resolvedAt),
          type: 'ticket_resolved',
          title: t.title,
          subtitle: 'Resolved',
          href: `/tickets/${t.id}`,
        });
      }
    }

    if (isAdmin || isSupport) {
      for (const a of assets) {
        // Next PM date
        if ((a as any).nextPmDate) {
          evts.push({
            id: `a-pm-${a.id}`,
            date: parseISO((a as any).nextPmDate),
            type: 'pm_due',
            title: `PM: ${a.name}`,
            subtitle: a.assetTag,
            href: `/assets/${a.id}`,
          });
        }

        // End of life
        if (a.purchaseDate && a.status !== 'retired') {
          const usefulLife = USEFUL_LIFE[a.category] ?? 5;
          const eolDate = new Date(parseISO(a.purchaseDate));
          eolDate.setFullYear(eolDate.getFullYear() + usefulLife);
          evts.push({
            id: `a-eol-${a.id}`,
            date: eolDate,
            type: 'asset_eol',
            title: `EOL: ${a.name}`,
            subtitle: `${usefulLife}-yr lifespan`,
            href: `/assets/${a.id}`,
          });
        }
      }
    }

    return evts;
  }, [ticketsData, assetsData, isAdmin, isSupport]);

  // Calendar grid
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

  const days: Date[] = [];
  let d = gridStart;
  while (d <= gridEnd) { days.push(d); d = addDays(d, 1); }

  const getEventsForDay = (day: Date) =>
    events.filter(e => isSameDay(e.date, day));

  const selectedEvents = selectedDay ? getEventsForDay(selectedDay) : [];

  // Legend filter
  const [activeFilters, setActiveFilters] = useState<Set<CalendarEventType>>(
    new Set(['ticket_open', 'ticket_due', 'ticket_resolved', 'pm_due', 'asset_eol'])
  );
  const toggleFilter = (type: CalendarEventType) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  };

  const filteredEvents = events.filter(e => activeFilters.has(e.type));

  const LEGEND: { type: CalendarEventType; label: string }[] = [
    { type: 'ticket_open',     label: 'Ticket Created' },
    { type: 'ticket_due',      label: 'SLA Deadline' },
    { type: 'ticket_resolved', label: 'Ticket Resolved' },
    ...(isAdmin || isSupport ? [
      { type: 'pm_due' as CalendarEventType,   label: 'PM Due' },
      { type: 'asset_eol' as CalendarEventType, label: 'End of Life' },
    ] : []),
  ];

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageHeader title="Calendar" subtitle="Scheduled events, SLA deadlines, and maintenance dates" />

        {/* Legend / filters */}
        <div className="flex flex-wrap gap-2">
          {LEGEND.map(({ type, label }) => {
            const s = EVENT_STYLES[type];
            const active = activeFilters.has(type);
            return (
              <button
                key={type}
                onClick={() => toggleFilter(type)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                  active ? s.badge : "bg-muted/30 text-muted-foreground border-border/50 opacity-50"
                )}
              >
                <span className={cn("w-2 h-2 rounded-full", active ? s.dot : "bg-muted-foreground/40")} />
                {label}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">

          {/* Calendar grid */}
          <div className="lg:col-span-3">
            <Card className="border-border/50 shadow-lg shadow-black/5 rounded-2xl overflow-hidden">
              {/* Month nav */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 bg-muted/20">
                <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <h2 className="text-lg font-display font-semibold">{format(currentMonth, 'MMMM yyyy')}</h2>
                <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>

              {/* Day headers */}
              <div className="grid grid-cols-7 border-b border-border/50">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                  <div key={d} className="py-2 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {d}
                  </div>
                ))}
              </div>

              {/* Day cells */}
              <div className="grid grid-cols-7">
                {days.map((day, i) => {
                  const dayEvents = filteredEvents.filter(e => isSameDay(e.date, day));
                  const isCurrentMonth = isSameMonth(day, currentMonth);
                  const isSelected = selectedDay && isSameDay(day, selectedDay);
                  const isTodayDate = isToday(day);

                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedDay(isSameDay(day, selectedDay ?? new Date(0)) ? null : day)}
                      className={cn(
                        "min-h-[80px] p-2 border-b border-r border-border/30 text-left transition-colors hover:bg-muted/30",
                        !isCurrentMonth && "opacity-30",
                        isSelected && "bg-primary/5 ring-1 ring-inset ring-primary/30",
                        i % 7 === 6 && "border-r-0",
                      )}
                    >
                      <span className={cn(
                        "inline-flex w-6 h-6 items-center justify-center rounded-full text-sm font-medium mb-1",
                        isTodayDate && "bg-primary text-primary-foreground",
                        !isTodayDate && "text-foreground"
                      )}>
                        {format(day, 'd')}
                      </span>
                      <div className="space-y-0.5">
                        {dayEvents.slice(0, 3).map(evt => {
                          const s = EVENT_STYLES[evt.type];
                          return (
                            <div key={evt.id} className={cn("flex items-center gap-1 px-1 py-0.5 rounded text-[10px] font-medium truncate border", s.badge)}>
                              <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", s.dot)} />
                              <span className="truncate">{evt.title}</span>
                            </div>
                          );
                        })}
                        {dayEvents.length > 3 && (
                          <div className="text-[10px] text-muted-foreground px-1">+{dayEvents.length - 3} more</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* Side panel — selected day events */}
          <div className="space-y-4">
            <Card className="border-border/50 shadow-lg shadow-black/5 rounded-2xl">
              <CardContent className="p-4">
                {!selectedDay ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <p className="text-sm">Click a day to see events</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-foreground">{format(selectedDay, 'MMMM d, yyyy')}</h3>
                      {isToday(selectedDay) && <Badge variant="secondary" className="text-xs">Today</Badge>}
                    </div>
                    {selectedEvents.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">No events this day.</p>
                    ) : (
                      <div className="space-y-2">
                        {selectedEvents.map(evt => {
                          const s = EVENT_STYLES[evt.type];
                          const Icon = s.icon;
                          return (
                            <button
                              key={evt.id}
                              onClick={() => setLocation(evt.href)}
                              className={cn(
                                "w-full flex items-start gap-3 p-3 rounded-xl border text-left hover:opacity-80 transition-opacity",
                                s.badge
                              )}
                            >
                              <Icon className="w-4 h-4 shrink-0 mt-0.5" />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold truncate">{evt.title}</p>
                                {evt.subtitle && <p className="text-[10px] opacity-70 mt-0.5">{evt.subtitle}</p>}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Upcoming events — next 7 days */}
            <Card className="border-border/50 shadow-lg shadow-black/5 rounded-2xl">
              <CardContent className="p-4 space-y-3">
                <h3 className="font-semibold text-sm text-foreground">Upcoming (7 days)</h3>
                {(() => {
                  const today = new Date();
                  const upcoming = filteredEvents
                    .filter(e => e.date >= today && e.date <= addDays(today, 7))
                    .sort((a, b) => a.date.getTime() - b.date.getTime())
                    .slice(0, 8);
                  if (upcoming.length === 0) return <p className="text-xs text-muted-foreground">No upcoming events.</p>;
                  return upcoming.map(evt => {
                    const s = EVENT_STYLES[evt.type];
                    const Icon = s.icon;
                    return (
                      <button
                        key={evt.id}
                        onClick={() => setLocation(evt.href)}
                        className="w-full flex items-start gap-2.5 text-left hover:bg-muted/50 rounded-lg p-1.5 transition-colors"
                      >
                        <div className={cn("w-6 h-6 rounded-lg flex items-center justify-center shrink-0", s.badge)}>
                          <Icon className="w-3 h-3" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-foreground truncate">{evt.title}</p>
                          <p className="text-[10px] text-muted-foreground">{format(evt.date, 'MMM d')}</p>
                        </div>
                      </button>
                    );
                  });
                })()}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
