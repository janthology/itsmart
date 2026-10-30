import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "./lib/auth-context";
import { NotificationsProvider } from "./lib/notifications-context";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { Loader2 } from "lucide-react";
import { ErrorBoundary } from "@/components/error-boundary";

// Pages. Login stays eagerly loaded (it is the first screen for signed-out
// visitors); every other page is code-split with React.lazy so the browser
// only downloads the page being visited instead of the whole app upfront.
import Login from "./pages/login";

const Dashboard = lazy(() => import("./pages/dashboard"));
const AssetsList = lazy(() => import("./pages/assets/index"));
const AssetDetail = lazy(() => import("./pages/assets/detail"));
const TicketsList = lazy(() => import("./pages/tickets/index"));
const TicketDetail = lazy(() => import("./pages/tickets/detail"));
const UsersManagement = lazy(() => import("./pages/admin/users"));
const Profile = lazy(() => import("./pages/profile"));
const Reports = lazy(() => import("./pages/reports"));
const ChangePassword = lazy(() => import("./pages/change-password"));
const CalendarPage = lazy(() => import("./pages/calendar"));
const NotFound = lazy(() => import("./pages/not-found"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { isAuthenticated, isLoading, mustChangePassword } = useAuth();
  const [location] = useLocation();

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

  // Block all pages except /change-password until the password is changed
  if (mustChangePassword && location !== '/change-password') {
    return <Redirect to="/change-password" />;
  }

  return <Component />;
}

function PageLoading() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<PageLoading />}>
    <Switch>
      <Route path="/login" component={Login} />
      {/* Public signup is disabled — accounts are created by administrators.
          Keep /register as a redirect so old links/bookmarks land on login. */}
      <Route path="/register">{() => <Redirect to="/login" />}</Route>

      <Route path="/dashboard">{() => <ProtectedRoute component={Dashboard} />}</Route>
      <Route path="/assets">{() => <ProtectedRoute component={AssetsList} />}</Route>
      <Route path="/assets/:id">{() => <ProtectedRoute component={AssetDetail} />}</Route>
      <Route path="/tickets">{() => <ProtectedRoute component={TicketsList} />}</Route>
      <Route path="/tickets/:id">{() => <ProtectedRoute component={TicketDetail} />}</Route>
      <Route path="/admin/users">{() => <ProtectedRoute component={UsersManagement} />}</Route>
      <Route path="/reports">{() => <ProtectedRoute component={Reports} />}</Route>
      <Route path="/profile">{() => <ProtectedRoute component={Profile} />}</Route>
      <Route path="/change-password">{() => <ProtectedRoute component={ChangePassword} />}</Route>
      <Route path="/calendar">{() => <ProtectedRoute component={CalendarPage} />}</Route>

      <Route path="/">
        <Redirect to="/dashboard" />
      </Route>

      <Route component={NotFound} />
    </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthProvider>
              <NotificationsProvider>
                <ErrorBoundary>
                  <Router />
                </ErrorBoundary>
                <Toaster />
              </NotificationsProvider>
            </AuthProvider>
          </WouterRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
