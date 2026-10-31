import type { ComponentType, ReactNode } from "react";
import { CircleAlert, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shared loading / empty / error states (Phase 5a).
 *
 * Every list page used to improvise its own spinner, "nothing here"
 * message, and silent failure. These three components give the whole app
 * one consistent pattern; pages pass their own copy and actions so the
 * wording users know today does not change.
 */

export function ListSkeleton({ rows = 8, rowHeight = 72 }: { rows?: number; rowHeight?: number }) {
  return (
    <div
      className="space-y-2 rounded-3xl border border-border/60 bg-card/60 p-2"
      aria-hidden="true"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl bg-muted/40 animate-pulse"
          style={{ height: rowHeight }}
        />
      ))}
    </div>
  );
}

interface EmptyStateProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  message: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-border/50 bg-card/75 p-16 text-center shadow-sm">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/[0.08] ring-1 ring-primary/15">
        <Icon className="h-8 w-8 text-primary/60" />
      </div>
      <h3 className="mb-1.5 font-display text-lg font-semibold text-foreground">{title}</h3>
      <p className="mb-6 max-w-sm text-sm leading-relaxed text-muted-foreground">{message}</p>
      {action}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = "Couldn't load this",
  message = "Something went wrong while loading. Check your connection and try again.",
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-3xl border border-destructive/25 bg-destructive/[0.04] p-16 text-center"
    >
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 ring-1 ring-destructive/20">
        <CircleAlert className="h-8 w-8 text-destructive/70" />
      </div>
      <h3 className="mb-1.5 font-display text-lg font-semibold text-foreground">{title}</h3>
      <p className="mb-6 max-w-sm text-sm leading-relaxed text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry} className="gap-2 rounded-xl">
          <RotateCcw className="h-4 w-4" /> Try again
        </Button>
      )}
    </div>
  );
}
