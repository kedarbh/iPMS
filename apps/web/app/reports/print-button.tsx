'use client';

/** Opens the browser's print dialog; the report's print styles lay it out for paper or PDF. */
export function PrintButton() {
  return <button type="button" className="secondary-button" onClick={() => window.print()}>Print or save PDF</button>;
}
