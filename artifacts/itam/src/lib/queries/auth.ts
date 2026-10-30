/**
 * Current-user profile fetching.
 * Part of the Supabase data layer (split from supabase-queries.ts in Phase 4).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabase';
import type { UserProfile } from '../api-types';

// ─── AUTH ─────────────────────────────────────────────────────────────────────

export async function fetchCurrentUser(): Promise<UserProfile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    if (error || !data) {
      return { id: user.id, email: user.email ?? '', fullName: user.email ?? '', role: 'general_user', department: null, createdAt: '', updatedAt: '' };
    }
    return {
      id: data.id,
      email: user.email ?? '',
      fullName: data.full_name ?? user.email ?? '',
      role: data.role ?? 'general_user',
      department: data.department ?? null,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  } catch {
    return { id: user.id, email: user.email ?? '', fullName: user.email ?? '', role: 'general_user', department: null, createdAt: '', updatedAt: '' };
  }
}

export function useGetCurrentUser() {
  return useQuery<UserProfile | null>({
    queryKey: ['currentUser'],
    queryFn: fetchCurrentUser,
    retry: false,
  });
}
