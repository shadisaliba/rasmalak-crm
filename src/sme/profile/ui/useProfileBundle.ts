'use client';

import { useEffect, useState } from 'react';
import { useOrg } from '@/store/orgStore';
import { loadProfileBundle, type ProfileBundle } from '../client';

export function useProfileBundle(): { bundle: ProfileBundle | null; loaded: boolean; failed: boolean; reload: () => void } {
  const { currentOrg } = useOrg();
  const [bundle, setBundle] = useState<ProfileBundle | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!currentOrg) return;
    const orgId = currentOrg.id;
    let ignore = false;
    loadProfileBundle(orgId).then(result => {
      if (ignore) return;
      setBundle(result);
      setFailed(result === null);
      setLoadedFor(orgId);
    });
    return () => { ignore = true; };
  }, [currentOrg, reloadKey]);

  return { bundle, loaded: !!currentOrg && loadedFor === currentOrg.id, failed, reload: () => setReloadKey(k => k + 1) };
}
