import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const variants: Record<string, string> = {
    // Assets — active is blue (assigned/in-use), not green (green = resolved tickets)
    active:      "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/30",
    inactive:    "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/20 dark:text-slate-300 dark:border-slate-500/30",
    maintenance: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/30",
    retired:     "bg-red-100 text-red-700 border-red-200 dark:bg-red-500/20 dark:text-red-300 dark:border-red-500/30",

    // Tickets
    open:        "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-500/20 dark:text-yellow-300 dark:border-yellow-500/30",
    open_urgent: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-500/20 dark:text-orange-300 dark:border-orange-500/30",
    in_progress: "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-500/20 dark:text-sky-300 dark:border-sky-500/30",
    on_hold:     "bg-neutral-200 text-neutral-700 border-neutral-300 dark:bg-neutral-600/30 dark:text-neutral-300 dark:border-neutral-500/30",
    resolved:    "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/30",
    closed:      "bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-700/20 dark:text-gray-400 dark:border-gray-600/30",

    // Priority — solid filled for visibility
    low:      "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-700/40 dark:text-slate-300 dark:border-slate-600",
    medium:   "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-700/30 dark:text-blue-300 dark:border-blue-600",
    high:     "bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-700/30 dark:text-orange-300 dark:border-orange-600",
    critical: "bg-red-100 text-red-700 border-red-300 dark:bg-red-700/30 dark:text-red-300 dark:border-red-600",
  };

  const labelOverrides: Record<string, string> = {
    open_urgent:    'Open',
    in_maintenance: 'In Maintenance',
    in_progress:    'In Progress',
    on_hold:        'On Hold',
    critical:       'Critical - 1',
    high:           'High - 2',
    medium:         'Medium - 3',
    low:            'Low - 4',
  };

  const formattedStatus = labelOverrides[status.toLowerCase()] ?? status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  return (
    <Badge variant="outline" className={cn("font-medium", variants[status.toLowerCase()] ?? "bg-muted text-muted-foreground border-border", className)}>
      {formattedStatus}
    </Badge>
  );
}
