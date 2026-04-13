import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { useSidebar } from "@/lib/sidebar-context";
import {
  LayoutDashboard, MonitorSmartphone, TicketCheck,
  Users, Tags, LogOut, UserCircle, FileBarChart2,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function Sidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { collapsed, toggle } = useSidebar();
  const isAdmin = user?.role === 'administrator';

  const navItems = [
    { href: "/dashboard",        label: "Dashboard",  icon: LayoutDashboard },
    { href: "/assets",           label: "Assets",     icon: MonitorSmartphone },
    { href: "/tickets",          label: "Tickets",    icon: TicketCheck },
    { href: "/reports",          label: "Reports",    icon: FileBarChart2 },
    ...(isAdmin ? [
      { href: "/admin/users",      label: "Users",      icon: Users },
      { href: "/admin/categories", label: "Categories", icon: Tags },
    ] : []),
  ];

  return (
    <aside className={cn(
      "bg-sidebar border-r border-sidebar-border h-screen flex flex-col fixed left-0 top-0 z-40 text-sidebar-foreground transition-all duration-300",
      collapsed ? "w-16" : "w-64"
    )}>
      {/* Logo */}
      <div className="flex items-center border-b border-sidebar-border px-3 py-3 shrink-0" style={{ minHeight: "4rem" }}>
        <div className="flex items-center gap-2 min-w-0">
          <img src="/dostlogo.png" alt="DOST Logo" className="w-8 h-8 object-contain shrink-0" />
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="font-display font-bold text-sm tracking-tight">IT Support and</span>
              <span className="font-display font-bold text-sm tracking-tight">Asset Management</span>
            </div>
          )}
        </div>
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto py-4 px-2 flex flex-col gap-0.5">
        {!collapsed && (
          <p className="px-3 mb-2 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
            Main Menu
          </p>
        )}
        {navItems.map((item) => {
          const isActive = location === item.href || (location.startsWith(item.href) && item.href !== '/dashboard');
          const linkEl = (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-all duration-200 group",
                collapsed && "justify-center px-0",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md shadow-primary/20"
                  : "text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent"
              )}
            >
              <item.icon className={cn("w-5 h-5 shrink-0 transition-transform duration-200", isActive ? "scale-110" : "group-hover:scale-110")} />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
          if (collapsed) {
            return (
              <Tooltip key={item.href} delayDuration={0}>
                <TooltipTrigger asChild>{linkEl}</TooltipTrigger>
                <TooltipContent side="right" className="font-medium">{item.label}</TooltipContent>
              </Tooltip>
            );
          }
          return linkEl;
        })}
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-sidebar-border flex flex-col gap-1 shrink-0">
        {collapsed ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Link href="/profile" className={cn(
                "flex items-center justify-center px-0 py-2.5 rounded-xl transition-colors",
                location === '/profile' ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent"
              )}>
                <UserCircle className="w-5 h-5" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p className="font-medium">{user?.fullName}</p>
              <p className="text-xs opacity-70">{user?.role.replace('_', ' ')}</p>
            </TooltipContent>
          </Tooltip>
        ) : (
          <Link href="/profile" className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-colors",
            location === '/profile' ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent"
          )}>
            <UserCircle className="w-5 h-5 shrink-0" />
            <div className="flex flex-col truncate min-w-0">
              <span className="truncate text-sm">{user?.fullName}</span>
              <span className="truncate text-xs opacity-60 font-normal">{user?.role.replace('_', ' ')}</span>
            </div>
          </Link>
        )}

        {collapsed ? (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button onClick={logout} className="flex items-center justify-center px-0 py-2.5 rounded-xl text-sidebar-foreground/80 hover:text-destructive hover:bg-destructive/10 transition-colors w-full">
                <LogOut className="w-5 h-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Sign Out</TooltipContent>
          </Tooltip>
        ) : (
          <button onClick={logout} className="flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sidebar-foreground/80 hover:text-destructive hover:bg-destructive/10 transition-colors w-full text-left">
            <LogOut className="w-5 h-5" />
            Sign Out
          </button>
        )}

        <button
          onClick={toggle}
          className="flex items-center justify-center w-full py-2 rounded-xl text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors mt-1"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>
    </aside>
  );
}

