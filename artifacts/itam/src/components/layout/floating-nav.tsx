import { memo } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import {
  LayoutDashboard,
  MonitorSmartphone,
  TicketCheck,
  Users,
  FileBarChart2,
  CalendarDays,
  LogOut,
  UserCircle,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationsBell } from "@/components/ui/notifications-bell";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { motion } from "framer-motion";

const ROLE_LABELS: Record<string, string> = {
  administrator: "Administrator",
  support_staff: "Support Staff",
  general_user: "General User",
};

function getInitials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// Memoized: takes no props, so it never needs to re-render when page state
// (dialogs, filters, forms) changes underneath it.
export const FloatingNav = memo(function FloatingNav() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === "administrator";

  const navItems = [
    { href: "/dashboard", label: "Home", icon: LayoutDashboard },
    { href: "/assets", label: "Assets", icon: MonitorSmartphone },
    { href: "/tickets", label: "Tickets", icon: TicketCheck },
    { href: "/reports", label: "Reports", icon: FileBarChart2 },
    { href: "/calendar", label: "Calendar", icon: CalendarDays },
    ...(isAdmin ? [{ href: "/admin/users", label: "Users", icon: Users }] : []),
  ];

  const isActive = (href: string) =>
    location === href || (location.startsWith(href) && href !== "/dashboard");

  const mobileItems = navItems.slice(0, 4);
  const overflowItems = navItems.slice(4);

  return (
    <>
      {/* Desktop top bar */}
      <header className="fixed top-0 left-0 right-0 z-50 px-4 pt-4 md:px-6">
        <div
          className={cn(
            "mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-4 rounded-2xl px-4 md:px-5",
            "border border-primary/10 bg-card/85 shadow-[0_8px_32px_rgba(53,88,114,0.08)] backdrop-blur-xl",
            "dark:border-white/10 dark:bg-card/70 dark:shadow-[0_8px_32px_rgba(0,0,0,0.35)]"
          )}
        >
          {/* Brand */}
          <Link href="/dashboard" className="flex items-center gap-2.5 shrink-0 group">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[hsl(207_38%_28%)] shadow-md shadow-primary/20 ring-1 ring-white/20">
              <img src="/dostlogo.png" alt="DOST" className="h-5 w-5 object-contain" />
            </div>
            <div className="hidden sm:block leading-none">
              <p className="font-display text-sm font-bold tracking-tight text-foreground group-hover:text-primary transition-colors">
                ITSMART
              </p>
              <p className="text-[10px] text-muted-foreground">Asset & Support</p>
            </div>
          </Link>

          {/* Center pill nav — desktop */}
          <nav className="hidden lg:flex items-center gap-1 rounded-full border border-primary/10 bg-primary/[0.04] p-1">
            {navItems.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href}>
                  <span
                    className={cn(
                      "relative flex items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-medium transition-colors",
                      active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="nav-pill"
                        className="absolute inset-0 rounded-full bg-card shadow-sm ring-1 ring-primary/15 dark:bg-card/90"
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      />
                    )}
                    <Icon className="relative h-4 w-4" strokeWidth={active ? 2.25 : 2} />
                    <span className="relative">{item.label}</span>
                  </span>
                </Link>
              );
            })}
          </nav>

          {/* Right actions */}
          <div className="flex items-center gap-2 shrink-0">
            <ThemeToggle />
            <NotificationsBell />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-full p-0.5 pr-2.5 hover:bg-muted/50 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  <Avatar className="h-8 w-8 ring-2 ring-primary/10">
                    <AvatarFallback className="bg-gradient-to-br from-primary/20 to-accent/20 text-primary text-[10px] font-bold">
                      {user?.fullName ? getInitials(user.fullName) : "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden md:block text-left max-w-[100px]">
                    <span className="block text-xs font-semibold truncate text-foreground">
                      {user?.fullName?.split(" ")[0]}
                    </span>
                    <span className="block text-[10px] text-muted-foreground truncate">
                      {ROLE_LABELS[user?.role ?? ""] ?? user?.role}
                    </span>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 rounded-xl">
                <DropdownMenuItem asChild>
                  <Link href="/profile" className="cursor-pointer">
                    <UserCircle className="mr-2 h-4 w-4" />
                    My profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={logout}
                  className="text-destructive focus:text-destructive cursor-pointer"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Mobile bottom dock */}
      <nav
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 lg:hidden px-4 pb-4 pt-2",
          "bg-gradient-to-t from-background via-background/95 to-transparent"
        )}
      >
        <div
          className={cn(
            "mx-auto flex max-w-md items-center justify-around gap-1 rounded-2xl px-2 py-2",
            "border border-primary/10 bg-card/90 shadow-[0_8px_32px_rgba(53,88,114,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-card/80 dark:shadow-[0_8px_32px_rgba(0,0,0,0.35)]"
          )}
        >
          {mobileItems.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <span
                  className={cn(
                    "flex flex-col items-center gap-0.5 rounded-xl px-3 py-2 min-w-[56px] transition-all",
                    active
                      ? "text-primary bg-primary/[0.08]"
                      : "text-muted-foreground active:scale-95"
                  )}
                >
                  <Icon className="h-5 w-5" strokeWidth={active ? 2.25 : 2} />
                  <span className="text-[10px] font-medium">{item.label}</span>
                </span>
              </Link>
            );
          })}
          {overflowItems.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex flex-col items-center gap-0.5 rounded-xl px-3 py-2 min-w-[56px] text-muted-foreground"
                >
                  <MoreHorizontal className="h-5 w-5" />
                  <span className="text-[10px] font-medium">More</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="end" className="rounded-xl mb-2">
                {overflowItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <DropdownMenuItem key={item.href} asChild>
                      <Link href={item.href} className="cursor-pointer">
                        <Icon className="mr-2 h-4 w-4" />
                        {item.label}
                      </Link>
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/profile" className="cursor-pointer">
                    <UserCircle className="mr-2 h-4 w-4" />
                    Profile
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </nav>
    </>
  );
});
