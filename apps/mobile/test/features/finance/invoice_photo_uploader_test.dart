import 'dart:convert';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:mobile/core/network/api_client.dart';
import 'package:mobile/core/network/api_exceptions.dart';
import 'package:mobile/core/security/token_storage.dart';
import 'package:mobile/features/finance/data/invoice_photo_uploader.dart';
import 'package:mobile/features/media/data/media_repository.dart';

/// media and the bucket in one stand-in. Statuses are served in order.
class _Media implements HttpClientAdapter {
  final List<RequestOptions> calls = [];
  String registerStatus = 'PENDING';
  List<String> statuses = ['READY'];
  String completeStatus = 'VERIFYING';
  int completeFailures = 0; // answers 412 this many times
  int puts = 0;
  List<int> lastPut = const [];

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    calls.add(options);
    ResponseBody json(int status, Object body) => ResponseBody.fromString(jsonEncode(body), status,
        headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});
    final path = options.path;
    if (path == '/api/v1/media/finance/uploads') {
      return json(201, {
        'id': (options.data as Map)['id'],
        'status': registerStatus,
        'upload': registerStatus == 'PENDING'
            ? {'mode': 'single', 'signedUrl': 'https://bucket/put', 'headers': {'content-type': 'image/jpeg'}}
            : null,
      });
    }
    if (path == 'https://bucket/put') {
      puts++;
      lastPut = requestStream == null ? const [] : (await requestStream.toList()).expand((b) => b).toList();
      return ResponseBody.fromString('', 200);
    }
    if (path.endsWith('/complete')) {
      if (completeFailures > 0) {
        completeFailures--;
        return json(412, {'error': {'code': 'PRECONDITION_FAILED', 'message': 'not arrived', 'correlationId': 'c'}});
      }
      return json(200, {'status': completeStatus});
    }
    if (path == '/api/v1/media/finance/uploads/status') {
      final next = statuses.length > 1 ? statuses.removeAt(0) : statuses.first;
      return json(200, [
        {'id': ((options.data as Map)['ids'] as List).first, 'status': next},
      ]);
    }
    return json(404, {});
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  late _Media server;
  late InvoicePhotoUploader uploader;
  final picture = img.Image(width: 64, height: 48)..clear(img.ColorRgb8(200, 120, 40));
  final bytes = img.encodeJpg(picture);

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    server = _Media();
    final dio = Dio(BaseOptions(baseUrl: 'http://x'))..httpClientAdapter = server;
    final media = MediaRepository(
      apiClient: ApiClient(tokenStorage: TokenStorage(), dio: dio),
      storageDio: Dio(BaseOptions(baseUrl: 'http://x'))..httpClientAdapter = server,
    );
    uploader = InvoicePhotoUploader(
      media: media,
      deviceId: () async => 'dev-1',
      pollInterval: const Duration(milliseconds: 5),
      timeout: const Duration(milliseconds: 200),
    );
  });

  test('registers under the project with the file\'s hash, sends the bytes, and waits for READY', () async {
    server.statuses = ['VERIFYING', 'READY'];
    final id = await uploader.upload(projectId: 'p-1', mediaId: 'm-1', bytes: bytes);

    expect(id, 'm-1');
    final register = server.calls.first.data as Map;
    expect(register['projectId'], 'p-1');
    expect(register['kind'], 'PHOTO');
    expect(register['contentType'], 'image/jpeg');
    expect(register['sizeBytes'], bytes.length);
    expect(register['contentHash'], sha256.convert(bytes).toString());
    expect(register['deviceId'], 'dev-1');
    expect(server.puts, 1);
  });

  test('sends nothing again when the file is already past PENDING', () async {
    server.registerStatus = 'READY';
    await uploader.upload(projectId: 'p-1', mediaId: 'm-1', bytes: bytes);
    expect(server.puts, 0);
    expect(server.calls.where((c) => c.path.endsWith('/complete')), isEmpty);
  });

  test('sends again once when the bytes had not arrived at completion (412)', () async {
    server.completeFailures = 1;
    await uploader.upload(projectId: 'p-1', mediaId: 'm-1', bytes: bytes);
    expect(server.puts, 2);
  });

  test('sends a JPEG as it is', () async {
    await uploader.upload(projectId: 'p-1', mediaId: 'm-1', bytes: bytes);
    final register = server.calls.first.data as Map;
    expect(register['contentHash'], sha256.convert(bytes).toString());
  });

  test('turns a PNG from the gallery (a screenshot) into a JPEG before sending it', () async {
    final png = img.encodePng(img.Image(width: 40, height: 30, numChannels: 4)..clear(img.ColorRgba8(0, 0, 0, 0)));
    await uploader.upload(projectId: 'p-1', mediaId: 'm-1', bytes: png);

    final sent = server.lastPut;
    expect(sent.sublist(0, 3), [0xff, 0xd8, 0xff]);
    final register = server.calls.first.data as Map;
    expect(register['contentType'], 'image/jpeg');
    expect(register['sizeBytes'], sent.length);
    expect(register['contentHash'], sha256.convert(sent).toString());
    // Transparent pixels land on white, not black.
    final decoded = img.decodeJpg(Uint8List.fromList(sent))!;
    expect(decoded.getPixel(10, 10).r, greaterThan(240));
  });

  test('scales a large picture down to 2048 px on its longest side', () async {
    final png = img.encodePng(img.Image(width: 3000, height: 1500)..clear(img.ColorRgb8(10, 10, 10)));
    await uploader.upload(projectId: 'p-1', mediaId: 'm-1', bytes: png);
    final sent = server.lastPut;
    final decoded = img.decodeJpg(Uint8List.fromList(sent))!;
    expect(decoded.width, 2048);
    expect(decoded.height, 1024);
  });

  test('refuses a file it cannot read as a picture before sending anything', () async {
    await expectLater(
      uploader.upload(projectId: 'p-1', mediaId: 'm-1', bytes: Uint8List.fromList(List.generate(2000, (i) => i % 251))),
      throwsA(isA<ApiException>().having((e) => e.message, 'message', contains('not supported'))),
    );
    expect(server.calls, isEmpty);
  });

  test('says so when the server refuses the photo', () async {
    server.statuses = ['REJECTED'];
    await expectLater(
      uploader.upload(projectId: 'p-1', mediaId: 'm-1', bytes: bytes),
      throwsA(isA<ApiException>().having((e) => e.message, 'message', contains('refused'))),
    );
  });

  test('gives up, saying it is still being checked, if verification takes too long', () async {
    server.statuses = ['VERIFYING'];
    await expectLater(
      uploader.upload(projectId: 'p-1', mediaId: 'm-1', bytes: bytes),
      throwsA(isA<ApiException>().having((e) => e.message, 'message', contains('still being checked'))),
    );
  });
}

