import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "./lib/auth-context";
import { NotificationsProvider } from "./lib/notifications-context";
import { Loader2 } from "lucide-react";

// Pages
import Login from "./pages/login";
import Register from "./pages/register";
import Dashboard from "./pages/dashboard";
import AssetsList from "./pages/assets/index";
import AssetDetail from "./pages/assets/detail";
import TicketsList from "./pages/tickets/index";
import TicketDetail from "./pages/tickets/detail";
import UsersManagement from "./pages/admin/users";
import CategoriesManagement from "./pages/admin/categories";
import Profile from "./pages/profile";
import Reports from "./pages/reports";
import ChangePassword from "./pages/change-password";
import NotFound from "./pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />

      <Route path="/dashboard">{() => <ProtectedRoute component={Dashboard} />}</Route>
      <Route path="/assets">{() => <ProtectedRoute component={AssetsList} />}</Route>
      <Route path="/assets/:id">{() => <ProtectedRoute component={AssetDetail} />}</Route>
      <Route path="/tickets">{() => <ProtectedRoute component={TicketsList} />}</Route>
      <Route path="/tickets/:id">{() => <ProtectedRoute component={TicketDetail} />}</Route>
      <Route path="/admin/users">{() => <ProtectedRoute component={UsersManagement} />}</Route>
      <Route path="/admin/categories">{() => <ProtectedRoute component={CategoriesManagement} />}</Route>
      <Route path="/reports">{() => <ProtectedRoute component={Reports} />}</Route>
      <Route path="/profile">{() => <ProtectedRoute component={Profile} />}</Route>
      <Route path="/change-password">{() => <ProtectedRoute component={ChangePassword} />}</Route>

      <Route path="/">
        <Redirect to="/dashboard" />
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <NotificationsProvider>
              <Router />
              <Toaster />
            </NotificationsProvider>
          </AuthProvider>
        </WouterRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
