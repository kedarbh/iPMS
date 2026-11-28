/**
 * Turning whatever was picked into a JPEG media will take: the server keeps
 * only JPEG photos up to 5 MB and checks the file's own first bytes, as it
 * does for the phone (which re-encodes the same way). A JPEG already under the
 * limit goes as it is; anything the browser can draw (PNG, WebP, HEIC in
 * Safari) is redrawn onto white and re-encoded, shrinking until it fits.
 */
export const MAX_INVOICE_BYTES = 5 * 1024 * 1024;
const MAX_EDGE = 3000;
const QUALITIES = [0.85, 0.72, 0.6];

export class InvoicePhotoError extends Error {}

/** Width and height scaled so the longer edge is at most `max`, never enlarged. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Why a picked file cannot be attached, before any work is done; null when it may be. */
export function refusal(file: { type: string; name: string }): string | null {
  const type = file.type.toLowerCase();
  if (type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return 'PDF invoices cannot be attached yet. Attach a photo or screenshot of the bill instead.';
  }
  if (type && !type.startsWith('image/')) return 'Choose a photo of the bill (JPEG, PNG or similar).';
  return null;
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    // Older Safari: fall back to an <img>, which also applies the EXIF orientation.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
    } catch {
      throw new InvoicePhotoError('This browser cannot read that image. Save it as a JPEG or PNG and try again.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

const encode = (canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

export async function toInvoiceJpeg(file: File): Promise<Blob> {
  const refused = refusal(file);
  if (refused) throw new InvoicePhotoError(refused);
  if (file.type === 'image/jpeg' && file.size <= MAX_INVOICE_BYTES) return file;

  const image = await decode(file);
  try {
    let edge = MAX_EDGE;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const size = fitWithin(image.width, image.height, edge);
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new InvoicePhotoError('This browser cannot prepare the photo.');
      ctx.fillStyle = '#fff'; // a transparent PNG would otherwise turn black
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.drawImage(image.source, 0, 0, size.width, size.height);
      for (const quality of QUALITIES) {
        const blob = await encode(canvas, quality);
        if (blob && blob.size <= MAX_INVOICE_BYTES) return blob;
      }
      edge = Math.round(edge * 0.7);
    }
  } finally {
    image.close();
  }
  throw new InvoicePhotoError('The photo is too large to attach, even after shrinking it.');
}
