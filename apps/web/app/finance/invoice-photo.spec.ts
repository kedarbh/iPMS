import { describe, expect, it } from 'vitest';
import { fitWithin, refusal } from './invoice-photo';

describe('fitWithin', () => {
  it('shrinks the longer edge to the limit and keeps the shape', () => {
    expect(fitWithin(6000, 4000, 3000)).toEqual({ width: 3000, height: 2000 });
    expect(fitWithin(1000, 4000, 3000)).toEqual({ width: 750, height: 3000 });
  });
  it('never enlarges a small photo', () => {
    expect(fitWithin(800, 600, 3000)).toEqual({ width: 800, height: 600 });
  });
});

describe('refusal', () => {
  it('turns away a PDF with what to do instead', () => {
    expect(refusal({ type: 'application/pdf', name: 'bill.pdf' })).toMatch(/PDF invoices cannot be attached yet/);
    expect(refusal({ type: '', name: 'BILL.PDF' })).toMatch(/PDF/);
  });
  it('turns away files that are not images', () => {
    expect(refusal({ type: 'text/plain', name: 'notes.txt' })).toMatch(/photo of the bill/);
  });
  it('lets any image through, and a file with no type (the browser decides when drawing it)', () => {
    expect(refusal({ type: 'image/png', name: 'shot.png' })).toBeNull();
    expect(refusal({ type: 'image/heic', name: 'IMG_1.HEIC' })).toBeNull();
    expect(refusal({ type: '', name: 'IMG_1.HEIC' })).toBeNull();
  });
});
