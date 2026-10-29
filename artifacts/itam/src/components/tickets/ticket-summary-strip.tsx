import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  LayoutGrid,
  Inbox,
  PlayCircle,
  PauseCircle,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";

export type TicketStatusFilter =
  | "all"
  | "open"
  | "in_progress"
  | "on_hold"
  | "resolved"
  | "closed"
  | "resolved_closed";

interface TicketSummaryStripProps {
  total: number;
  open: number;
  inProgress: number;
  onHold: number;
  /** Tickets currently resolved, plus closed tickets that were resolved first. */
  resolved: number;
  /** All tickets whose current status is closed. */
  closed: number;
  /** Closed tickets that passed through Resolved before Closed. */
  resolvedBeforeClosed: number;
  activeFilter: TicketStatusFilter;
  onFilter: (filter: TicketStatusFilter) => void;
}

const FILTERS: {
  key: TicketStatusFilter;
  label: string;
  field: keyof Pick<TicketSummaryStripProps, "total" | "open" | "inProgress" | "onHold" | "resolved" | "closed">;
  icon: LucideIcon;
  dot?: string;
  selected?: string;
}[] = [
  { key: "all", label: "All tickets", field: "total", icon: LayoutGrid },
  {
    key: "open",
    label: "Open",
    field: "open",
    icon: Inbox,
    dot: "bg-amber-500",
    selected: "ring-amber-500/30 bg-amber-500/[0.08]",
  },
  {
    key: "in_progress",
    label: "In progress",
    field: "inProgress",
    icon: PlayCircle,
    dot: "bg-sky-500",
    selected: "ring-sky-500/30 bg-sky-500/[0.08]",
  },
  {
    key: "on_hold",
    label: "On hold",
    field: "onHold",
    icon: PauseCircle,
    dot: "bg-violet-400",
    selected: "ring-violet-500/30 bg-violet-500/[0.08]",
  },
  {
    key: "resolved",
    label: "Resolved",
    field: "resolved",
    icon: CheckCircle2,
    dot: "bg-emerald-500",
    selected: "ring-emerald-500/30 bg-emerald-500/[0.08]",
  },
  {
    key: "closed",
    label: "Closed",
    field: "closed",
    icon: CheckCircle2,
    dot: "bg-slate-400",
    selected: "ring-slate-400/30 bg-slate-500/[0.08]",
  },
];

export function TicketSummaryStrip({
  total,
  open,
  inProgress,
  onHold,
  resolved,
  closed,
  resolvedBeforeClosed,
  activeFilter,
  onFilter,
}: TicketSummaryStripProps) {
  const counts = { total, open, inProgress, onHold, resolved, closed };
  // The stacked queue bar must remain a partition of the current queue, so a
  // ticket that was resolved before closing is shown once there (as closed).
  // The Resolved/Closed filter counts below intentionally overlap for those
  // tickets, as requested.
  const resolvedOnly = Math.max(resolved - resolvedBeforeClosed, 0);
  const queueSegments = [
    { key: "open", value: open, bar: "bg-amber-500", label: "open" },
    { key: "inProgress", value: inProgress, bar: "bg-sky-500", label: "in progress" },
    { key: "onHold", value: onHold, bar: "bg-violet-400", label: "on hold" },
    { key: "resolvedOnly", value: resolvedOnly, bar: "bg-emerald-500", label: "resolved (not closed)" },
    { key: "closed", value: closed, bar: "bg-slate-400", label: "closed" },
  ];
  // Filter chips use the lifecycle counts: a ticket resolved before closing
  // appears under both Resolved and Closed, even though the stacked bar above
  // can only place it in one segment (Closed, its current status).
  const queueChips = [
    { key: "open", value: open, bar: "bg-amber-500", label: "open", filter: "open" as TicketStatusFilter, chip: "hover:bg-amber-500/10 data-[active=true]:bg-amber-500/12 data-[active=true]:ring-amber-500/25" },
    { key: "inProgress", value: inProgress, bar: "bg-sky-500", label: "in progress", filter: "in_progress" as TicketStatusFilter, chip: "hover:bg-sky-500/10 data-[active=true]:bg-sky-500/12 data-[active=true]:ring-sky-500/25" },
    { key: "onHold", value: onHold, bar: "bg-violet-400", label: "on hold", filter: "on_hold" as TicketStatusFilter, chip: "hover:bg-violet-500/10 data-[active=true]:bg-violet-500/12 data-[active=true]:ring-violet-500/25" },
    { key: "resolved", value: resolved, bar: "bg-emerald-500", label: "resolved", filter: "resolved" as TicketStatusFilter, chip: "hover:bg-emerald-500/10 data-[active=true]:bg-emerald-500/12 data-[active=true]:ring-emerald-500/25" },
    { key: "closed", value: closed, bar: "bg-slate-400", label: "closed", filter: "closed" as TicketStatusFilter, chip: "hover:bg-slate-500/10 data-[active=true]:bg-slate-500/12 data-[active=true]:ring-slate-400/25" },
  ];
  const activeQueue = open + inProgress;
  const attentionPct = total > 0 ? Math.round((activeQueue / total) * 100) : 0;

  return (
    <aside className="app-sidebar-panel flex flex-col gap-5 p-5 lg:sticky lg:top-24 lg:self-start">
      <div>
        <p className="app-page-eyebrow">Queue health</p>
        <p className="mt-1 font-display text-4xl font-bold tabular-nums tracking-tight text-primary">{total}</p>
        <p className="text-sm text-muted-foreground">total tickets</p>
      </div>

      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/[0.1] via-primary/[0.06] to-primary/[0.03] px-4 py-3.5 ring-1 ring-primary/15">
        <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-primary/10 blur-2xl" aria-hidden />
        <p className="text-[10px] font-semibold uppercase tracking-wider text-primary/75">Needs attention</p>
        <p className="mt-0.5 font-display text-2xl font-bold tabular-nums text-primary">{activeQueue}</p>
        <p className="text-xs text-primary/65">{attentionPct}% open or in progress</p>
      </div>

      <div>
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Queue mix
        </p>
        {total > 0 ? (
          <>
            <div className="flex h-4 overflow-hidden rounded-full bg-muted/40 shadow-inner">
              {queueSegments.map((seg, i) => {
                const pct = (seg.value / total) * 100;
                if (pct <= 0) return null;
                return (
                  <motion.div
                    key={seg.key}
                    initial={{ width: 0, opacity: 0.6 }}
                    animate={{ width: `${pct}%`, opacity: 1 }}
                    transition={{ duration: 0.7, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                    className={cn("h-full min-w-0 first:rounded-l-full last:rounded-r-full", seg.bar)}
                    title={`${seg.label}: ${seg.value}`}
                  />
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {queueChips.map((seg) => (
                <button
                  key={seg.key}
                  type="button"
                  data-active={activeFilter === seg.filter}
                  onClick={() => onFilter(seg.filter)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-foreground/80 ring-1 ring-transparent transition-all",
                    seg.chip
                  )}
                >
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", seg.bar)} />
                  <span>{seg.label}</span>
                  <span className="tabular-nums text-muted-foreground">{seg.value}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No tickets in this queue yet.</p>
        )}
      </div>

      <div className="space-y-1">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Filter by status
        </p>
        {FILTERS.map(({ key, label, field, icon: Icon, dot, selected }) => {
          const isSelected = activeFilter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onFilter(key)}
              className={cn(
                "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-all duration-200",
                isSelected
                  ? cn("shadow-md ring-1 ring-primary/20", selected ?? "bg-card")
                  : "hover:bg-card/80"
              )}
            >
              <span className="flex items-center gap-2.5">
                {dot ? (
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />
                ) : (
                  <Icon className={cn("h-4 w-4 shrink-0", isSelected ? "text-primary" : "text-muted-foreground")} />
                )}
                <span className={cn("font-medium", isSelected ? "text-foreground" : "text-muted-foreground")}>
                  {label}
                </span>
              </span>
              <span
                className={cn(
                  "font-display text-base font-bold tabular-nums",
                  isSelected ? "text-primary" : "text-foreground/80"
                )}
              >
                {counts[field]}
              </span>
            </button>
          );
        })}
        {resolvedBeforeClosed > 0 && (
          <p className="px-1 pt-2 text-[11px] leading-relaxed text-muted-foreground">
            {resolvedBeforeClosed} closed ticket{resolvedBeforeClosed === 1 ? " was" : "s were"}{" "}
            resolved first, so {resolvedBeforeClosed === 1 ? "it counts" : "they count"} under both
            Resolved and Closed.
          </p>
        )}
      </div>
    </aside>
  );
}

export function getActiveTicketFilter(
  statusFilter: string,
  resolvedClosed: boolean
): TicketStatusFilter {
  if (resolvedClosed) return "resolved_closed";
  if (statusFilter === "open") return "open";
  if (statusFilter === "in_progress") return "in_progress";
  if (statusFilter === "on_hold") return "on_hold";
  if (statusFilter === "resolved") return "resolved";
  if (statusFilter === "closed") return "closed";
  return "all";
}

export function applyTicketFilter(filter: TicketStatusFilter): {
  statusFilter: string;
  resolvedClosed: boolean;
} {
  switch (filter) {
    case "open":
      return { statusFilter: "open", resolvedClosed: false };
    case "in_progress":
      return { statusFilter: "in_progress", resolvedClosed: false };
    case "on_hold":
      return { statusFilter: "on_hold", resolvedClosed: false };
    case "resolved":
      return { statusFilter: "resolved", resolvedClosed: false };
    case "closed":
      return { statusFilter: "closed", resolvedClosed: false };
    case "resolved_closed":
      return { statusFilter: "all", resolvedClosed: true };
    default:
      return { statusFilter: "all", resolvedClosed: false };
  }
}
