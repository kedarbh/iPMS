import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/push/push_controller.dart';
import 'package:mobile/core/push/push_messaging.dart';
import 'package:mobile/core/push/push_payload.dart';
import 'package:mobile/core/push/push_repository.dart';

class FakeMessaging implements PushMessaging {
  bool configured = true;
  bool permitted = true;
  String? token = 'tok-1';
  PushPayload? launched;
  final refresh = StreamController<String>.broadcast();
  final foreground = StreamController<PushPayload>.broadcast();
  final opened = StreamController<PushPayload>.broadcast();

  @override
  Future<bool> init() async => configured;
  @override
  Future<bool> requestPermission() async => permitted;
  @override
  Future<String?> getToken() async => token;
  @override
  Stream<String> get onTokenRefresh => refresh.stream;
  @override
  Stream<PushPayload> get onForeground => foreground.stream;
  @override
  Stream<PushPayload> get onOpened => opened.stream;
  @override
  Future<PushPayload?> initialMessage() async => launched;
  @override
  Future<void> deleteToken() async {}
}

class FakeRepository implements PushRepository {
  final registered = <(String, String)>[];
  final unregistered = <String>[];
  bool failing = false;

  @override
  Future<void> register(String token, String platform) async {
    if (failing) throw Exception('offline');
    registered.add((token, platform));
  }

  @override
  Future<void> unregister(String token) async {
    if (failing) throw Exception('offline');
    unregistered.add(token);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  late FakeMessaging messaging;
  late FakeRepository repo;
  late List<PushStatus> statuses;
  late List<PushPayload> shown;
  late List<PushPayload> opened;
  var enabled = true;

  PushController build() => PushController(
        messaging: messaging,
        repository: repo,
        platform: 'ANDROID',
        isEnabled: () async => enabled,
        onForeground: shown.add,
        onOpen: opened.add,
        onStatus: statuses.add,
      );

  setUp(() {
    messaging = FakeMessaging();
    repo = FakeRepository();
    statuses = [];
    shown = [];
    opened = [];
    enabled = true;
  });

  test('registers the device token with the server and reports active', () async {
    final c = build();
    await c.start();
    expect(repo.registered, [('tok-1', 'ANDROID')]);
    expect(statuses.last, PushStatus.active);
    expect(c.isRunning, isTrue);
  });

  test('does nothing, and says so, when the user has push switched off', () async {
    enabled = false;
    await build().start();
    expect(repo.registered, isEmpty);
    expect(statuses, [PushStatus.idle]);
  });

  test('reports unavailable when the build has no Firebase configuration', () async {
    messaging.configured = false;
    final c = build();
    await c.start();
    expect(statuses, [PushStatus.unavailable]);
    expect(repo.registered, isEmpty);
    expect(c.isRunning, isFalse);
  });

  test('registers nothing when notifications are refused in the system prompt', () async {
    messaging.permitted = false;
    await build().start();
    expect(statuses, [PushStatus.denied]);
    expect(repo.registered, isEmpty);
  });

  test('registers a refreshed token', () async {
    await build().start();
    messaging.refresh.add('tok-2');
    await Future<void>.delayed(Duration.zero);
    expect(repo.registered.last, ('tok-2', 'ANDROID'));
  });

  test('starting twice does not double-subscribe or register twice', () async {
    final c = build();
    await c.start();
    await c.start();
    expect(repo.registered, hasLength(1));
    messaging.foreground.add(const PushPayload(title: 't', body: 'b'));
    await Future<void>.delayed(Duration.zero);
    expect(shown, hasLength(1));
  });

  test('passes pushes that arrive while open, and taps, on to the app', () async {
    await build().start();
    messaging.foreground.add(const PushPayload(title: 'Approval needed', body: 'x'));
    messaging.opened.add(const PushPayload(title: 'Paid', body: 'y', actionUrl: '/finance/requests/r-1'));
    await Future<void>.delayed(Duration.zero);
    expect(shown.single.title, 'Approval needed');
    expect(opened.single.financeRequestId, 'r-1');
  });

  test('opens the push that launched the app', () async {
    messaging.launched = const PushPayload(title: 'Returned', body: 'z', actionUrl: '/finance/requests/r-9');
    await build().start();
    expect(opened.single.financeRequestId, 'r-9');
  });

  test('a failed registration does not break setup, and a later token tries again', () async {
    repo.failing = true;
    final c = build();
    await c.start();
    expect(statuses.last, PushStatus.active);
    repo.failing = false;
    messaging.refresh.add('tok-3');
    await Future<void>.delayed(Duration.zero);
    expect(repo.registered, [('tok-3', 'ANDROID')]);
  });

  test('stopping with unregister tells the server to forget this device, and stops listening', () async {
    final c = build();
    await c.start();
    await c.stop(unregister: true);
    expect(repo.unregistered, ['tok-1']);
    expect(c.isRunning, isFalse);
    messaging.foreground.add(const PushPayload(title: 't', body: 'b'));
    await Future<void>.delayed(Duration.zero);
    expect(shown, isEmpty);
  });

  test('stopping without unregister, or while offline, still stops quietly', () async {
    final c = build();
    await c.start();
    repo.failing = true;
    await c.stop(unregister: true);
    expect(c.isRunning, isFalse);
    final d = build();
    await d.start();
    await d.stop();
    expect(repo.unregistered, isEmpty);
  });
}
