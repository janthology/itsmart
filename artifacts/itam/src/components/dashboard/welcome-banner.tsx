import { Link } from "wouter";
import { ROLE_LABEL as ROLE_LABELS } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Plus, ArrowUpRight, Sparkles } from "lucide-react";
import { format } from "date-fns";
import type { UserProfile } from "@/lib/supabase-queries";
import { motion } from "framer-motion";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}


function getInitials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

interface WelcomeBannerProps {
  user: UserProfile;
}

export function WelcomeBanner({ user }: WelcomeBannerProps) {
  const firstName = user.fullName.split(" ")[0] || user.fullName;
  const isGeneral = user.role === "general_user";

  return (
    <section className="app-sidebar-panel relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-12 -left-8 h-36 w-36 rounded-full bg-accent/15 blur-3xl"
      />

      <div className="relative flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between md:p-8">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="flex items-start gap-4 min-w-0"
        >
          <Avatar className="h-14 w-14 shrink-0 ring-2 ring-primary/15 shadow-md">
            <AvatarFallback className="bg-gradient-to-br from-primary/15 to-accent/20 text-primary text-base font-bold">
              {getInitials(user.fullName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="app-page-eyebrow">{format(new Date(), "EEEE · MMMM d")}</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold text-primary">
                <Sparkles className="h-3 w-3" />
                {ROLE_LABELS[user.role] ?? user.role}
              </span>
            </div>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-foreground md:text-4xl">
              {getGreeting()}, <span className="text-primary">{firstName}</span>
            </h1>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
              {isGeneral
                ? "Your personal command center for support requests and assigned equipment."
                : "Real-time visibility into tickets, assets, and team performance."}
            </p>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="flex flex-col gap-2 sm:flex-row shrink-0"
        >
          <Link href="/tickets">
            <Button size="lg" className="h-11 w-full gap-2 rounded-2xl px-6 shadow-sm sm:w-auto">
              <Plus className="h-4 w-4" />
              {isGeneral ? "New ticket" : "View tickets"}
            </Button>
          </Link>
          {!isGeneral && (
            <Link href="/assets">
              <Button
                size="lg"
                variant="outline"
                className="h-11 w-full gap-2 rounded-2xl border-primary/20 bg-card/80 px-6 text-primary hover:bg-primary/[0.06] sm:w-auto"
              >
                Browse assets
                <ArrowUpRight className="h-4 w-4" />
              </Button>
            </Link>
          )}
        </motion.div>
      </div>
    </section>
  );
}
