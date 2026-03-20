import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setupFetchInterceptor } from "./lib/fetch-interceptor";
import { AuthProvider } from "./lib/auth-context";

// Setup global interceptor before anything renders
setupFetchInterceptor();

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
import NotFound from "./pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/dashboard" component={Dashboard} />
      
      <Route path="/assets" component={AssetsList} />
      <Route path="/assets/:id" component={AssetDetail} />
      
      <Route path="/tickets" component={TicketsList} />
      <Route path="/tickets/:id" component={TicketDetail} />
      
      <Route path="/admin/users" component={UsersManagement} />
      <Route path="/admin/categories" component={CategoriesManagement} />
      
      <Route path="/profile" component={Profile} />
      
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
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
