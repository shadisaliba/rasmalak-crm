import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { errorResponse } from '@/lib/apiError';

/**
 * Preview-only demo sign-in, so reviewers open the app without the login page. The credentials
 * stay on the server. Refuses on production deployments and whenever the demo login is not
 * configured, so it does nothing unless a deployment is set up for it on purpose.
 */
export async function POST() {
  const email = process.env.DEMO_LOGIN_EMAIL;
  const password = process.env.DEMO_LOGIN_PASSWORD;
  if (process.env.VERCEL_ENV === 'production' || !email || !password) return errorResponse('NOT_FOUND');

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
