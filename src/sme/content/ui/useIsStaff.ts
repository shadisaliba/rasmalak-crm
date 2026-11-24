'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuthStore } from '@/store/authStore';

/** Whether the signed-in user is platform staff. Only decides what to show; RLS protects content. */
export function useIsStaff(): boolean {
  const userId = useAuthStore(s => s.user?.id ?? null);
  const [staff, setStaff] = useState(false);
  useEffect(() => {
    if (!userId) return;
    let ignore = false;
    supabase.from('platform_staff').select('user_id').eq('user_id', userId).is('revoked_at', null).maybeSingle()
      .then(({ data }) => { if (!ignore) setStaff(!!data); });
    return () => { ignore = true; };
  }, [userId]);
  return !!userId && staff;
}
