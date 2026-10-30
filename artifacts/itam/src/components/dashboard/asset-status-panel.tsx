import { Link } from "wouter";
import { ArrowUpRight, MonitorSmartphone } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface AssetStatusPanelProps {
  totalAssets: number;
  availableAssets: number;
  inactiveAssets: number;
  inMaintenanceAssets: number;
  retiredAssets: number;
}

const SEGMENTS = [
  {
    label: "Active",
    dot: "bg-emerald-500",
    bar: "bg-emerald-500",
    pill: "border-primary/10 bg-primary/[0.03] hover:border-primary/20 hover:bg-primary/[0.06]",
    href: "/assets?status=active&scope=all",
  },
  {
    label: "Inactive",
    dot: "bg-slate-400",
    bar: "bg-slate-400",
    pill: "border-primary/10 bg-primary/[0.03] hover:border-primary/20 hover:bg-primary/[0.06]",
    href: "/assets?status=inactive&scope=all",
  },
  {
    label: "Maint.",
    dot: "bg-amber-500",
    bar: "bg-amber-500",
    pill: "border-primary/10 bg-primary/[0.03] hover:border-primary/20 hover:bg-primary/[0.06]",
    href: "/assets?status=maintenance&scope=all",
  },
  {
    label: "Retired",
    dot: "bg-rose-400",
    bar: "bg-rose-400",
    pill: "border-primary/10 bg-primary/[0.03] hover:border-primary/20 hover:bg-primary/[0.06]",
    href: "/assets?status=retired&scope=all",
  },
] as const;

export function AssetStatusPanel({
  totalAssets,
  availableAssets,
  inactiveAssets,
  inMaintenanceAssets,
  retiredAssets,
}: AssetStatusPanelProps) {
  const values = [availableAssets, inactiveAssets, inMaintenanceAssets, retiredAssets];
  const rows = SEGMENTS.map((seg, i) => ({ ...seg, value: values[i] }));
  const activePct = totalAssets > 0 ? Math.round((availableAssets / totalAssets) * 100) : 0;

  return (
    <div className="app-sidebar-panel group relative flex h-full min-h-[220px] w-full flex-col overflow-hidden p-4 sm:p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute left-0 top-5 bottom-5 w-[3px] rounded-r-full bg-primary opacity-80"
      />

      <div className="relative flex items-start justify-between gap-3 pl-2">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
            <MonitorSmartphone className="h-[18px] w-[18px]" />
          </div>
          <div>
            <p className="app-page-eyebrow">Asset fleet</p>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="font-display text-4xl font-bold tabular-nums tracking-tight text-primary">
                {totalAssets}
              </span>
              <span className="text-sm font-medium text-muted-foreground">devices</span>
            </div>
          </div>
        </div>
        <Link
          href="/assets?scope=all"
          className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1.5 text-[11px] font-semibold text-primary ring-1 ring-primary/15 transition-all hover:bg-primary/15"
        >
          {activePct}% active
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="relative mt-5 pl-2">
        <div className="flex h-3 overflow-hidden rounded-full bg-primary/5 p-0.5 ring-1 ring-primary/10">
          {rows.map((row, i) => {
            const pct = totalAssets > 0 ? (row.value / totalAssets) * 100 : 0;
            if (pct <= 0) return null;
            return (
              <motion.div
                key={row.label}
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: `${pct}%`, opacity: 1 }}
                transition={{ duration: 0.65, delay: i * 0.07, ease: [0.22, 1, 0.36, 1] }}
                className={cn(row.bar, "mx-px first:ml-0 last:mr-0 rounded-full")}
                title={`${row.label}: ${row.value}`}
              />
            );
          })}
        </div>
        <div className="mt-1.5 flex justify-between text-[9px] font-medium text-muted-foreground/70">
          <span>Distribution</span>
          <span className="tabular-nums">{totalAssets} total</span>
        </div>
      </div>

      <div className="relative mt-auto grid grid-cols-4 gap-2 pl-2 pt-4">
        {rows.map((row, i) => (
          <motion.div
            key={row.label}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.05 }}
          >
            <Link href={row.href} className="group/pill block min-w-0">
              <div
                className={cn(
                  "rounded-2xl border px-2 py-2.5 text-center transition-all duration-200",
                  "group-hover/pill:-translate-y-0.5 group-hover/pill:shadow-[0_6px_16px_rgba(53,88,114,0.08)]",
                  row.pill
                )}
              >
                <div className="flex items-center justify-center gap-1">
                  <span className={cn("h-1.5 w-1.5 rounded-full", row.dot)} />
                  <span className="truncate text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {row.label}
                  </span>
                </div>
                <p className="mt-1 font-display text-lg font-bold tabular-nums text-primary">{row.value}</p>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
