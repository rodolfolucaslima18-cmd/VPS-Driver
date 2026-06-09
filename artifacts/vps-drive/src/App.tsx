import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";

import LandingPage from "./pages/landing";
import SignInPage from "./pages/sign-in";
import DrivePage from "./pages/drive";
import SetupPage from "./pages/setup";
import AdminPage from "./pages/admin";
import SharePublicPage from "./pages/share-public";
import NotFound from "./pages/not-found";

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Redirect to="/drive" />;
  return <LandingPage />;
}

function DriveRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Redirect to="/sign-in" />;
  return <DrivePage />;
}

function AdminRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Redirect to="/sign-in" />;
  if (user.role !== "master") return <Redirect to="/drive" />;
  return <AdminPage />;
}

function SignInRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Redirect to="/drive" />;
  return <SignInPage />;
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/drive/*?" component={DriveRoute} />
      <Route path="/admin" component={AdminRoute} />
      <Route path="/setup" component={SetupPage} />
      <Route path="/sign-in" component={SignInRoute} />
      <Route path="/share/:token" component={SharePublicPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <TooltipProvider>
      <WouterRouter base={basePath}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </QueryClientProvider>
      </WouterRouter>
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
