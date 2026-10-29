import { Link } from "wouter";
import { ChevronRight, TicketIcon, UserCheck, Clock } from "lucide-react";
import { format, formatDistanceToNow, isToday, isYesterday } from "date-fns";
import { StatusBadge } from "@/components/ui/status-badge";
import { SLABadge } from "@/components/ui/sla-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

function formatTicketDate(dateStr: string): { relative: string; full: string } {
  const d = new Date(dateStr);
  const full = format(d, "MMM d, yyyy h:mm a");
  let relative: string;
  if (isToday(d)) relative = formatDistanceToNow(d, { addSuffix: true });
  else if (isYesterday(d)) relative = `Yesterday ${format(d, "h:mm a")}`;
  else relative = format(d, "MMM d, yyyy");
  return { relative, full };
}

function priorityAccent(priority: string) {
  if (priority === "critical") return "from-red-500/90 via-red-400/70 to-red-500/40";
  if (priority === "high") return "from-amber-500/90 via-amber-400/70 to-amber-500/40";
  if (priority === "medium") return "from-sky-500/80 via-sky-400/60 to-sky-500/30";
  return "from-slate-300/80 via-slate-200/60 to-slate-300/30";
}

export interface TicketCardData {
  id: string;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
  ticketNumber?: string;
  type?: string;
  resolvedAt?: string | null;
  lastActivityAt?: string | null;
  updatedAt?: string;
  closedAt?: string | null;
  totalHoldSeconds?: number;
  onHoldAt?: string | null;
  createdBy: { fullName: string };
  assignedTo?: { fullName: string } | null;
}

interface TicketCardProps {
  ticket: TicketCardData;
  typeLabel?: string;
}

export function TicketCard({ ticket, typeLabel }: TicketCardProps) {
  const { relative, full } = formatTicketDate(ticket.createdAt);
  const ticketNum = ticket.ticketNumber ?? `#${ticket.id.substring(0, 8)}`;
  const statusForBadge =
    ticket.status === "open" && (ticket.priority === "high" || ticket.priority === "critical")
      ? "open_urgent"
      : ticket.status;

  return (
    <Link href={`/tickets/${ticket.id}`}>
      <article
        className={cn(
          "group relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/50 bg-white/70 backdrop-blur-xl",
          "shadow-[0_4px_20px_rgba(53,88,114,0.05)] transition-all duration-300",
          "hover:border-primary/30 hover:shadow-[0_16px_48px_rgba(53,88,114,0.12)] hover:-translate-y-1"
        )}
      >
        <div className={cn("h-0.5 w-full bg-gradient-to-r", priorityAccent(ticket.priority))} />

        <div className="flex flex-1 flex-col gap-4 p-5 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/[0.08] text-primary ring-1 ring-primary/10 transition-colors group-hover:bg-primary/12">
              <TicketIcon className="h-5 w-5" />
            </div>
            <div className="flex flex-wrap gap-1.5 justify-end">
              <StatusBadge status={statusForBadge} />
              <StatusBadge status={ticket.priority} />
            </div>
          </div>

          <div className="min-w-0 space-y-1.5">
            <span className="inline-block font-mono text-[11px] font-semibold text-primary bg-primary/[0.06] border border-primary/10 px-2 py-0.5 rounded-md">
              {ticketNum}
            </span>
            <h3 className="font-display font-semibold text-[15px] text-foreground line-clamp-2 group-hover:text-primary transition-colors leading-snug">
              {ticket.title}
            </h3>
            {typeLabel && typeLabel !== "Other" && (
              <p className="text-xs text-muted-foreground">{typeLabel}</p>
            )}
          </div>

          <div className="mt-auto space-y-3 pt-3 border-t border-border/50">
            <SLABadge
              variant="compact"
              priority={ticket.priority}
              createdAt={ticket.createdAt}
              resolvedAt={ticket.resolvedAt}
              closedAt={ticket.closedAt}
              ticketStatus={ticket.status}
              totalHoldSeconds={ticket.totalHoldSeconds}
              onHoldAt={ticket.onHoldAt}
            />

            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <Avatar className="h-6 w-6 ring-1 ring-border/50 shrink-0">
                  <AvatarFallback className="bg-accent/10 text-accent text-[9px] font-bold">
                    {ticket.createdBy.fullName.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate text-muted-foreground">{ticket.createdBy.fullName}</span>
              </div>
              <span className="flex items-center gap-1 text-muted-foreground shrink-0" title={full}>
                <Clock className="h-3 w-3 opacity-60" />
                {relative}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
              {ticket.assignedTo ? (
                <div className="flex items-center gap-2 min-w-0 text-xs">
                  <UserCheck className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="font-medium text-foreground truncate">{ticket.assignedTo.fullName}</span>
                </div>
              ) : (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground italic">
                  <UserCheck className="h-3.5 w-3.5 opacity-50" />
                  Awaiting assignment
                </span>
              )}
              <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 shrink-0 transition-all" />
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}
