import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { 
  LayoutDashboard, 
  MonitorSmartphone, 
  TicketCheck, 
  Users, 
  Tags, 
  LogOut, 
  UserCircle 
} from "lucide-react";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const isAdmin = user?.role === 'administrator';

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/assets", label: "Assets", icon: MonitorSmartphone },
    { href: "/tickets", label: "Tickets", icon: TicketCheck },
    ...(isAdmin ? [
      { href: "/admin/users", label: "Users", icon: Users },
      { href: "/admin/categories", label: "Categories", icon: Tags },
    ] : []),
  ];

  return (
    <aside className="w-64 bg-sidebar border-r border-sidebar-border h-screen flex flex-col fixed left-0 top-0 z-40 text-sidebar-foreground transition-all">
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-display font-bold shadow-lg shadow-primary/20">
            IT
          </div>
          <span className="font-display font-bold text-lg tracking-tight">ITAM Pro</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-6 px-3 flex flex-col gap-1">
        <div className="px-3 mb-2 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
          Main Menu
        </div>
        {navItems.map((item) => {
          const isActive = location === item.href || (location.startsWith(item.href) && item.href !== '/dashboard');
          return (
            <Link 
              key={item.href} 
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-all duration-200 group",
                isActive 
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md shadow-primary/20" 
                  : "text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent"
              )}
            >
              <item.icon className={cn(
                "w-5 h-5 transition-transform duration-200", 
                isActive ? "scale-110" : "group-hover:scale-110"
              )} />
              {item.label}
            </Link>
          );
        })}
      </div>

      <div className="p-4 border-t border-sidebar-border flex flex-col gap-2">
        <Link 
          href="/profile"
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-colors",
            location === '/profile'
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent"
          )}
        >
          <UserCircle className="w-5 h-5" />
          <div className="flex flex-col truncate">
            <span className="truncate text-sm">{user?.fullName}</span>
            <span className="truncate text-xs opacity-60 font-normal">{user?.role.replace('_', ' ')}</span>
          </div>
        </Link>
        <button
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sidebar-foreground/80 hover:text-destructive hover:bg-destructive/10 transition-colors w-full text-left"
        >
          <LogOut className="w-5 h-5" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
