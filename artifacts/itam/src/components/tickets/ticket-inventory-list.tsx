import { memo } from "react";
import { TicketCheck } from "lucide-react";
import { TicketRow } from "@/components/tickets/ticket-row";
import type { TicketCardData } from "@/components/tickets/ticket-card";

interface TicketInventoryListProps {
  tickets: TicketCardData[];
  total: number;
  typeLabels?: Record<string, string>;
  title?: string;
  subtitle?: string;
  emptyMessage?: string;
}

export const TicketInventoryList = memo(function TicketInventoryList({
  tickets,
  total,
  typeLabels = {},
  title = "Support queue",
  subtitle = "Track, triage, and resolve requests",
  emptyMessage,
}: TicketInventoryListProps) {
  return (
    <div className="app-surface overflow-hidden rounded-3xl">
      <div className="app-panel-header flex items-center justify-between gap-3 border-b border-primary/[0.06] px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary ring-1 ring-primary/15 shadow-sm">
            <TicketCheck className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-foreground">{title}</h2>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <div className="shrink-0 rounded-full bg-primary/[0.08] px-3.5 py-1.5 ring-1 ring-primary/15">
          <span className="text-xs font-bold tabular-nums text-primary">
            {tickets.length}
            <span className="font-normal text-primary/55"> / {total}</span>
          </span>
        </div>
      </div>

      <div className="space-y-2 p-2.5 sm:p-3">
        {tickets.length === 0 && emptyMessage ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>
        ) : null}
        {tickets.map((ticket, i) => (
          <TicketRow
            key={ticket.id}
            ticket={ticket}
            typeLabel={ticket.type ? typeLabels[ticket.type] : undefined}
            index={i}
          />
        ))}
      </div>
    </div>
  );
});
