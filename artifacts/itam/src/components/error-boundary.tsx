import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Last-resort render guard: if any page throws while rendering, show a
 * friendly recovery screen instead of a blank white page. The error is
 * logged to the console; when a monitoring service (e.g. Sentry) is added
 * later, report it from componentDidCatch.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("[ErrorBoundary] Unhandled render error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/20 dark:text-amber-400">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h1 className="font-display text-lg font-semibold text-foreground">
              Something went wrong
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              The page hit an unexpected error. Refreshing usually fixes it — your data is safe.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Button className="rounded-xl" onClick={() => window.location.reload()}>
                Refresh page
              </Button>
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={() => window.location.assign("/dashboard")}
              >
                Go to dashboard
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
