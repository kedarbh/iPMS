import 'dart:async';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'push_payload.dart';

/// The device's push channel. A small seam over Firebase so the logic around it can be tested.
abstract class PushMessaging {
  /// Starts the provider. False when this build has no Firebase configuration, in which case push stays off.
  Future<bool> init();

  /// Asks the user (Android 13+, iOS). True when notifications may be shown.
  Future<bool> requestPermission();

  Future<String?> getToken();
  Stream<String> get onTokenRefresh;

  /// A push that arrived while the app is open (the system shows nothing then).
  Stream<PushPayload> get onForeground;

  /// The user tapped a push while the app was in the background.
  Stream<PushPayload> get onOpened;

  /// The push that launched the app from a closed state, if any.
  Future<PushPayload?> initialMessage();

  Future<void> deleteToken();
}

PushPayload _payloadOf(RemoteMessage m) =>
    PushPayload.fromMessage(title: m.notification?.title, body: m.notification?.body, data: m.data);

class FirebasePushMessaging implements PushMessaging {
  FirebaseMessaging? _fm;

  FirebaseMessaging get _messaging => _fm!;

  @override
  Future<bool> init() async {
    try {
      // Reads google-services.json / GoogleService-Info.plist. Without one, this throws and push stays off.
      if (Firebase.apps.isEmpty) await Firebase.initializeApp();
      _fm = FirebaseMessaging.instance;
      return true;
    } catch (_) {
      return false;
    }
  }

  @override
  Future<bool> requestPermission() async {
    final settings = await _messaging.requestPermission();
    return settings.authorizationStatus == AuthorizationStatus.authorized || settings.authorizationStatus == AuthorizationStatus.provisional;
  }

  @override
  Future<String?> getToken() => _messaging.getToken();

  @override
  Stream<String> get onTokenRefresh => _messaging.onTokenRefresh;

  @override
  Stream<PushPayload> get onForeground => FirebaseMessaging.onMessage.map(_payloadOf);

  @override
  Stream<PushPayload> get onOpened => FirebaseMessaging.onMessageOpenedApp.map(_payloadOf);

  @override
  Future<PushPayload?> initialMessage() async {
    final m = await _messaging.getInitialMessage();
    return m == null ? null : _payloadOf(m);
  }

  @override
  Future<void> deleteToken() => _messaging.deleteToken();
}
