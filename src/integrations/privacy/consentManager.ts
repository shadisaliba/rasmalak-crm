/**
 * Consent Manager
 * ===============
 * Manages user consent for calendar/email syncing.
 * Calendar requires explicit confirmation after privacy preview.
 * Email syncs all by default (user curates linking).
 */

import { serviceDb } from '@/lib/supabaseServer';

/**
 * Confirm sync for a connection — enables actual data syncing.
 */
export async function confirmSync(connectionId: string): Promise<boolean> {
  try {
    const { error } = await serviceDb()
      .from('service_connections')
      .update({
        privacy_confirmed: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', connectionId);

    return !error;
  } catch {
    return false;
  }
}

/**
 * Revoke consent — disconnects and deletes the connection.
 */
export async function revokeConsent(connectionId: string): Promise<boolean> {
  try {
    const { error } = await serviceDb()
      .from('service_connections')
      .delete()
      .eq('id', connectionId);

    return !error;
  } catch {
    return false;
  }
}

/**
 * Check if a connection has been confirmed for syncing.
 */
export async function isConfirmed(connectionId: string): Promise<boolean> {
  try {
    const { data } = await serviceDb()
      .from('service_connections')
      .select('privacy_confirmed')
      .eq('id', connectionId)
      .single();

    return data?.privacy_confirmed === true;
  } catch {
    return false;
  }
}
