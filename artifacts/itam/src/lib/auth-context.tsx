import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { UserProfile, LoginRequest, RegisterRequest } from "@workspace/api-client-react";
import { useGetCurrentUser, useLogin, useRegister, useLogout } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  login: (data: LoginRequest) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem('itam_token'));
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch current user if we have a token
  const { data: user, isLoading, isError } = useGetCurrentUser({
    query: {
      enabled: !!token,
      retry: false,
    }
  });

  const loginMutation = useLogin();
  const registerMutation = useRegister();
  const logoutMutation = useLogout();

  // Clear token if user fetch fails (e.g. invalid/expired token)
  useEffect(() => {
    if (isError && token) {
      localStorage.removeItem('itam_token');
      setToken(null);
      queryClient.clear();
    }
  }, [isError, token, queryClient]);

  const login = async (data: LoginRequest) => {
    try {
      const response = await loginMutation.mutateAsync({ data });
      localStorage.setItem('itam_token', response.token);
      setToken(response.token);
      queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
      toast({ title: "Welcome back", description: "Successfully logged in." });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Login failed",
        description: error.message || "Invalid credentials. Please try again."
      });
      throw error;
    }
  };

  const register = async (data: RegisterRequest) => {
    try {
      const response = await registerMutation.mutateAsync({ data });
      localStorage.setItem('itam_token', response.token);
      setToken(response.token);
      queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
      toast({ title: "Account created", description: "Welcome to ITAM." });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Registration failed",
        description: error.message || "Could not create account."
      });
      throw error;
    }
  };

  const logout = async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (e) {
      // ignore logout errors, just clear locally
    } finally {
      localStorage.removeItem('itam_token');
      setToken(null);
      queryClient.clear();
      toast({ title: "Logged out", description: "You have been logged out successfully." });
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        isLoading: isLoading && !!token,
        isAuthenticated: !!user,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
