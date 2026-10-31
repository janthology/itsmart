import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import {
  Loader2,
  Eye,
  EyeOff,
  ArrowRight,
  ShieldCheck,
  TicketCheck,
  MonitorSmartphone,
  BarChart3,
  CalendarDays,
  Lock,
  Mail,
  CircleAlert,
  TriangleAlert,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ModulePreview } from "@/components/login/module-previews";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { BrandLockup } from "@/components/layout/brand-lockup";

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

const ROTATING_LINES = [
  "Track every asset. Resolve every ticket.",
  "Your IT operations command center.",
  "DOST Cagayan Valley — secure by design.",
];

const MODULES = [
  {
    type: "tickets",
    icon: TicketCheck,
    title: "Support tickets",
    desc: "Submit and resolve requests",
    color: "from-amber-500/25 via-amber-500/10 to-transparent",
    iconColor: "text-amber-400",
    glow: "bg-amber-400",
    ring: "ring-amber-400/40",
  },
  {
    type: "assets",
    icon: MonitorSmartphone,
    title: "Asset inventory",
    desc: "Equipment lifecycle tracking",
    color: "from-sky-500/25 via-sky-500/10 to-transparent",
    iconColor: "text-sky-400",
    glow: "bg-sky-400",
    ring: "ring-sky-400/40",
  },
  {
    type: "reports",
    icon: BarChart3,
    title: "Reports",
    desc: "Insights and analytics",
    color: "from-emerald-500/25 via-emerald-500/10 to-transparent",
    iconColor: "text-emerald-400",
    glow: "bg-emerald-400",
    ring: "ring-emerald-400/40",
  },
  {
    type: "calendar",
    icon: CalendarDays,
    title: "Calendar",
    desc: "Maintenance scheduling",
    color: "from-violet-500/25 via-violet-500/10 to-transparent",
    iconColor: "text-violet-400",
    glow: "bg-violet-400",
    ring: "ring-violet-400/40",
  },
];

function LoginModuleCard({
  mod,
  index,
  isActive,
}: {
  mod: (typeof MODULES)[number];
  index: number;
  isActive: boolean;
}) {
  const Icon = mod.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.1 + index * 0.07, type: "spring", stiffness: 280, damping: 24 }}
      className="login-module-card group relative flex h-full min-h-0 cursor-default flex-col overflow-hidden rounded-lg border border-white/[0.08] p-2.5 sm:p-3"
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${mod.color}`} />
      {/* Static soft glow — no infinite pulsing (calmer, and kinder to
          motion-sensitive users); only the highlight ring cycles. */}
      <div
        className={`absolute -right-4 -top-4 h-16 w-16 rounded-full blur-2xl transition-opacity duration-700 ${mod.glow} ${isActive ? "opacity-30" : "opacity-10"}`}
      />
      <motion.div
        animate={{ opacity: isActive ? 1 : 0 }}
        className={`absolute inset-0 rounded-lg ring-2 ${mod.ring}`}
        transition={{ duration: 0.4 }}
      />

      <div className="relative flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.1] ${mod.iconColor}`}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-white/95 leading-tight">{mod.title}</p>
            <p className="text-[10px] text-white/60 leading-snug line-clamp-1">{mod.desc}</p>
          </div>
        </div>
        <div className="mt-1.5 min-h-0 flex-1">
          <ModulePreview type={mod.type} isActive={isActive} />
        </div>
      </div>
    </motion.div>
  );
}

const LAST_EMAIL_KEY = "itsmart-last-email";

/** Turns a raw sign-in failure into a message the user can act on. */
function describeLoginError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/invalid login credentials/i.test(message)) {
    return "Incorrect email or password. Check your credentials and try again.";
  }
  if (/account deactivated/i.test(message)) {
    return "Your account has been deactivated. Please contact an administrator.";
  }
  if (/failed to fetch|network|fetch|timed out|timeout/i.test(message)) {
    return "Can't reach the server. Check your internet connection and try again.";
  }
  if (/email not confirmed/i.test(message)) {
    return "This account's email has not been confirmed. Please contact an administrator.";
  }
  return message || "Sign-in failed. Please try again.";
}

export default function Login() {
  const { login } = useAuth();
  const [isPending, setIsPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [lineIndex, setLineIndex] = useState(0);
  const [activeModule, setActiveModule] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  // Prefill the last-used email (address only — never the password).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LAST_EMAIL_KEY);
      if (saved) form.setValue("email", saved);
    } catch {
      /* storage unavailable — no prefill */
    }
  }, [form]);

  // Real connectivity status for the status pill.
  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // Gentle rotation, paused entirely for reduced-motion users.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setLineIndex((i) => (i + 1) % ROTATING_LINES.length), 8000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setActiveModule((i) => (i + 1) % MODULES.length), 4500);
    return () => clearInterval(timer);
  }, []);

  // Editing either field after a failure clears the error message.
  useEffect(() => {
    const sub = form.watch(() => setFormError(null));
    return () => sub.unsubscribe();
  }, [form]);

  const onSubmit = async (values: z.infer<typeof loginSchema>) => {
    setIsPending(true);
    setFormError(null);
    try {
      try {
        window.localStorage.setItem(LAST_EMAIL_KEY, values.email);
      } catch {
        /* storage unavailable — sign-in still proceeds */
      }
      await login(values);
    } catch (err) {
      setFormError(describeLoginError(err));
      setIsPending(false);
    }
  };

  return (
    <div className="relative flex h-dvh max-h-dvh items-center justify-center overflow-hidden bg-background p-2 sm:p-3">
      {/* Background */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: `
              linear-gradient(hsl(207 55% 62% / 0.07) 1px, transparent 1px),
              linear-gradient(90deg, hsl(207 55% 62% / 0.07) 1px, transparent 1px)
            `,
            backgroundSize: "48px 48px",
          }}
        />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 h-[50%] w-[70%] rounded-full bg-[hsl(207_55%_50%/0.12)] blur-[90px]" />
      </div>

      {/* Main panel — locked to viewport */}
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45 }}
        className="relative z-10 flex h-full max-h-[calc(100dvh-1rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[0_32px_80px_rgba(0,0,0,0.25)] lg:grid lg:grid-cols-5 lg:rounded-[1.5rem]"
      >
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent" />

        {/* Mobile brand strip — always dark, matching the desktop brand panel */}
        <div className="flex shrink-0 items-center gap-2.5 border-b border-white/[0.08] bg-[hsl(207_32%_10%)] px-4 py-3 lg:hidden">
          <BrandLockup tone="dark" size="sm" />
        </div>

        {/* Left: brand + modules (desktop) — stays dark in both themes by design */}
        <div className="hidden min-h-0 flex-col overflow-hidden bg-[hsl(207_32%_10%)] lg:flex lg:col-span-3 p-4 sm:p-5 lg:p-6">
          <div className="flex shrink-0 items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <BrandLockup tone="dark" size="lg" />
            </div>
            <div className="hidden sm:flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1">
              <span className="relative flex h-1.5 w-1.5">
                {isOnline && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                )}
                <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${isOnline ? "bg-emerald-400" : "bg-amber-400"}`} />
              </span>
              <span className="text-[10px] font-medium text-white/70">
                {isOnline ? "Online" : "Offline"}
              </span>
            </div>
          </div>

          <div aria-hidden="true" className="mt-3 h-9 shrink-0 overflow-hidden sm:mt-4 sm:h-10">
            <AnimatePresence mode="wait">
              <motion.p
                key={lineIndex}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.4 }}
                className="text-base font-display font-semibold text-white/90 leading-snug sm:text-lg"
              >
                {ROTATING_LINES[lineIndex]}
              </motion.p>
            </AnimatePresence>
          </div>

          <div className="mt-2 grid min-h-0 flex-1 grid-cols-2 gap-1.5 sm:gap-2">
            {MODULES.map((mod, i) => (
              <LoginModuleCard key={mod.title} mod={mod} index={i} isActive={activeModule === i} />
            ))}
          </div>

          <div className="mt-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-white/55">
            <span className="flex items-center gap-1">
              <ShieldCheck className="h-3 w-3" />
              Authorized personnel only
            </span>
            <span className="flex items-center gap-1">
              <Lock className="h-3 w-3" />
              Access monitored
            </span>
          </div>
        </div>

        {/* Sign in — follows the light/dark theme */}
        <div className="relative flex min-h-0 flex-1 flex-col justify-center overflow-hidden bg-card p-4 sm:p-5 lg:col-span-2 lg:border-l lg:border-border lg:p-6">
          <div className="absolute right-4 top-4 z-10">
            <ThemeToggle />
          </div>
          <motion.div
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.08 }}
            className="relative mx-auto w-full max-w-sm"
          >
            <div className="mb-3 sm:mb-4">
              <div className="hidden items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-0.5 lg:inline-flex">
                <Lock className="h-3 w-3 text-primary" />
                <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Secure sign in
                </span>
              </div>
              <h2 className="font-display text-xl font-bold text-foreground lg:mt-3 sm:text-2xl">Welcome back</h2>
              <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
                Sign in with your DOST Cagayan Valley credentials.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-muted/30 p-4 sm:rounded-2xl sm:p-5">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[11px] font-medium text-muted-foreground">Email</FormLabel>
                        <FormControl>
                          <div className="group relative">
                            <Mail className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60 group-focus-within:text-primary" />
                            <Input
                              type="email"
                              autoComplete="email"
                              autoFocus
                              disabled={isPending}
                              placeholder="you@dost.gov.ph"
                              {...field}
                              className="h-10 rounded-lg bg-background pl-9 text-sm placeholder:text-muted-foreground/60"
                            />
                          </div>
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[11px] font-medium text-muted-foreground">Password</FormLabel>
                        <FormControl>
                          <div className="group relative">
                            <Lock className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60 group-focus-within:text-primary" />
                            <Input
                              type={showPassword ? "text" : "password"}
                              autoComplete="current-password"
                              disabled={isPending}
                              placeholder="Enter your password"
                              {...field}
                              onKeyDown={(e) => setCapsLockOn(e.getModifierState?.("CapsLock") ?? false)}
                              onKeyUp={(e) => setCapsLockOn(e.getModifierState?.("CapsLock") ?? false)}
                              className="h-10 rounded-lg bg-background pl-9 pr-10 text-sm placeholder:text-muted-foreground/60"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword((v) => !v)}
                              disabled={isPending}
                              aria-label={showPassword ? "Hide password" : "Show password"}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground disabled:opacity-50"
                            >
                              {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </FormControl>
                        {capsLockOn && (
                          <p className="flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                            <TriangleAlert className="h-3 w-3" /> Caps Lock is on
                          </p>
                        )}
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />

                  {formError && (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs leading-relaxed text-destructive"
                    >
                      <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
                      <span>{formError}</span>
                    </div>
                  )}

                  <Button
                    type="submit"
                    disabled={isPending}
                    className="group mt-0.5 h-10 w-full rounded-lg border-0 bg-gradient-to-r from-[hsl(207_55%_48%)] to-[hsl(207_65%_42%)] text-sm font-semibold text-white shadow-[0_6px_24px_hsl(207_55%_40%/0.35)] hover:brightness-110"
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      <>
                        Sign in to ITSMART
                        <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                      </>
                    )}
                  </Button>
                </form>
              </Form>
            </div>

            <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
              Need help? Contact your MIS Admin for password reset or access.
            </p>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
