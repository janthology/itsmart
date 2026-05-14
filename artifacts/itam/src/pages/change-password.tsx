import { useState } from "react";
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

export default function ChangePassword() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [loading, setLoading] = useState(false);

  const isMandatory = (user as any)?.mustChangePassword === true;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      toast({ variant: "destructive", title: "Passwords don't match", description: "New password and confirmation must be identical." });
      return;
    }
    if (next.length < 6) {
      toast({ variant: "destructive", title: "Too short", description: "Password must be at least 6 characters." });
      return;
    }
    if (next === "dostro2") {
      toast({ variant: "destructive", title: "Choose a different password", description: "You cannot keep the default password." });
      return;
    }

    setLoading(true);
    try {
      // Re-authenticate with current password first
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user?.email ?? "",
        password: current,
      });
      if (signInError) {
        toast({ variant: "destructive", title: "Incorrect current password", description: "Please enter your current password correctly." });
        return;
      }

      // Update password
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;

      // Clear the must_change_password flag and stamp password_changed_at
      if (user?.id) {
        await supabase.from("profiles").update({
          must_change_password: false,
          password_changed_at: new Date().toISOString(),
        }).eq("id", user.id);
      }

      toast({ title: "Password changed", description: "Your password has been updated successfully." });
      setLocation("/dashboard");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message || "Failed to change password." });
    } finally {
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
            <CardDescription>Enter your current password and choose a new one.</CardDescription>
          </CardHeader>
          <CardContent className="px-8 pb-8">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <Label>Current Password</Label>
                <div className="relative">
                  <Input
                    type={showCurrent ? "text" : "password"}
                    value={current}
                    onChange={e => setCurrent(e.target.value)}
                    placeholder="Your current password"
                    className="h-11 rounded-xl pr-10"
                    required
                  />
                  <button type="button" onClick={() => setShowCurrent(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>New Password</Label>
                <div className="relative">
                  <Input
                    type={showNext ? "text" : "password"}
                    value={next}
                    onChange={e => setNext(e.target.value)}
                    placeholder="At least 6 characters"
                    className="h-11 rounded-xl pr-10"
                    required
                  />
                  <button type="button" onClick={() => setShowNext(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showNext ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {next && (() => {
                  const s = getStrength(next);
                  return (
                    <div className="space-y-1 pt-1">
                      <div className="flex gap-1">
                        {[1,2,3,4].map(i => (
                          <div key={i} className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${i <= Math.ceil(s.score / 1.25) ? s.color : 'bg-muted'}`} />
                        ))}
                      </div>
                      <p className={`text-xs font-medium ${s.score <= 1 ? 'text-red-500' : s.score <= 2 ? 'text-amber-500' : s.score <= 3 ? 'text-blue-500' : 'text-emerald-500'}`}>
                        {s.label}
                      </p>
                    </div>
                  );
                })()}
              </div>

              <div className="space-y-1.5">
                <Label>Confirm New Password</Label>
                <Input
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
                <Button type="submit" disabled={loading || next !== confirm || !current || !next}
                  className="flex-1 rounded-xl h-11 shadow-md shadow-primary/20">
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2" />}
                  Change Password
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
