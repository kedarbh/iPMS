import 'dart:typed_data';
import 'package:image/image.dart' as img;
import '../../../core/services/watermark_service.dart' show maxEvidencePhotoBytes;

/// Longest side an invoice photo is sent at. Plenty to read a receipt.
const int maxInvoicePhotoSide = 2048;

/// True when [bytes] start with the JPEG marker the media service sniffs for.
bool isJpeg(Uint8List bytes) => bytes.length >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff;

/// Returns the photo as a JPEG the media service will accept.
///
/// The media service only takes JPEG and checks the file's first bytes, but
/// the iOS gallery hands back screenshots and saved images as PNG (and can
/// hand back GIF or WebP), which it then rejects as a type mismatch. A JPEG
/// that already fits is sent untouched; anything else is decoded, turned
/// upright, scaled to [maxInvoicePhotoSide] and re-encoded, stepping the
/// quality down until it fits under [maxEvidencePhotoBytes].
///
/// Returns null when the bytes are not an image this can decode.
/// Top-level so it can run in an isolate.
Uint8List? toInvoiceJpeg(Uint8List bytes) {
  if (isJpeg(bytes) && bytes.length <= maxEvidencePhotoBytes) return bytes;

  final decoded = img.decodeImage(bytes);
  if (decoded == null) return null;
  var image = img.bakeOrientation(decoded);
  if (image.width > maxInvoicePhotoSide || image.height > maxInvoicePhotoSide) {
    image = image.width >= image.height
        ? img.copyResize(image, width: maxInvoicePhotoSide)
        : img.copyResize(image, height: maxInvoicePhotoSide);
  }
  // JPEG has no transparency: put see-through screenshots on white, not black.
  if (image.hasAlpha) {
    final flat = img.Image(width: image.width, height: image.height)..clear(img.ColorRgb8(255, 255, 255));
    image = img.compositeImage(flat, image);
  }

  var quality = 85;
  var encoded = img.encodeJpg(image, quality: quality);
  while (encoded.length > maxEvidencePhotoBytes && quality > 40) {
    quality -= 15;
    encoded = img.encodeJpg(image, quality: quality);
  }
  return encoded;
}
