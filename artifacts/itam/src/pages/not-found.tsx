import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { BrandLockup } from "@/components/layout/brand-lockup";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-background px-4">
      <BrandLockup size="lg" />
      <div className="mt-10 flex w-full max-w-md flex-col items-center rounded-3xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
          <Compass className="h-7 w-7" />
        </div>
        <h1 className="mt-5 font-display text-2xl font-bold tracking-tight text-foreground">
          Page not found
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The page you're looking for doesn't exist or may have been moved.
          Check the address, or head back to the dashboard.
        </p>
        <Button asChild className="mt-6 rounded-xl">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
