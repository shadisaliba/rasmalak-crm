'use client';

import { Suspense } from 'react';
import { TransactionsPage } from '@/sme/ledger/ui/TransactionsPage';

// useSearchParams (the account filter in the URL) needs a Suspense boundary.
export default function MoneyTransactionsRoute() {
  return (
    <Suspense>
      <TransactionsPage />
    </Suspense>
  );
}
