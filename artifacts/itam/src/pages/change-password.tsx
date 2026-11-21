import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, KeyRound, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { clearPasswordChangeReview, readPasswordChangeReview, savePasswordChangeReview } from "@/lib/password-change-review";
import { classifyChangePasswordResponse, type ChangePasswordOutcome } from "@/lib/change-password-outcome";

function getStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: "", color: "" };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score, label: "Weak", color: "bg-red-500" };
  if (score <= 2) return { score, label: "Fair", color: "bg-amber-400" };
  if (score <= 3) return { score, label: "Good", color: "bg-blue-500" };
  return { score, label: "Strong", color: "bg-emerald-500" };
}

const PASSWORD_RULES = [
  { id: 'length',    label: 'At least 8 characters',          test: (pw: string) => pw.length >= 8 },
  { id: 'uppercase', label: 'At least one uppercase letter',   test: (pw: string) => /[A-Z]/.test(pw) },
  { id: 'digit',     label: 'At least one number',             test: (pw: string) => /[0-9]/.test(pw) },
  { id: 'special',   label: 'At least one special character',  test: (pw: string) => /[^A-Za-z0-9]/.test(pw) },
];

function passwordMeetsAllRules(pw: string): boolean {
  return PASSWORD_RULES.every(r => r.test(pw));
}

// supabase-js reports non-2xx responses as an error whose `context` is the
// fetch Response. Read only the status and the machine-readable code.
async function readFailure(error: unknown): Promise<{ status: number | null; code: string | null }> {
  const context = (error as { context?: unknown } | null)?.context;
  if (!(context instanceof Response)) return { status: null, code: null };
  let code: string | null = null;
  try {
    const body = await context.clone().json() as { code?: unknown };
    if (typeof body.code === 'string') code = body.code;
  } catch {
    // No readable body: classify by status alone.
  }
  return { status: context.status, code };
}

export default function ChangePassword() {
  const { user, clearMustChangePassword, mustChangePassword } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const submitInFlight = useRef(false);
  const [reviewState, setReviewState] = useState<'checking' | 'clear' | 'pending' | 'unavailable'>('checking');

  useEffect(() => {
    setCurrent(""); setNext(""); setConfirm("");
    if (!user?.id) { setReviewState('checking'); return; }
    try {
      setReviewState(readPasswordChangeReview(window.sessionStorage, user.id) ? 'pending' : 'clear');
    } catch {
      setReviewState('unavailable');
    }
  }, [user?.id]);

  const acknowledgeReview = () => {
    if (!user?.id) return;
    try {
      clearPasswordChangeReview(window.sessionStorage, user.id);
      setReviewState('clear');
    } catch {
      setReviewState('unavailable');
    }
  };

  const isMandatory = mustChangePassword;

  // The server verifies the current password, changes it, revokes every
  // session, and clears the flag. The browser never writes those columns.
  const releaseReview = (userId: string) => {
    try { clearPasswordChangeReview(window.sessionStorage, userId); }
    catch { setReviewState('unavailable'); }
  };

  const finishSuccessfulChange = async (userId: string) => {
    setCurrent(""); setNext(""); setConfirm("");
    releaseReview(userId);
    clearMustChangePassword();
    // All sessions were revoked on the server. Clear local state and sign in again.
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    toast({ title: "Password changed", description: "Sign in with your new password." });
    setLocation("/login");
  };

  const endSessionForSignIn = async (userId: string) => {
    releaseReview(userId);
    clearMustChangePassword();
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    toast({ variant: "destructive", title: "Session ended", description: "Sign in again to change your password." });
    setLocation("/login");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || submitInFlight.current || reviewState !== 'clear' || !user?.id) return;
    if (next !== confirm) {
      toast({ variant: "destructive", title: "Passwords don't match", description: "New password and confirmation must be identical." });
      return;
    }
    if (!passwordMeetsAllRules(next)) {
      toast({ variant: "destructive", title: "Password too weak", description: "Password must be at least 8 characters and include an uppercase letter, a number, and a special character." });
      return;
    }
    if (next.toLowerCase() === "dostro2" || next === current) {
      toast({ variant: "destructive", title: "Choose a different password", description: "Your new password must be different from your current or default password." });
      return;
    }

    const userId = user.id;
    submitInFlight.current = true;
    setLoading(true);
    try {
      // Store the review marker before the request. Ambiguous outcomes keep it.
      try {
        if (readPasswordChangeReview(window.sessionStorage, userId)) { setReviewState('pending'); return; }
        savePasswordChangeReview(window.sessionStorage, userId);
      } catch {
        setReviewState('unavailable');
        return;
      }

      const { data, error } = await supabase.functions.invoke<{ code?: string }>("change-password", {
        body: { currentPassword: current, newPassword: next },
      });
      let outcome: ChangePasswordOutcome;
      if (error) {
        const failure = await readFailure(error);
        outcome = classifyChangePasswordResponse(failure.status, failure.code);
      } else {
        outcome = classifyChangePasswordResponse(200, data?.code ?? null);
      }

      switch (outcome.kind) {
        case 'changed':
          await finishSuccessfulChange(userId);
          return;
        case 'session_ended':
          await endSessionForSignIn(userId);
          return;
        case 'rejected':
          releaseReview(userId);
          setCurrent("");
          toast({ variant: "destructive", title: "Password not changed", description: outcome.message });
          return;
        case 'ambiguous':
          setCurrent(""); setNext(""); setConfirm("");
          setReviewState('pending');
          toast({ variant: "destructive", title: "Password change not confirmed", description: "The change may have completed. Review the result before trying again." });
          return;
      }
    } catch {
      // Unexpected failure after the request started: never assume it was safe.
      setCurrent(""); setNext(""); setConfirm("");
      setReviewState('pending');
      toast({ variant: "destructive", title: "Password change not confirmed", description: "The change may have completed. Review the result before trying again." });
    } finally {
      submitInFlight.current = false;
      setLoading(false);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-md mx-auto pt-8">
        {isMandatory && (
          <div className="mb-6 flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-2xl px-5 py-4 text-sm text-amber-800 dark:text-amber-300">
            <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-0.5">Password change required</p>
              <p className="text-amber-700 dark:text-amber-400">Your password was reset by an administrator. Please set a new password before continuing.</p>
            </div>
          </div>
        )}

        <Card className="border-border/50 shadow-lg shadow-black/5 rounded-2xl">
          <CardHeader className="px-8 pt-8 pb-4">
            <CardTitle className="text-xl font-display flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-primary" /> Change Password
            </CardTitle>
            <CardDescription>{reviewState === 'clear' ? "Enter your current password and choose a new one. You will be asked to sign in again afterwards." : "Review the previous attempt before continuing."}</CardDescription>
          </CardHeader>
          <CardContent className="px-8 pb-8">
            {reviewState === 'checking' ? (
              <p className="text-sm text-muted-foreground">Checking for an unfinished attempt…</p>
            ) : reviewState === 'unavailable' ? (
              <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                Password changes are unavailable because this tab cannot safely store or read a review marker. Enable browser session storage or contact an administrator. This screen will not send another attempt while storage is unavailable.
              </div>
            ) : reviewState === 'pending' ? (
              <div role="alert" className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                <p className="font-semibold">A previous password change was not fully confirmed.</p>
                <p>It may have completed or may still be processing. Do not repeat it immediately. Sign out and check which password works, or contact an administrator. If the account record was not updated, you may be asked to change your password again at sign-in.</p>
                <Button type="button" variant="outline" onClick={acknowledgeReview}>I reviewed the result; allow another attempt</Button>
              </div>
            ) : <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="current-password">Current Password</Label>
                <div className="relative">
                  <Input
                    id="current-password" autoComplete="current-password"
                    type={showCurrent ? "text" : "password"}
                    value={current}
                    onChange={e => setCurrent(e.target.value)}
                    placeholder="Your current password"
                    className="h-11 rounded-xl pr-10"
                    required
                  />
                  <button type="button" aria-label={showCurrent ? "Hide current password" : "Show current password"} onClick={() => setShowCurrent(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="new-password">New Password</Label>
                <div className="relative">
                  <Input
                    id="new-password" autoComplete="new-password"
                    type={showNext ? "text" : "password"}
                    value={next}
                    onChange={e => setNext(e.target.value)}
                    placeholder="Min. 8 chars, uppercase, number, special char"
                    className="h-11 rounded-xl pr-10"
                    required
                  />
                  <button type="button" aria-label={showNext ? "Hide new password" : "Show new password"} onClick={() => setShowNext(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showNext ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {next && (() => {
                  const s = getStrength(next);
                  return (
                    <div className="space-y-2 pt-1">
                      <div className="flex gap-1">
                        {[1,2,3,4].map(i => (
                          <div key={i} className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${i <= Math.ceil(s.score / 1.25) ? s.color : 'bg-muted'}`} />
                        ))}
                      </div>
                      <p className={`text-xs font-medium ${s.score <= 1 ? 'text-red-500' : s.score <= 2 ? 'text-amber-500' : s.score <= 3 ? 'text-blue-500' : 'text-emerald-500'}`}>
                        {s.label}
                      </p>
                      <ul className="space-y-1">
                        {PASSWORD_RULES.map(rule => {
                          const met = rule.test(next);
                          return (
                            <li key={rule.id} className={`flex items-center gap-1.5 text-xs ${met ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                              <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0 ${met ? 'bg-emerald-500 text-white' : 'bg-muted border border-border'}`}>
                                {met && <svg className="w-2 h-2" fill="none" viewBox="0 0 8 8"><path stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M1.5 4l2 2 3-3"/></svg>}
                              </span>
                              {rule.label}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })()}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm New Password</Label>
                <Input
                  id="confirm-password" autoComplete="new-password"
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat new password"
                  className="h-11 rounded-xl"
                  required
                />
                {confirm && next !== confirm && (
                  <p className="text-xs text-destructive">Passwords do not match</p>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                {!isMandatory && (
                  <Button type="button" variant="outline" className="flex-1 rounded-xl h-11"
                    onClick={() => setLocation("/profile")}>
                    Cancel
                  </Button>
                )}
                <Button type="submit" disabled={loading || next !== confirm || !current || !next || !passwordMeetsAllRules(next)}
                  className="flex-1 rounded-xl h-11 shadow-md shadow-primary/20">
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2" />}
                  Change Password
                </Button>
              </div>
            </form>}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
