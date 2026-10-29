import { Link } from "wouter";
import { ChevronRight, Clock, TicketIcon, UserCheck, UserRound } from "lucide-react";
import { format, formatDistanceToNow, isToday, isYesterday } from "date-fns";
import { motion } from "framer-motion";
import { SLABadge } from "@/components/ui/sla-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { TicketCardData } from "@/components/tickets/ticket-card";
import { getResolvedTicketAutoCloseAt } from "@/lib/supabase-queries";

function formatTicketDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isToday(d)) return formatDistanceToNow(d, { addSuffix: true });
  if (isYesterday(d)) return `Yesterday ${format(d, "h:mm a")}`;
  return format(d, "MMM d, yyyy");
}

const STATUS_THEME: Record<
  string,
  { accent: string; chip: string; icon: string; glow: string; label: string }
> = {
  open: {
    accent: "bg-amber-500",
    chip: "bg-amber-500/12 text-amber-800 ring-amber-500/25 dark:text-amber-300",
    icon: "from-amber-500/20 via-amber-500/8 to-card text-amber-700 ring-amber-500/20 dark:text-amber-300",
    glow: "group-hover:shadow-[0_8px_28px_rgba(245,158,11,0.12)]",
    label: "Open",
  },
  in_progress: {
    accent: "bg-sky-500",
    chip: "bg-sky-500/12 text-sky-800 ring-sky-500/25 dark:text-sky-300",
    icon: "from-sky-500/20 via-sky-500/8 to-card text-sky-700 ring-sky-500/20 dark:text-sky-300",
    glow: "group-hover:shadow-[0_8px_28px_rgba(14,165,233,0.12)]",
    label: "In progress",
  },
  on_hold: {
    accent: "bg-violet-400",
    chip: "bg-violet-500/12 text-violet-800 ring-violet-500/25 dark:text-violet-300",
    icon: "from-violet-500/20 via-violet-500/8 to-card text-violet-700 ring-violet-500/20 dark:text-violet-300",
    glow: "group-hover:shadow-[0_8px_28px_rgba(139,92,246,0.12)]",
    label: "On hold",
  },
  resolved: {
    accent: "bg-emerald-500",
    chip: "bg-emerald-500/12 text-emerald-800 ring-emerald-500/25 dark:text-emerald-300",
    icon: "from-emerald-500/20 via-emerald-500/8 to-card text-emerald-700 ring-emerald-500/20 dark:text-emerald-300",
    glow: "group-hover:shadow-[0_8px_28px_rgba(16,185,129,0.12)]",
    label: "Resolved",
  },
  closed: {
    accent: "bg-slate-400",
    chip: "bg-slate-500/10 text-slate-600 ring-slate-400/25 dark:text-slate-300",
    icon: "from-slate-500/15 via-slate-500/5 to-card text-slate-600 ring-slate-400/20 dark:text-slate-300",
    glow: "group-hover:shadow-[0_8px_28px_rgba(100,116,139,0.1)]",
    label: "Closed",
  },
};

const PRIORITY_THEME: Record<string, { ring: string; badge: string }> = {
  critical: {
    ring: "ring-rose-500/40",
    badge: "bg-rose-500/10 text-rose-700 ring-rose-500/25 dark:text-rose-300",
  },
  high: {
    ring: "ring-amber-500/40",
    badge: "bg-amber-500/10 text-amber-800 ring-amber-500/25 dark:text-amber-300",
  },
  medium: {
    ring: "ring-sky-500/25",
    badge: "bg-sky-500/10 text-sky-800 ring-sky-500/25 dark:text-sky-300",
  },
  low: {
    ring: "ring-slate-400/25",
    badge: "bg-slate-500/10 text-slate-600 ring-slate-400/25 dark:text-slate-300",
  },
};

interface TicketRowProps {
  ticket: TicketCardData;
  typeLabel?: string;
  index?: number;
}

export function TicketRow({ ticket, typeLabel, index = 0 }: TicketRowProps) {
  const ticketNum = ticket.ticketNumber ?? `#${ticket.id.substring(0, 8)}`;
  const theme = STATUS_THEME[ticket.status] ?? STATUS_THEME.open;
  const priority = PRIORITY_THEME[ticket.priority] ?? PRIORITY_THEME.low;
  const isUrgent = ticket.priority === "critical" || ticket.priority === "high";
  // Closure path: closing a ticket retains resolved_at, so a closed ticket
  // with a resolved timestamp was resolved first; one without it was closed
  // directly (e.g. duplicate or created by mistake).
  const wasResolvedBeforeClose = ticket.status === "closed" && Boolean(ticket.resolvedAt);
  const wasClosedDirectly = ticket.status === "closed" && !ticket.resolvedAt;
  const autoCloseAt = getResolvedTicketAutoCloseAt(ticket);

  const statusChip = (statusKey: "resolved" | "closed") => {
    const statusTheme = STATUS_THEME[statusKey];
    return (
      <span
        key={statusKey}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
          statusTheme.chip
        )}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", statusTheme.accent)} />
        {statusTheme.label}
      </span>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.35), ease: [0.22, 1, 0.36, 1] }}
    >
      <Link href={`/tickets/${ticket.id}`}>
        <article
          className={cn(
            "group relative flex cursor-pointer items-stretch gap-0 overflow-hidden rounded-2xl border border-primary/[0.07] bg-card/80 backdrop-blur-sm transition-all duration-300 dark:border-white/10 dark:bg-card/50",
            "hover:border-primary/15 hover:bg-card hover:-translate-y-0.5 dark:hover:bg-card/70",
            theme.glow
          )}
        >
          {/* Status accent — matches queue mix */}
          <div className={cn("w-1 shrink-0", theme.accent)} aria-hidden />

          <div className="flex min-w-0 flex-1 items-center gap-3 px-3.5 py-3.5 sm:gap-4 sm:px-4">
            {/* Icon */}
            <div
              className={cn(
                "relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ring-1 transition-transform duration-300 group-hover:scale-[1.03]",
                theme.icon,
                isUrgent && priority.ring,
                isUrgent && "ring-2"
              )}
            >
              <TicketIcon className="h-5 w-5" strokeWidth={2} />
            </div>

            {/* Main content */}
            <div className="min-w-0 flex-1 grid gap-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,0.75fr)_minmax(0,0.65fr)_minmax(0,0.5fr)_auto] sm:items-center sm:gap-4">
              {/* Ticket info */}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-lg bg-primary/[0.06] px-2 py-0.5 font-mono text-[10px] font-bold tracking-wide text-primary ring-1 ring-primary/10">
                    {ticketNum}
                  </span>
                  {wasResolvedBeforeClose ? (
                    <>
                      {statusChip("resolved")}
                      {statusChip("closed")}
                    </>
                  ) : (
                    <>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
                          theme.chip
                        )}
                      >
                        <span className={cn("h-1.5 w-1.5 rounded-full", theme.accent)} />
                        {theme.label}
                      </span>
                      {wasClosedDirectly && (
                        <span
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground ring-1 ring-border/60"
                          title="Closed without a resolved stage (for example, a duplicate or a ticket created by mistake)"
                        >
                          Closed directly
                        </span>
                      )}
                    </>
                  )}
                  {priority.badge && (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ring-1",
                        priority.badge
                      )}
                    >
                      {ticket.priority}
                    </span>
                  )}
                  {autoCloseAt && (
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-500/25 bg-emerald-500/10 dark:text-emerald-300"
                      title={`Auto-closes ${format(autoCloseAt, "MMM d, yyyy h:mm a")} if there is no activity. Comment or reopen (In Progress) if the issue recurs.`}
                    >
                      {autoCloseAt.getTime() <= Date.now()
                        ? "Auto-close pending"
                        : `Auto-closes ${format(autoCloseAt, "MMM d")}`}
                    </span>
                  )}
                </div>
                <h3 className="mt-1.5 truncate font-display text-[15px] font-semibold leading-snug text-foreground transition-colors group-hover:text-primary">
                  {ticket.title}
                </h3>
                {typeLabel && typeLabel !== "Other" && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground/80">{typeLabel}</p>
                )}
              </div>

              {/* SLA */}
              <div className="flex min-w-0 items-center sm:justify-start">
                <SLABadge
                  variant="compact"
                  priority={ticket.priority}
                  createdAt={ticket.createdAt}
                  resolvedAt={ticket.resolvedAt}
                  closedAt={ticket.closedAt}
                  ticketStatus={ticket.status}
                  totalHoldSeconds={ticket.totalHoldSeconds}
                  onHoldAt={ticket.onHoldAt}
                  className="max-w-full truncate text-[10px]"
                />
              </div>

              {/* Requester */}
              <div className="flex min-w-0 items-center">
                <div className="inline-flex max-w-full items-center gap-2 rounded-xl bg-primary/[0.04] px-2.5 py-1.5 ring-1 ring-primary/[0.08] transition-colors group-hover:bg-primary/[0.07]">
                  <Avatar className="h-6 w-6 ring-2 ring-white shadow-sm">
                    <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/10 text-primary text-[9px] font-bold">
                      {ticket.createdBy.fullName.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate text-xs font-medium text-foreground/90 max-w-[100px]">
                    {ticket.createdBy.fullName}
                  </span>
                </div>
              </div>

              {/* Assignee + date */}
              <div className="flex min-w-0 flex-col gap-1">
                {ticket.assignedTo ? (
                  <div className="inline-flex max-w-full items-center gap-1.5 rounded-xl bg-primary/[0.04] px-2.5 py-1.5 ring-1 ring-primary/[0.08]">
                    <UserCheck className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                    <span className="truncate text-xs font-medium text-foreground/90 max-w-[100px]">
                      {ticket.assignedTo.fullName}
                    </span>
                  </div>
                ) : (
                  <span className="inline-flex w-fit items-center gap-1.5 rounded-xl bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground ring-1 ring-border/40">
                    <UserRound className="h-3.5 w-3.5 opacity-50" />
                    Unassigned
                  </span>
                )}
                <span className="inline-flex items-center gap-1 pl-0.5 text-[10px] text-muted-foreground/75">
                  <Clock className="h-3 w-3" />
                  {formatTicketDate(ticket.createdAt)}
                </span>
              </div>

              {/* Action */}
              <div className="hidden sm:flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-xl bg-primary/[0.05] text-primary/35 transition-all duration-300 group-hover:bg-primary group-hover:text-primary-foreground group-hover:shadow-md group-hover:shadow-primary/20">
                <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </div>
            </div>
          </div>
        </article>
      </Link>
    </motion.div>
  );
}
