import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { errorResponse } from '@/lib/apiError';

/**
 * Demo sign-in, so visitors open the sample business without the login page. The credentials stay
 * on the server. It works only where DEMO_LOGIN_EMAIL and DEMO_LOGIN_PASSWORD are set, which a
 * deployment does on purpose; a deployment that serves real customers must never set them.
 */
export async function POST() {
  const email = process.env.DEMO_LOGIN_EMAIL;
  const password = process.env.DEMO_LOGIN_PASSWORD;
  if (!email || !password) return errorResponse('NOT_FOUND');

  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) return errorResponse('UNAUTHENTICATED');
  return NextResponse.json(
    { access_token: data.session.access_token, refresh_token: data.session.refresh_token },
    { headers: { 'cache-control': 'no-store' } },
  );
}
