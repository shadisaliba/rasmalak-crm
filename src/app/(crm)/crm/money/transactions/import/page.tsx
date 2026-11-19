'use client';

import { Suspense } from 'react';
import { ImportStartPage } from '@/sme/imports/ui/ImportStartPage';

export default function ImportStartRoute() {
  return (
    <Suspense>
      <ImportStartPage />
    </Suspense>
  );
}
