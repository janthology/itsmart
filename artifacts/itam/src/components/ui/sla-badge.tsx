import { computeSLA, SLA_HOURS } from "@/lib/sla";
import { cn } from "@/lib/utils";
import { Clock, CheckCircle2, AlertTriangle, TimerOff, PauseCircle } from "lucide-react";
import { format } from "date-fns";

interface SLABadgeProps {
  priority: string;
  createdAt: string;
  resolvedAt?: string | null;
  closedAt?: string | null;
  ticketStatus: string;
  totalHoldSeconds?: number;
  onHoldAt?: string | null;
  variant?: "compact" | "full";
  className?: string;
}

const STATUS_STYLES = {
  met:      { bar: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/50" },
  at_risk:  { bar: "bg-amber-400",   text: "text-amber-700 dark:text-amber-400",     bg: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50" },
  breached: { bar: "bg-red-500",     text: "text-red-700 dark:text-red-400",         bg: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50" },
  paused:   { bar: "bg-neutral-400", text: "text-neutral-600 dark:text-neutral-400", bg: "bg-neutral-100 dark:bg-neutral-800/30 border-neutral-300 dark:border-neutral-600/50" },
  pending:  { bar: "bg-blue-400",    text: "text-blue-700 dark:text-blue-400",       bg: "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/50" },
};

const STATUS_ICON = {
  met:      CheckCircle2,
  at_risk:  AlertTriangle,
  breached: TimerOff,
  paused:   PauseCircle,
  pending:  Clock,
};

export function SLABadge({ priority, createdAt, resolvedAt, closedAt, ticketStatus, totalHoldSeconds = 0, onHoldAt, variant = "compact", className }: SLABadgeProps) {
  const sla = computeSLA(priority, createdAt, resolvedAt, ticketStatus, totalHoldSeconds, onHoldAt, closedAt);
  const styles = STATUS_STYLES[sla.status];
  const Icon = STATUS_ICON[sla.status];

  if (variant === "compact") {
    return (
      <span className={cn(
        "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md border",
        styles.bg, styles.text, className
      )}>
        <Icon className="w-3 h-3" />
        {sla.label}
      </span>
    );
  }

  const barWidth = Math.min(sla.percentUsed, 100);

  return (
    <div className={cn("rounded-xl border p-4 space-y-3", styles.bg, className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={cn("w-4 h-4", styles.text)} />
          <span className={cn("text-sm font-semibold", styles.text)}>SLA</span>
        </div>
        <span className={cn("text-xs font-medium", styles.text)}>{sla.label}</span>
      </div>
      <div className="h-1.5 w-full bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all duration-500", styles.bar)} style={{ width: `${barWidth}%` }} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div>
          <p className="font-medium text-foreground/70 uppercase tracking-wide text-[10px] mb-0.5">Target</p>
          <p className="font-semibold">{SLA_HOURS[priority] ?? sla.targetHours}h ({priority})</p>
        </div>
        <div>
          <p className="font-medium text-foreground/70 uppercase tracking-wide text-[10px] mb-0.5">Deadline</p>
          <p className="font-semibold">{format(sla.deadlineAt, 'MMM d, h:mm a')}</p>
        </div>
      </div>
    </div>
  );
}
