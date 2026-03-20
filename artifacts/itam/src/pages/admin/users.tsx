import { useState } from "react";
import { useGetUsers, useUpdateUser, UserRole } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, Loader2, UserCog } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Redirect } from "wouter";
import { useAuth } from "@/lib/auth-context";

export default function UsersManagement() {
  const { user } = useAuth();
  if (user?.role !== 'administrator') return <Redirect to="/dashboard" />;

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: users, isLoading } = useGetUsers({ query: { search: search || undefined } });
  const updateMutation = useUpdateUser();

  const handleRoleChange = async (id: string, newRole: UserRole) => {
    try {
      await updateMutation.mutateAsync({ id, data: { role: newRole } });
      toast({ title: "Role updated", description: "User permissions changed." });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "Failed to update role." });
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="relative max-w-md w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input 
              placeholder="Search users..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-11 rounded-xl bg-card border-border/50 shadow-sm"
            />
          </div>
        </div>

        <Card className="border-border/50 shadow-lg shadow-black/5 rounded-2xl overflow-hidden">
          {isLoading ? (
             <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead className="py-4 px-6">User</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="px-6">Role / Access Level</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users?.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                          {u.fullName.charAt(0)}
                        </div>
                        <div>
                          <p className="font-bold text-foreground">{u.fullName}</p>
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {u.department ? <Badge variant="secondary" className="rounded-md font-normal">{u.department}</Badge> : <span className="text-muted-foreground text-sm">-</span>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(u.createdAt), 'MMM yyyy')}
                    </TableCell>
                    <TableCell className="px-6">
                      <Select 
                        value={u.role} 
                        onValueChange={(val) => handleRoleChange(u.id, val as UserRole)}
                        disabled={updateMutation.isPending || u.id === user?.id}
                      >
                        <SelectTrigger className="w-[180px] h-9 rounded-lg border-border/50 bg-background text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.values(UserRole).map(r => (
                            <SelectItem key={r} value={r} className="capitalize flex items-center">
                              {r === 'administrator' && <UserCog className="w-3 h-3 inline mr-2 text-destructive" />}
                              {r.replace('_', ' ')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}
