import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { useLocation } from "wouter";
import { supabase } from "./supabase";
import type { UserProfile } from "./supabase-queries";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { User } from "@supabase/supabase-js";
import { signInThroughBroker } from './login-broker';

interface AuthContextType {
  user: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  mustChangePassword: boolean;
  login: (data: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  clearMustChangePassword: () => void;
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
  const [mustChangePassword, setMustChangePassword] = useState(false);
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
          // An admin password reset flags the account mid-session too:
          // forcing the change on next login alone would let the current
          // session keep working indefinitely. The App gate redirects to
          // /change-password as soon as this flag flips on.
          if (payload.new?.must_change_password === true) {
            setMustChangePassword(true);
          }
          if (payload.new?.is_active === false) {
            supabase.auth.signOut().then(() => {
              toast({
                variant: "destructive",
                title: "Account deactivated",
                description: "Your account has been deactivated by an administrator.",
              });
            });
          } else if (payload.new?.role && payload.new.role !== payload.old?.role) {
            // payload.old is only populated when REPLICA IDENTITY FULL is set on the table.
            // Fall back to comparing against the role in the current JWT session so the
            // sign-out fires reliably regardless of replica identity settings.
            supabase.auth.getSession().then(({ data: { session } }) => {
              const currentRole = session?.user?.app_metadata?.role ?? 'general_user';
              if (payload.new.role !== currentRole) {
                supabase.auth.signOut().then(() => {
                  toast({
                    title: "Role changed",
                    description: "Your account role was updated. Please sign in again.",
                  });
                });
              }
            });
          }
        })
        .subscribe();
    };

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      if (session?.user) {
        hadSessionOnMount = true;
        setUser(userFromSession(session.user));
        subscribeToProfile(session.user.id);
        // Persist mustChangePassword across reloads by checking the DB
        const { data: profile } = await supabase
          .from('profiles').select('must_change_password').eq('id', session.user.id).single();
        if (mounted) setMustChangePassword(!!profile?.must_change_password);
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
        setMustChangePassword(false);
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
    // Sign-in goes only through the password gate broker (Phase 3 step 3.2).
    // The broker admits the session in the database before it returns tokens.
    // No toast here: the login page renders sign-in failures inline by
    // the form (wrong credentials vs. connection problems), so toasting
    // the same failure would double-report it.
    const brokerSession = await signInThroughBroker(email, password);
    const { error } = await supabase.auth.setSession({
      access_token: brokerSession.access_token,
      refresh_token: brokerSession.refresh_token,
    });
    if (error) throw error;
    // A restricted session (gate phase required or changing) can only reach
    // /change-password. The broker decides this, so the route follows it even
    // if the profile flag is out of step.
    if (brokerSession.password_change_required) {
      setMustChangePassword(true);
      setIsLoading(false);
      setLocationRef.current('/change-password');
      return;
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
          // Surfaced inline by the login page ('Account deactivated').
          throw new Error('Account deactivated');
        }
        if (profile?.must_change_password) {
          setMustChangePassword(true);
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

  const clearMustChangePassword = () => setMustChangePassword(false);

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated: !!user, mustChangePassword, login, logout, refreshUser, clearMustChangePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

