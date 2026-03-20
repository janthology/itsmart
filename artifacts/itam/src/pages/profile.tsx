import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useUpdateMyProfile } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Loader2, UserCircle, Mail, Shield, Building2 } from "lucide-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const profileSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  department: z.string().optional().nullable(),
});

export default function Profile() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateMutation = useUpdateMyProfile();

  const form = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      fullName: user?.fullName || "",
      department: user?.department || "",
    }
  });

  const onSubmit = async (values: z.infer<typeof profileSchema>) => {
    try {
      await updateMutation.mutateAsync({ data: values });
      toast({ title: "Profile updated", description: "Your details have been saved." });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "Failed to update profile." });
    }
  };

  if (!user) return null;

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="flex items-center gap-6 p-8 bg-card rounded-3xl shadow-lg shadow-black/5 border border-border/50 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
          <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-primary-foreground font-display font-bold text-4xl shadow-xl shadow-primary/20 relative z-10">
            {user.fullName.charAt(0)}
          </div>
          <div className="relative z-10 space-y-2">
            <h2 className="text-3xl font-display font-bold">{user.fullName}</h2>
            <div className="flex gap-3 text-sm font-medium text-muted-foreground">
              <span className="flex items-center gap-1.5 bg-muted/50 px-3 py-1 rounded-full border border-border/50"><Shield className="w-4 h-4 text-primary" /> <span className="capitalize">{user.role.replace('_', ' ')}</span></span>
              <span className="flex items-center gap-1.5 bg-muted/50 px-3 py-1 rounded-full border border-border/50"><Mail className="w-4 h-4 text-accent" /> {user.email}</span>
            </div>
          </div>
        </div>

        <Card className="border-border/50 shadow-lg shadow-black/5 rounded-2xl">
          <CardHeader className="px-8 pt-8 pb-4">
            <CardTitle className="text-xl font-display flex items-center gap-2"><UserCircle className="w-5 h-5 text-primary" /> Personal Information</CardTitle>
            <CardDescription>Update your display name and department info.</CardDescription>
          </CardHeader>
          <CardContent className="px-8 pb-8">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField control={form.control} name="fullName" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-foreground">Full Name</FormLabel>
                      <FormControl><Input {...field} className="h-12 rounded-xl bg-muted/30 focus-visible:bg-background transition-colors border-border/50" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="department" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-foreground flex items-center gap-1.5"><Building2 className="w-4 h-4" /> Department</FormLabel>
                      <FormControl><Input {...field} value={field.value || ''} placeholder="e.g. Engineering" className="h-12 rounded-xl bg-muted/30 focus-visible:bg-background transition-colors border-border/50" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <div className="flex justify-end pt-4">
                  <Button type="submit" disabled={updateMutation.isPending} className="h-12 px-8 rounded-xl shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all">
                    {updateMutation.isPending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : "Save Changes"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
