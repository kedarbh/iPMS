import 'dart:async';
import 'package:flutter/foundation.dart';
import 'push_messaging.dart';
import 'push_payload.dart';
import 'push_repository.dart';

/// Where push stands on this device.
enum PushStatus {
  /// Not started yet (or switched off).
  idle,

  /// Registered; pushes will arrive.
  active,

  /// This build has no Firebase configuration.
  unavailable,

  /// The user refused notifications in the system prompt.
  denied,
}

/// Registers this device for push while someone is signed in, and turns pushes into app actions.
class PushController {
  PushController({
    required this.messaging,
    required this.repository,
    required this.platform,
    required this.isEnabled,
    required this.onForeground,
    required this.onOpen,
    required this.onStatus,
  });

  final PushMessaging messaging;
  final PushRepository repository;

  /// `ANDROID` or `IOS`.
  final String platform;
  final Future<bool> Function() isEnabled;
  final void Function(PushPayload) onForeground;
  final void Function(PushPayload) onOpen;
  final void Function(PushStatus) onStatus;

  final List<StreamSubscription<Object?>> _subscriptions = [];
  String? _token;
  bool _starting = false;

  bool get isRunning => _subscriptions.isNotEmpty;

  /// Gets permission and a token, tells the server, and starts listening. Safe to call again.
  Future<void> start() async {
    if (_starting || isRunning) return;
    if (!await isEnabled()) {
      onStatus(PushStatus.idle);
      return;
    }
    _starting = true;
    try {
      if (!await messaging.init()) {
        onStatus(PushStatus.unavailable);
        return;
      }
      if (!await messaging.requestPermission()) {
        onStatus(PushStatus.denied);
        return;
      }
      _subscriptions
        ..add(messaging.onTokenRefresh.listen((t) => unawaited(_register(t))))
        ..add(messaging.onForeground.listen(onForeground))
        ..add(messaging.onOpened.listen(onOpen));
      final token = await messaging.getToken();
      if (token != null) await _register(token);
      onStatus(PushStatus.active);
      final launched = await messaging.initialMessage();
      if (launched != null) onOpen(launched);
    } catch (e) {
      debugPrint('Push setup failed: $e');
    } finally {
      _starting = false;
    }
  }

  /// Stops listening. With [unregister] the server forgets this device too, which must happen while still signed in.
  Future<void> stop({bool unregister = false}) async {
    for (final s in _subscriptions) {
      await s.cancel();
    }
    _subscriptions.clear();
    final token = _token;
    _token = null;
    onStatus(PushStatus.idle);
    if (unregister && token != null) {
      try {
        await repository.unregister(token);
      } catch (_) {
        // Signed out or offline: the server drops the token the first time FCM refuses it.
      }
    }
  }

  Future<void> _register(String token) async {
    _token = token;
    try {
      await repository.register(token, platform);
    } catch (e) {
      debugPrint('Push registration failed: $e');
    }
  }
}
