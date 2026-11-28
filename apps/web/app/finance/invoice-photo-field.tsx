'use client';
import { useEffect, useRef, useState } from 'react';
import { InvoicePhotoError, toInvoiceJpeg } from './invoice-photo';

type Phase = { kind: 'idle' } | { kind: 'working'; label: string } | { kind: 'error'; message: string };

/**
 * The photo of one invoice. Picking a file turns it into a JPEG here, sends
 * it to `/api/finance/uploads` under the request's project, and keeps the
 * returned id in the row's `invoiceMediaId`, exactly where an edit already
 * carries a photo the phone attached. Submitting checks the files again.
 */
export function InvoicePhotoField({ index, projectId, initialMediaId, onBusy }: {
  index: number; projectId: string | null; initialMediaId?: string; onBusy: (busy: boolean) => void;
}) {
  const [mediaId, setMediaId] = useState(initialMediaId ?? '');
  const [preview, setPreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const input = useRef<HTMLInputElement>(null);
  const label = `Invoice ${index + 1} photo`;

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function attach(file: File) {
    if (!projectId) return;
    onBusy(true);
    try {
      setPhase({ kind: 'working', label: 'Preparing…' });
      const jpeg = await toInvoiceJpeg(file);
      setPhase({ kind: 'working', label: 'Uploading…' });
      const body = new FormData();
      body.set('file', jpeg, 'invoice.jpg');
      body.set('projectId', projectId);
      const response = await fetch('/api/finance/uploads', { method: 'POST', body });
      const answer = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!response.ok || !answer.id) throw new InvoicePhotoError(answer.message ?? 'The photo could not be uploaded. Try again.');
      setMediaId(answer.id);
      setPreview(URL.createObjectURL(jpeg));
      setPhase({ kind: 'idle' });
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof InvoicePhotoError ? err.message : 'The photo could not be uploaded. Try again.' });
    } finally {
      onBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  const working = phase.kind === 'working';
  const thumb = preview ?? (mediaId ? `/api/finance/files/${mediaId}?variant=thumbnail` : null);
  return (
    <div className="field invoice-photo">
      <span>Photo (optional)</span>
      <input type="hidden" name="invoiceMediaId" value={mediaId} />
      <input
        ref={input} type="file" accept="image/*" hidden aria-label={label}
        onChange={(e) => { const file = e.target.files?.[0]; if (file) void attach(file); }}
      />
      <div className="invoice-photo-row">
        {thumb && mediaId ? (
          <a href={`/api/finance/files/${mediaId}`} target="_blank" rel="noreferrer" className="invoice-photo-thumb" aria-label={`Open ${label.toLowerCase()}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a same-origin redirect to a signed link, not a static asset */}
            <img src={thumb} alt="" />
          </a>
        ) : null}
        <button type="button" className="ghost-button" disabled={!projectId || working} onClick={() => input.current?.click()} aria-label={mediaId ? `Replace ${label.toLowerCase()}` : `Attach ${label.toLowerCase()}`}>
          {working ? phase.label : mediaId ? 'Replace photo' : 'Attach photo'}
        </button>
        {mediaId && !working ? (
          <button type="button" className="ghost-button" onClick={() => { setMediaId(''); setPreview(null); }} aria-label={`Remove ${label.toLowerCase()}`}>Remove photo</button>
        ) : null}
      </div>
      {!projectId ? <small className="hint">Choose a project first.</small> : null}
      {phase.kind === 'error' ? <small className="invoice-photo-error" role="alert">{phase.message}</small> : null}
    </div>
  );
}
