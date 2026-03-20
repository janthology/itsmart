import { useLocation } from "wouter";

export function Header() {
  const [location] = useLocation();

  // Simple title generator based on route
  const getPageTitle = () => {
    if (location === '/dashboard') return 'Overview';
    if (location.startsWith('/assets')) return 'Asset Management';
    if (location.startsWith('/tickets')) return 'Support Tickets';
    if (location.startsWith('/admin/users')) return 'User Management';
    if (location.startsWith('/admin/categories')) return 'Categories';
    if (location === '/profile') return 'My Profile';
    return '';
  };

  return (
    <header className="h-16 bg-card/80 backdrop-blur-md border-b border-border flex items-center justify-between px-8 sticky top-0 z-30 transition-all">
      <div>
        <h1 className="text-xl font-bold text-foreground">{getPageTitle()}</h1>
      </div>
      <div className="flex items-center gap-4">
        {/* Can add global search or notifications here in the future */}
      </div>
    </header>
  );
}
