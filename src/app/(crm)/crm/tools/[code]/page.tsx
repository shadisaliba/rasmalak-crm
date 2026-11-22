'use client';

import { Suspense } from 'react';
import { CalculatorPage } from '@/sme/calc/ui/CalculatorPage';

// useSearchParams (a saved scenario to open) needs a Suspense boundary.
export default function CalculatorRoute() {
  return (
    <Suspense>
      <CalculatorPage />
    </Suspense>
  );
}
