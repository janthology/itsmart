import { ReactNode } from "react";
import { FloatingNav } from "./floating-nav";
import { AmbientBackground } from "./ambient-background";
import { BrandLockup } from "./brand-lockup";
import { useAuth } from "@/lib/auth-context";
import { Redirect } from "wouter";
import { Loader2 } from "lucide-react";
import { BackToTop } from "@/components/ui/back-to-top";

export function AppLayout({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <AmbientBackground />
        <div className="flex flex-col items-center gap-5">
          <BrandLockup size="lg" />
          <div className="gooey-loader" />
          <p className="text-sm text-muted-foreground font-medium">Loading ITSMART...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  return (
    <div className="min-h-screen">
      <AmbientBackground />
      <FloatingNav />
      <main className="mx-auto max-w-[1400px] px-4 pb-28 pt-[5.5rem] md:px-6 md:pb-8 lg:pt-24">
        {children}
      </main>
      <BackToTop />
    </div>
  );
}
