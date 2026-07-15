import { useLocation } from "wouter";
import { NotificationsBell } from "@/components/ui/notifications-bell";

export function Header() {
  const [location] = useLocation();

  const getPageTitle = () => {
    if (location === '/dashboard') return 'Dashboard';
    if (location.startsWith('/assets')) return 'Assets';
    if (location.startsWith('/tickets')) return 'Tickets';
    if (location.startsWith('/admin/users')) return 'Users';
    if (location === '/profile') return 'My Profile';
    if (location === '/reports') return 'Reports';
    if (location === '/calendar') return 'Calendar';
    if (location === '/change-password') return 'Change Password';
    return '';
  };

  return (
    <header className="h-16 bg-card/80 backdrop-blur-md border-b border-border flex items-center justify-between px-8 sticky top-0 z-30 transition-all">
      <div>
        <h1 className="text-xl font-bold text-foreground">{getPageTitle()}</h1>
      </div>
      <div className="flex items-center gap-4">
        <NotificationsBell />
      </div>
    </header>
  );
}
