import { motion } from "framer-motion";
import { Activity, Wrench, Archive, CircleOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface AssetSummaryStripProps {
  total: number;
  active: number;
  inactive: number;
  maintenance: number;
  retired: number;
  statusFilter: string;
  onStatusFilter: (status: string) => void;
  /** False for general users: the "All assets" row is hidden, and clicking the selected status clears it. */
  showAllStatus?: boolean;
}

const FILTERS = [
  { key: "all", label: "All assets", field: "total" as const, dot: "bg-primary", icon: null },
  { key: "active", label: "Active", field: "active" as const, dot: "bg-emerald-500", icon: Activity },
  { key: "inactive", label: "Inactive", field: "inactive" as const, dot: "bg-slate-400", icon: CircleOff },
  { key: "maintenance", label: "Maintenance", field: "maintenance" as const, dot: "bg-amber-500", icon: Wrench },
  { key: "retired", label: "Retired", field: "retired" as const, dot: "bg-rose-400", icon: Archive },
];

const BAR_SEGMENTS = [
  { field: "active" as const, bar: "bg-emerald-500" },
  { field: "inactive" as const, bar: "bg-slate-400" },
  { field: "maintenance" as const, bar: "bg-amber-500" },
  { field: "retired" as const, bar: "bg-rose-400" },
];

export function AssetSummaryStrip({
  total,
  active,
  inactive,
  maintenance,
  retired,
  statusFilter,
  onStatusFilter,
  showAllStatus = true,
}: AssetSummaryStripProps) {
  const counts = { total, active, inactive, maintenance, retired };
  const activePct = total > 0 ? Math.round((active / total) * 100) : 0;
  const visibleFilters = showAllStatus ? FILTERS : FILTERS.filter((f) => f.key !== "all");

  return (
    <aside className="app-sidebar-panel flex flex-col gap-4 p-5 lg:sticky lg:top-24 lg:self-start">
      <div>
        <p className="app-page-eyebrow">Fleet health</p>
        <p className="mt-1 font-display text-4xl font-bold tabular-nums text-primary">{total}</p>
        <p className="text-sm text-muted-foreground">registered devices</p>
      </div>

      <div className="rounded-2xl bg-primary/[0.08] px-4 py-3 ring-1 ring-primary/15">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-primary/80">Active rate</p>
        <p className="mt-0.5 font-display text-2xl font-bold tabular-nums text-primary">{activePct}%</p>
        <p className="text-xs text-primary/70">{active} of {total} in service</p>
      </div>

      {total > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Composition
          </p>
          <div className="overflow-hidden rounded-full bg-muted/60 p-0.5">
            <div className="flex h-2 overflow-hidden rounded-full">
              {BAR_SEGMENTS.map((seg, i) => {
                const pct = (counts[seg.field] / total) * 100;
                if (pct <= 0) return null;
                return (
                  <motion.div
                    key={seg.field}
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, delay: i * 0.07 }}
                    className={seg.bar}
                    title={`${seg.field}: ${counts[seg.field]}`}
                  />
                );
              })}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            {BAR_SEGMENTS.map((seg) =>
              counts[seg.field] > 0 ? (
                <span key={seg.field} className="flex items-center gap-1 capitalize">
                  <span className={cn("h-1.5 w-1.5 rounded-full", seg.bar)} />
                  {seg.field} {counts[seg.field]}
                </span>
              ) : null
            )}
          </div>
        </div>
      )}

      <div className="space-y-1">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Filter by status
        </p>
        {visibleFilters.map(({ key, label, field, dot, icon: Icon }) => {
          const selected = statusFilter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onStatusFilter(!showAllStatus && selected ? "all" : key)}
              className={cn(
                "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-all",
                selected
                  ? "bg-card shadow-md ring-1 ring-primary/20"
                  : "hover:bg-card/70"
              )}
            >
              <span className="flex items-center gap-2.5">
                {Icon ? (
                  <Icon className={cn("h-4 w-4", selected ? "text-primary" : "text-muted-foreground")} />
                ) : (
                  <span className={cn("h-2 w-2 rounded-full", dot)} />
                )}
                <span className={cn("font-medium", selected ? "text-foreground" : "text-muted-foreground")}>
                  {label}
                </span>
              </span>
              <span className={cn("font-display text-base font-bold tabular-nums", selected ? "text-primary" : "text-foreground")}>
                {counts[field]}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
