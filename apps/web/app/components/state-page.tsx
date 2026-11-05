import React from 'react';
import { BrandMark } from './brand';

/** The signed-out / error surface, which stands on its own without the shell. */
export function StatePage({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="state-page">
      <section className="state-card">
        <a className="brand" href="/" aria-label="Axiom home">
          <BrandMark />
        </a>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}

