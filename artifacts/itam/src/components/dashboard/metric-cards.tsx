import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Clock,
  Monitor,
  TicketIcon,
  ArrowUpRight,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type MetricAccent = "primary" | "warning" | "success" | "info" | "violet";

export interface MetricConfig {
  title: string;
  value: number;
  icon: LucideIcon;
  href: string;
  accent: MetricAccent;
}

const accentStyles: Record<
  MetricAccent,
  { gradient: string; icon: string; bar: string }
> = {
  primary: {
    gradient: "from-primary/12 via-primary/4 to-transparent",
    icon: "text-primary bg-primary/10 ring-primary/15",
    bar: "bg-primary",
  },
  warning: {
    gradient: "from-primary/8 via-amber-500/5 to-transparent",
    icon: "text-amber-700 bg-amber-500/10 ring-amber-500/15",
    bar: "bg-amber-500",
  },
  success: {
    gradient: "from-primary/8 via-emerald-500/5 to-transparent",
    icon: "text-emerald-700 bg-emerald-500/10 ring-emerald-500/15",
    bar: "bg-emerald-500",
  },
  info: {
    gradient: "from-primary/10 via-accent/8 to-transparent",
    icon: "text-primary bg-accent/15 ring-accent/20",
    bar: "bg-accent",
  },
  violet: {
    gradient: "from-primary/8 via-primary/5 to-transparent",
    icon: "text-primary bg-primary/8 ring-primary/12",
    bar: "bg-primary/70",
  },
};

export const motionItem = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 400, damping: 32 } },
};

interface MetricGridProps {
  metrics: MetricConfig[];
}

export function MetricGrid({ metrics }: MetricGridProps) {
  return (
    <div
      className={cn(
        "grid gap-3",
        metrics.length <= 3
          ? "grid-cols-1 sm:grid-cols-3"
          : metrics.length === 4
            ? "grid-cols-2 lg:grid-cols-4"
            : metrics.length === 5
              ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
              : metrics.length === 6
                ? "grid-cols-2 sm:grid-cols-3"
                : metrics.length === 9
                  ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-3"
                  : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
      )}
    >
      {metrics.map((metric) => {
        const styles = accentStyles[metric.accent];
        return (
          <motion.div key={metric.title} variants={motionItem}>
            <Link href={metric.href}>
              <article
                className={cn(
                  "group relative flex h-full flex-col overflow-hidden rounded-2xl border border-primary/10",
                  "bg-card/80 backdrop-blur-xl p-4 transition-all duration-300",
                  "hover:border-primary/25 hover:shadow-[0_16px_48px_rgba(53,88,114,0.12)] hover:-translate-y-1",
                  "shadow-[0_4px_20px_rgba(53,88,114,0.05)]"
                )}
              >
                <div className={cn("absolute left-0 top-0 bottom-0 w-1", styles.bar)} />
                <div
                  className={cn(
                    "absolute inset-0 bg-gradient-to-br opacity-70",
                    styles.gradient
                  )}
                />
                <div className="relative flex items-start justify-between gap-2 pl-1">
                  <div
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-xl ring-1 transition-transform group-hover:scale-110",
                      styles.icon
                    )}
                  >
                    <metric.icon className="h-[18px] w-[18px]" />
                  </div>
                  <ArrowUpRight
                    className="h-4 w-4 text-muted-foreground/30 group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all"
                  />
                </div>
                <div className="relative mt-4 pl-1">
                  <p className="text-3xl font-display font-bold tabular-nums text-primary tracking-tight">
                    {metric.value}
                  </p>
                  <p className="mt-1 text-xs font-medium text-muted-foreground leading-snug">
                    {metric.title}
                  </p>
                </div>
              </article>
            </Link>
          </motion.div>
        );
      })}
    </div>
  );
}

export function buildDashboardMetrics(
  stats: Record<string, number>,
  role: string
): MetricConfig[] {
  if (role === "administrator") {
    return [
      {
        title: "Total assets",
        value: stats.totalAssets ?? 0,
        icon: Monitor,
        href: "/assets?scope=all",
        accent: "primary",
      },
      {
        title: "Active assets",
        value: stats.availableAssets ?? 0,
        icon: CheckCircle2,
        href: "/assets?status=active&scope=all",
        accent: "success",
      },
      {
        title: "Inactive assets",
        value: stats.inactiveAssets ?? 0,
        icon: Archive,
        href: "/assets?status=inactive&scope=all",
        accent: "violet",
      },
      {
        title: "Assets assigned to me",
        value: stats.myAssignedAssets ?? 0,
        icon: Monitor,
        href: "/assets?scope=mine",
        accent: "primary",
      },
      {
        title: "All tickets",
        value: stats.allTickets ?? stats.totalTickets ?? 0,
        icon: TicketIcon,
        href: "/tickets?scope=all",
        accent: "primary",
      },
      {
        title: "Open tickets",
        value: stats.openTickets ?? 0,
        icon: AlertCircle,
        href: "/tickets?status=open&scope=all",
        accent: "warning",
      },
      {
        title: "In progress",
        value: stats.inProgressTickets ?? 0,
        icon: Clock,
        href: "/tickets?status=in_progress&scope=all",
        accent: "info",
      },
      {
        title: "Resolved",
        value: stats.resolvedTickets ?? 0,
        icon: CheckCircle2,
        href: "/tickets?status=resolved&scope=all",
        accent: "success",
      },
      {
        title: "Closed",
        value: stats.closedTickets ?? 0,
        icon: Archive,
        href: "/tickets?status=closed&scope=all",
        accent: "violet",
      },
    ];
  }

  if (role === "support_staff") {
    return [
      {
        title: "My queue",
        value: stats.totalTickets ?? 0,
        icon: TicketIcon,
        href: "/tickets?scope=mine",
        accent: "primary",
      },
      {
        title: "Open",
        value: stats.openTickets ?? 0,
        icon: AlertCircle,
        href: "/tickets?status=open&scope=mine",
        accent: "warning",
      },
      {
        title: "In progress",
        value: stats.inProgressTickets ?? 0,
        icon: Clock,
        href: "/tickets?status=in_progress&scope=mine",
        accent: "info",
      },
      {
        title: "Resolved & closed",
        value: stats.resolvedClosedTickets ?? stats.resolvedTickets ?? 0,
        icon: CheckCircle2,
        href: "/tickets?status=resolved_closed&scope=mine",
        accent: "success",
      },
      {
        title: "My assets",
        value: stats.myAssignedAssets ?? 0,
        icon: Monitor,
        href: "/assets?scope=mine",
        accent: "violet",
      },
    ];
  }

  return [
    {
      title: "Open tickets",
      value: stats.openTickets ?? 0,
      icon: AlertCircle,
      href: "/tickets?status=open&scope=mine",
      accent: "warning",
    },
    {
      title: "Resolved & closed",
      value: stats.resolvedClosedTickets ?? stats.resolvedTickets ?? 0,
      icon: CheckCircle2,
      href: "/tickets?status=resolved_closed&scope=mine",
      accent: "success",
    },
    {
      title: "My assets",
      value: stats.myAssignedAssets ?? 0,
      icon: Monitor,
      href: "/assets?scope=mine",
      accent: "primary",
    },
  ];
}
