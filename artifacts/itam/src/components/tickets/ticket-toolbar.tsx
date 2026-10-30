import { memo } from "react";
import { Search, X, Keyboard } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const PRIORITIES = [
  { key: "all", label: "All" },
  { key: "critical", label: "Critical" },
  { key: "high", label: "High" },
  { key: "medium", label: "Medium" },
  { key: "low", label: "Low" },
];

interface AssignableStaff {
  id: string;
  fullName: string;
}

interface TicketToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  priorityFilter: string;
  onPriorityChange: (value: string) => void;
  assigneeFilter: string;
  onAssigneeChange: (value: string) => void;
  assignableStaff: AssignableStaff[];
  isAdmin: boolean;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

export const TicketToolbar = memo(function TicketToolbar({
  search,
  onSearchChange,
  priorityFilter,
  onPriorityChange,
  assigneeFilter,
  onAssigneeChange,
  assignableStaff,
  isAdmin,
  hasActiveFilters,
  onClearFilters,
}: TicketToolbarProps) {
  return (
    <div className="app-surface overflow-hidden p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-primary/60">
          Find tickets
        </span>
        <span className="hidden items-center gap-1.5 text-[10px] text-muted-foreground sm:flex">
          <Keyboard className="h-3 w-3" />
          <kbd className="rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px]">N</kbd>
          new
          <span className="mx-0.5">·</span>
          <kbd className="rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px]">/</kbd>
          search
        </span>
      </div>

      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by title, ticket no., or requester..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-11 rounded-xl border-primary/10 bg-background/90 pl-10 shadow-sm transition-shadow focus-visible:shadow-md focus-visible:ring-primary/20 dark:bg-background/60"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Priority
        </span>
        {PRIORITIES.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => onPriorityChange(key)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-200",
              priorityFilter === key
                ? "bg-primary text-primary-foreground shadow-md shadow-primary/15"
                : "bg-primary/[0.05] text-muted-foreground ring-1 ring-primary/10 hover:bg-primary/[0.09] hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}

        {isAdmin && (
          <Select value={assigneeFilter} onValueChange={onAssigneeChange}>
            <SelectTrigger className="ml-auto h-8 w-[148px] rounded-full border-border/50 text-xs">
              <SelectValue placeholder="Assignee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All assignees</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {assignableStaff.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.fullName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-8 rounded-full text-muted-foreground", !isAdmin && "ml-auto")}
            onClick={onClearFilters}
          >
            <X className="mr-1 h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>
    </div>
  );
});
