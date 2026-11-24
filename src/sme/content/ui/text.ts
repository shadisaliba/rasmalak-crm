'use client';

import { useLedgerText } from '@/sme/ledger/ui/shared';

/** Learn screen text. Topic tags are free-form; known ones have a label, others show as typed. */
export function useLearnText() {
  const L = useLedgerText();
  const topic = (tag: string) => {
    const id = `learn.topic.${tag}`;
    return L.intl.messages[id] ? L.t(id) : tag.replace(/[_-]+/g, ' ');
  };
  return { ...L, topic };
}
