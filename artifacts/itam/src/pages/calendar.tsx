import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { useGetAssets, useGetTickets } from "@/lib/supabase-queries";
import { useAuth } from "@/lib/auth-context";
import { AppLayout } from "@/components/layout/app-layout";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft, ChevronRight, Wrench, TicketIcon,
  AlertTriangle, Clock, CheckCircle2, CalendarDays, Loader2,
} from "lucide-react";
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, subMonths, isSameMonth, isSameDay, isToday,
  addDays, parseISO, isWithinInterval, startOfDay,
} from "date-fns";
import { SLA_HOURS } from "@/lib/sla";
import { cn } from "@/lib/utils";
import {
  CalendarLegend,
  EVENT_STYLES,
  type CalendarEvent,
  type CalendarEventType,
} from "@/components/calendar/calendar-legend";

const EVENT_ICONS: Record<CalendarEventType, React.ElementType> = {
  ticket_open: TicketIcon,
  ticket_due: Clock,
  ticket_resolved: CheckCircle2,
  pm_due: Wrench,
  asset_eol: AlertTriangle,
};

const USEFUL_LIFE: Record<string, number> = {
  laptop: 4, desktop: 5, monitor: 6, printer: 5,
  server: 6, phone: 3, tablet: 3, networking: 7,
  peripheral: 4, other: 5,
};

const ALL_EVENT_TYPES: CalendarEventType[] = [
  "ticket_open", "ticket_due", "ticket_resolved", "pm_due", "asset_eol",
];

export default function CalendarPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "administrator";
  const isSupport = user?.role === "support_staff";
  const [, setLocation] = useLocation();

  const [currentMonth, setCurrentMonth] = useState(new Date());
  // Default to today being selected/highlighted so the Day details panel
  // opens on today's events instead of an empty prompt.
  const [selectedDay, setSelectedDay] = useState<Date | null>(() => new Date());

  const ticketQuery: Record<string, string | undefined> = {};
  if (!isAdmin && !isSupport) ticketQuery.createdBy = user?.id;
  if (isSupport) ticketQuery.assignedTo = user?.id;

  const { data: ticketsData, isLoading: ticketsLoading } = useGetTickets({ query: ticketQuery });
  const { data: assetsData, isLoading: assetsLoading } = useGetAssets();

  const isLoading = ticketsLoading || ((isAdmin || isSupport) && assetsLoading);

  const events = useMemo<CalendarEvent[]>(() => {
    const evts: CalendarEvent[] = [];
    const tickets = ticketsData?.data ?? [];
    const assets = assetsData?.data ?? [];

    for (const t of tickets) {
      evts.push({
        id: `t-open-${t.id}`,
        date: parseISO(t.createdAt),
        type: "ticket_open",
        title: t.title,
        subtitle: `${t.priority} priority`,
        href: `/tickets/${t.id}`,
      });

      if (!["resolved", "closed", "on_hold"].includes(t.status)) {
        const targetHours = SLA_HOURS[t.priority] ?? 24;
        const holdMs = ((t as { totalHoldSeconds?: number }).totalHoldSeconds ?? 0) * 1000;
        const deadline = new Date(parseISO(t.createdAt).getTime() + targetHours * 60 * 60 * 1000 + holdMs);
        evts.push({
          id: `t-due-${t.id}`,
          date: deadline,
          type: "ticket_due",
          title: `SLA: ${t.title}`,
          subtitle: `Due ${format(deadline, "h:mm a")}`,
          href: `/tickets/${t.id}`,
        });
      }

      const resolvedAt = (t as { resolvedAt?: string }).resolvedAt;
      if (resolvedAt) {
        evts.push({
          id: `t-res-${t.id}`,
          date: parseISO(resolvedAt),
          type: "ticket_resolved",
          title: t.title,
          subtitle: "Resolved",
          href: `/tickets/${t.id}`,
        });
      }
    }

    if (isAdmin || isSupport) {
      for (const a of assets) {
        const asset = a as { nextPmDate?: string; purchaseDate?: string; name: string; assetTag: string; id: string; category: string; status: string };
        if (asset.nextPmDate) {
          evts.push({
            id: `a-pm-${a.id}`,
            date: parseISO(asset.nextPmDate),
            type: "pm_due",
            title: `PM: ${a.name}`,
            subtitle: a.assetTag,
            href: `/assets/${a.id}`,
          });
        }

        if (asset.purchaseDate && a.status !== "retired") {
          const usefulLife = USEFUL_LIFE[a.category] ?? 5;
          const eolDate = new Date(parseISO(asset.purchaseDate));
          eolDate.setFullYear(eolDate.getFullYear() + usefulLife);
          evts.push({
            id: `a-eol-${a.id}`,
            date: eolDate,
            type: "asset_eol",
            title: `EOL: ${a.name}`,
            subtitle: `${usefulLife}-yr lifespan`,
            href: `/assets/${a.id}`,
          });
        }
      }
    }

    return evts;
  }, [ticketsData, assetsData, isAdmin, isSupport]);

  const [activeFilters, setActiveFilters] = useState<Set<CalendarEventType>>(
    () => new Set(ALL_EVENT_TYPES)
  );

  useEffect(() => {
    if (!isAdmin && !isSupport) {
      setActiveFilters(new Set(["ticket_open", "ticket_due", "ticket_resolved"]));
    }
  }, [isAdmin, isSupport]);

  const toggleFilter = (type: CalendarEventType) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const filteredEvents = useMemo(
    () => events.filter((e) => activeFilters.has(e.type)),
    [events, activeFilters]
  );

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

  const days: Date[] = [];
  let d = gridStart;
  while (d <= gridEnd) {
    days.push(d);
    d = addDays(d, 1);
  }

  const getEventsForDay = (day: Date) =>
    filteredEvents.filter((e) => isSameDay(e.date, day));

  const selectedEvents = selectedDay ? getEventsForDay(selectedDay) : [];

  const monthEvents = useMemo(
    () =>
      filteredEvents.filter((e) =>
        isWithinInterval(e.date, { start: monthStart, end: monthEnd })
      ),
    [filteredEvents, monthStart, monthEnd]
  );

  const legendTypes: CalendarEventType[] =
    isAdmin || isSupport
      ? ["ticket_open", "ticket_due", "ticket_resolved", "pm_due", "asset_eol"]
      : ["ticket_open", "ticket_due", "ticket_resolved"];

  const legend = legendTypes.map((type) => ({
    type,
    label: EVENT_STYLES[type].label,
    count: monthEvents.filter((e) => e.type === type).length,
  }));

  // A deadline is overdue when it has already passed: SLA deadlines carry a
  // precise time, while PM dates are day-granular (due today is not overdue).
  const isOverdueDeadline = (e: CalendarEvent) => {
    const now = new Date();
    if (e.type === "ticket_due") return e.date.getTime() < now.getTime();
    if (e.type === "pm_due") return startOfDay(e.date).getTime() < startOfDay(now).getTime();
    return false;
  };

  const upcoming = useMemo(() => {
    const now = new Date();
    const startToday = startOfDay(now);
    const horizon = addDays(now, 7); // next 7 x 24h, not midnight 7 days out
    return filteredEvents
      .filter(
        (e) =>
          // Overdue deadlines are the most urgent items — never hide them
          // just because their date has passed.
          isOverdueDeadline(e) || (e.date >= startToday && e.date <= horizon)
      )
      .sort((a, b) =>
        // Overdue first (oldest first), then chronological.
        Number(isOverdueDeadline(b)) - Number(isOverdueDeadline(a)) ||
        a.date.getTime() - b.date.getTime()
      )
      .slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredEvents]);

  const goToToday = () => {
    const today = new Date();
    setCurrentMonth(today);
    setSelectedDay(today);
  };

  const subtitle = isAdmin
    ? "Tickets, SLA deadlines, preventive maintenance, and asset end-of-life dates"
    : isSupport
      ? "Your assigned tickets, SLA deadlines, and asset maintenance schedule"
      : "Your support tickets and key dates";

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageHeader eyebrow="Schedule" title="Calendar" subtitle={subtitle}>
          {isLoading ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading events
            </span>
          ) : (
            <Badge variant="secondary" className="rounded-lg text-xs font-normal tabular-nums">
              {monthEvents.length} event{monthEvents.length === 1 ? "" : "s"} this month
            </Badge>
          )}
        </PageHeader>

        {/* Event type filters */}
        <CalendarLegend legend={legend} activeFilters={activeFilters} onToggle={toggleFilter} />

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(260px,300px)] gap-6 items-start">
          {/* Calendar grid */}
          <div className="rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden">
            {/* Month navigation */}
            <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-5 border-b border-border/50 bg-muted/20">
              <Button
                variant="ghost"
                size="icon"
                className="rounded-xl h-9 w-9"
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                aria-label="Previous month"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <div className="flex flex-col items-center gap-1 min-w-0">
                <h2 className="text-base md:text-lg font-display font-semibold text-foreground">
                  {format(currentMonth, "MMMM yyyy")}
                </h2>
                <Button variant="ghost" size="sm" className="h-7 px-2.5 rounded-lg text-xs text-primary" onClick={goToToday}>
                  Today
                </Button>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-xl h-9 w-9"
                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                aria-label="Next month"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 border-b border-border/50 bg-primary/[0.02]">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
                <div
                  key={label}
                  className="py-2.5 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wider"
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7">
              {days.map((day, i) => {
                const dayEvents = getEventsForDay(day);
                const isCurrentMonth = isSameMonth(day, currentMonth);
                const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;
                const isTodayDate = isToday(day);
                const hasSla = dayEvents.some((e) => e.type === "ticket_due");

                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSelectedDay(isSelected ? null : day)}
                    className={cn(
                      "min-h-[88px] md:min-h-[96px] p-1.5 md:p-2 border-b border-r border-border/30 text-left transition-colors hover:bg-muted/40",
                      !isCurrentMonth && "bg-muted/10 opacity-45",
                      isSelected && "bg-primary/[0.06] ring-1 ring-inset ring-primary/25",
                      i % 7 === 6 && "border-r-0"
                    )}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span
                        className={cn(
                          "inline-flex w-7 h-7 items-center justify-center rounded-full text-sm font-medium",
                          isTodayDate && "bg-primary text-primary-foreground shadow-sm",
                          !isTodayDate && "text-foreground"
                        )}
                      >
                        {format(day, "d")}
                      </span>
                      {hasSla && (
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" title="SLA deadline" />
                      )}
                    </div>
                    <div className="space-y-0.5">
                      {dayEvents.slice(0, 2).map((evt) => {
                        const s = EVENT_STYLES[evt.type];
                        return (
                          <div
                            key={evt.id}
                            className={cn(
                              "flex items-center gap-1 px-1 py-0.5 rounded-md text-[10px] font-medium truncate border",
                              s.badge
                            )}
                          >
                            <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", s.dot)} />
                            <span className="truncate">{evt.title}</span>
                          </div>
                        );
                      })}
                      {dayEvents.length > 2 && (
                        <div className="text-[10px] text-muted-foreground px-1 font-medium">
                          +{dayEvents.length - 2} more
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Side panel */}
          <div className="space-y-4 lg:sticky lg:top-20">
            {/* Selected day */}
            <div className="rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-border/50 bg-muted/20">
                <h3 className="text-sm font-display font-semibold text-foreground">
                  {selectedDay ? format(selectedDay, "EEEE, MMM d") : "Day details"}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {selectedDay ? `${selectedEvents.length} event${selectedEvents.length === 1 ? "" : "s"}` : "Click a date on the calendar"}
                </p>
              </div>
              <div className="p-4">
                {!selectedDay ? (
                  <div className="text-center py-8 px-2">
                    <CalendarDays className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Select a day to view its events</p>
                  </div>
                ) : selectedEvents.length === 0 ? (
                  <div className="text-center py-8 px-2">
                    <p className="text-sm text-muted-foreground">No events on this day</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">Try toggling filters above</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {isToday(selectedDay) && (
                      <Badge variant="secondary" className="text-[10px] mb-1">Today</Badge>
                    )}
                    {selectedEvents.map((evt) => {
                      const s = EVENT_STYLES[evt.type];
                      const Icon = EVENT_ICONS[evt.type];
                      return (
                        <button
                          key={evt.id}
                          type="button"
                          onClick={() => setLocation(evt.href)}
                          className={cn(
                            "w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all hover:shadow-sm hover:-translate-y-0.5",
                            s.badge
                          )}
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background/60">
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold leading-snug line-clamp-2">{evt.title}</p>
                            {evt.subtitle && (
                              <p className="text-[10px] opacity-80 mt-0.5">{evt.subtitle}</p>
                            )}
                            <p className="text-[10px] opacity-60 mt-1">{format(evt.date, "h:mm a")}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Upcoming */}
            <div className="rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-border/50 bg-muted/20">
                <h3 className="text-sm font-display font-semibold text-foreground">Next 7 days</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Upcoming deadlines and milestones</p>
              </div>
              <div className="p-3 space-y-1">
                {upcoming.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">Nothing scheduled this week</p>
                ) : (
                  upcoming.map((evt) => {
                    const s = EVENT_STYLES[evt.type];
                    const Icon = EVENT_ICONS[evt.type];
                    return (
                      <button
                        key={evt.id}
                        type="button"
                        onClick={() => setLocation(evt.href)}
                        className="w-full flex items-center gap-2.5 text-left rounded-xl p-2 hover:bg-muted/50 transition-colors"
                      >
                        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border", s.chip)}>
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-foreground truncate">{evt.title}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {isOverdueDeadline(evt) && (
                              <span className="font-semibold text-destructive">Overdue · </span>
                            )}
                            {format(evt.date, "EEE, MMM d")}
                            {evt.type === "ticket_due" && ` · ${format(evt.date, "h:mm a")}`}
                          </p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
