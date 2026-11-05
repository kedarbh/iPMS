'use client';

import { useEffect } from 'react';
import { StatePage } from './components/state-page';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled application error:', error);
  }, [error]);

  return (
    <StatePage eyebrow="Unexpected error" title="Something went wrong">
      <p className="subtle">An unexpected error occurred while processing your request.</p>
      <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
        <button type="button" className="primary-button" onClick={() => reset()}>
          Try again
        </button>
        <a className="soft-button" href="/">
          Back to workspace
        </a>
      </div>
    </StatePage>
  );
}

