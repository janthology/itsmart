/**
 * Users and staff directory queries and mutations.
 * Part of the Supabase data layer (split from supabase-queries.ts in Phase 4).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import type { UserProfile, UpdateUserRequest, UpdateProfileRequest } from '../api-types';
import { mapUser, useHasSession } from './shared';

// ─── USERS ───────────────────────────────────────────────────────────────────

export function useGetSupportStaff() {
  const { data: authed } = useHasSession();
  return useQuery<UserProfile[]>({
    queryKey: ['supportStaff'],
    enabled: !!authed,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'support_staff')
        .order('full_name', { ascending: true });
      if (error) throw error;
      return (data ?? []).map(mapUser);
    },
  });
}

export function useGetUsers(opts?: { query?: { search?: string } }) {
  const search = opts?.query?.search;
  const { data: authed } = useHasSession();
  return useQuery<UserProfile[]>({
    queryKey: ['users', search],
    enabled: !!authed,
    queryFn: async () => {
      // Query profiles directly — email comes from the view if available,
      // falls back to profiles-only if the view is inaccessible
      let data: any[] | null = null;
      let error: any = null;

      // Try the view first (includes email + last_sign_in_at)
      const viewResult = await supabase
        .from('profiles_with_email')
        .select('*')
        .order('created_at', { ascending: false });

      if (!viewResult.error) {
        data = viewResult.data;
      } else {
        // Fallback: query profiles directly (no email/last_sign_in)
        const profilesResult = await supabase
          .from('profiles')
          .select('*')
          .order('created_at', { ascending: false });
        if (profilesResult.error) throw profilesResult.error;
        data = profilesResult.data;
      }

      let users = (data ?? []).map(mapUser);
      if (search) {
        const term = search.toLowerCase();
        users = users.filter(u =>
          u.fullName.toLowerCase().includes(term) ||
          (u.email && u.email.toLowerCase().includes(term))
        );
      }
      return users;
    },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateUserRequest }) => {
      const updates: any = {};
      if (data.role !== undefined) updates.role = data.role;
      if (data.fullName !== undefined) updates.full_name = data.fullName;
      if (data.department !== undefined) updates.department = data.department;
      const { error } = await supabase.from('profiles').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useToggleUserActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase.from('profiles').update({ is_active: isActive }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateMyProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ data }: { data: UpdateProfileRequest }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const updates: any = {};
      if (data.fullName !== undefined) updates.full_name = data.fullName;
      if (data.department !== undefined) updates.department = data.department;
      // Update profiles table
      const { error } = await supabase.from('profiles').update(updates).eq('id', user.id);
      if (error) throw error;
      // Also update user_metadata so the JWT reflects the new name immediately
      await supabase.auth.updateUser({
        data: {
          full_name: data.fullName ?? user.user_metadata?.full_name,
          department: data.department ?? user.user_metadata?.department,
        }
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['currentUser'] }),
  });
}
