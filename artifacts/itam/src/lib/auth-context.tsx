import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { useLocation } from "wouter";
import { supabase } from "./supabase";
import type { UserProfile } from "./supabase-queries";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { User } from "@supabase/supabase-js";

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (data: { email: string; password: string }) => Promise<void>;
  register: (data: { email: string; password: string; fullName: string; department?: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Read role from app_metadata (synced by DB trigger) — instant, no round-trip
function userFromSession(u: User): UserProfile {
  const meta = u.app_metadata ?? {};
  const userMeta = u.user_metadata ?? {};
  return {
    id: u.id,
    email: u.email ?? '',
    fullName: userMeta.full_name ?? u.email ?? '',
    role: meta.role ?? 'general_user',
    department: userMeta.department ?? null,
    createdAt: u.created_at ?? '',
    updatedAt: u.updated_at ?? '',
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const setLocationRef = useRef(setLocation);
  const queryClientRef = useRef(queryClient);
  useEffect(() => { setLocationRef.current = setLocation; }, [setLocation]);
  useEffect(() => { queryClientRef.current = queryClient; }, [queryClient]);

  useEffect(() => {
    let mounted = true;
    let hadSessionOnMount = false;
    let profileChannel: ReturnType<typeof supabase.channel> | null = null;

    const subscribeToProfile = (userId: string) => {
      // Clean up any existing subscription first
      if (profileChannel) supabase.removeChannel(profileChannel);

      profileChannel = supabase
        .channel(`profile-active-${userId}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${userId}`,
        }, (payload) => {
          if (payload.new?.is_active === false) {
            supabase.auth.signOut().then(() => {
              toast({
                variant: "destructive",
                title: "Account deactivated",
                description: "Your account has been deactivated by an administrator.",
              });
            });
          } else if (payload.new?.role && payload.old?.role && payload.new.role !== payload.old.role) {
            supabase.auth.signOut().then(() => {
              toast({
                title: "Role changed",
                description: "Your account role was updated. Please sign in again.",
              });
            });
          }
        })
        .subscribe();
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      if (session?.user) {
        hadSessionOnMount = true;
        setUser(userFromSession(session.user));
        subscribeToProfile(session.user.id);
      }
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      if (session?.user) {
        setUser(userFromSession(session.user));
        // Don't set isLoading false here on SIGNED_IN — login() handles it
        // after the is_active check. Only set it false for non-login events.
        if (event !== 'SIGNED_IN') setIsLoading(false);
        queryClientRef.current.invalidateQueries({ queryKey: ['session'] });
        if (event === 'SIGNED_IN' && !hadSessionOnMount) {
          subscribeToProfile(session.user.id);
          // Redirect is handled by login() after the active check
        }
        hadSessionOnMount = true;
      } else {
        setUser(null);
        setIsLoading(false);
        hadSessionOnMount = false;
        queryClientRef.current.clear();
        if (profileChannel) {
          supabase.removeChannel(profileChannel);
          profileChannel = null;
        }
        if (event === 'SIGNED_OUT') {
          setLocationRef.current('/login');
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
      if (profileChannel) supabase.removeChannel(profileChannel);
    };
  }, []);

  const login = async ({ email, password }: { email: string; password: string }) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      toast({ variant: "destructive", title: "Login failed", description: error.message });
      throw error;
    }
    // Check is_active and must_change_password BEFORE the auth state change
    // can render the dashboard — keep loading until we know
    setIsLoading(true);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        const { data: profile } = await supabase
          .from('profiles').select('is_active, must_change_password').eq('id', authUser.id).single();
        if (profile && profile.is_active === false) {
          await supabase.auth.signOut();
          setIsLoading(false);
          toast({ variant: "destructive", title: "Account deactivated", description: "Your account has been deactivated. Please contact an administrator." });
          throw new Error('Account deactivated');
        }
        if (profile?.must_change_password) {
          setUser(prev => prev ? { ...prev, mustChangePassword: true } as any : prev);
          setIsLoading(false);
          setLocationRef.current('/change-password');
          return;
        }
      }
      setIsLoading(false);
      setLocationRef.current('/dashboard');
    } catch (err: any) {
      setIsLoading(false);
      if (err.message !== 'Account deactivated') throw err;
      throw err;
    }
  };

  const register = async ({ email, password, fullName, department }: {
    email: string; password: string; fullName: string; department?: string;
  }) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, department: department ?? null } },
    });
    if (error) {
      toast({ variant: "destructive", title: "Registration failed", description: error.message });
      throw error;
    }
    if (data.user) {
      supabase.from('profiles').upsert({
        id: data.user.id,
        full_name: fullName,
        department: department ?? null,
        role: 'general_user',
      }, { onConflict: 'id' }).then(() => {}).catch((err) => {
        console.error('[register] profile upsert failed:', err);
      });
    }
    toast({ title: "Account created", description: "Welcome to ITAM." });
  };

  const logout = async () => {
    await supabase.auth.signOut();
  };

  // Force a session refresh so app_metadata (role) is re-read from Supabase
  const refreshUser = async () => {
    const { data: { session }, error } = await supabase.auth.refreshSession();
    if (!error && session?.user) {
      setUser(userFromSession(session.user));
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated: !!user, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

