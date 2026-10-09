import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

/// Secure enclave storage service strictly holding authentication tokens.
/// No entity or server-side domain data is ever stored here.
class TokenStorage {
  TokenStorage({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(),
              iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
            );

  final FlutterSecureStorage _storage;

  static const String _accessTokenKey = 'ipms_access_token';
  static const String _refreshTokenKey = 'ipms_refresh_token';
  static const String _userIdKey = 'ipms_user_id';
  static const String _biometricEnabledKey = 'ipms_biometric_enabled';
  static const String _biometricUsernameKey = 'ipms_biometric_username';
  static const String _biometricRefreshTokenKey = 'ipms_biometric_refresh_token';
  static const String _biometricUserIdKey = 'ipms_biometric_user_id';
  static const String _deviceIdKey = 'ipms_device_id';
  static const String _apiBaseUrlKey = 'ipms_api_base_url';
  static const String _hasSeenGuideKey = 'ipms_has_seen_guide_v1';
  static const String _pushEnabledKey = 'ipms_push_enabled';

  Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
    String? userId,
  }) async {
    await _storage.write(key: _accessTokenKey, value: accessToken);
    await _storage.write(key: _refreshTokenKey, value: refreshToken);
    if (userId != null) {
      await _storage.write(key: _userIdKey, value: userId);
    }
    // Keep the biometric session current, but only for the account it was
    // enrolled for: a refresh token must never move into another user's
    // biometric slot. A sign-in whose user is not yet known is bound later
    // through [bindBiometricSession].
    final owner = userId ?? await getUserId();
    if (owner != null && await isBiometricEnabled()) {
      final enrolledFor = await getBiometricUserId();
      if (enrolledFor == null || enrolledFor == owner) {
        await _storage.write(key: _biometricRefreshTokenKey, value: refreshToken);
        await _storage.write(key: _biometricUserIdKey, value: owner);
      }
    }
  }

  /// Called once the signed-in user is known. Copies the session into the
  /// biometric slot when biometrics are enrolled for this user; when they are
  /// enrolled for someone else, that enrollment is removed, since a different
  /// account now uses this device.
  Future<void> bindBiometricSession(String userId) async {
    if (!await isBiometricEnabled()) return;
    final enrolledFor = await getBiometricUserId();
    if (enrolledFor != null && enrolledFor != userId) {
      await clearBiometric();
      return;
    }
    final refresh = await getRefreshToken();
    if (refresh != null && refresh.isNotEmpty) {
      await _storage.write(key: _biometricRefreshTokenKey, value: refresh);
    }
    await _storage.write(key: _biometricUserIdKey, value: userId);
  }

  /// Forgets the stored biometric session but keeps the enrollment, so the
  /// next password sign-in re-arms it.
  Future<void> clearBiometricSession() =>
      _storage.delete(key: _biometricRefreshTokenKey);

  Future<String?> getAccessToken() => _storage.read(key: _accessTokenKey);

  Future<String?> getRefreshToken() => _storage.read(key: _refreshTokenKey);

  Future<String?> getUserId() => _storage.read(key: _userIdKey);

  Future<void> saveUserId(String userId) =>
      _storage.write(key: _userIdKey, value: userId);

  /// The server address chosen on the sign-in screen, overriding the one
  /// the app was built with. Null when none was chosen.
  Future<String?> getApiBaseUrl() => _storage.read(key: _apiBaseUrlKey);

  Future<void> setApiBaseUrl(String? url) => url == null || url.isEmpty
      ? _storage.delete(key: _apiBaseUrlKey)
      : _storage.write(key: _apiBaseUrlKey, value: url);

  /// A stable id for this installation, sent with every evidence upload so
  /// the server can tell which phone a file came from. Survives sign-out.
  Future<String> getOrCreateDeviceId() async {
    final existing = await _storage.read(key: _deviceIdKey);
    if (existing != null && existing.isNotEmpty) return existing;
    final created = const Uuid().v4();
    await _storage.write(key: _deviceIdKey, value: created);
    return created;
  }

  Future<String?> getBiometricRefreshToken() =>
      _storage.read(key: _biometricRefreshTokenKey);

  Future<String?> getBiometricUserId() =>
      _storage.read(key: _biometricUserIdKey);

  Future<bool> isBiometricEnabled() async {
    final value = await _storage.read(key: _biometricEnabledKey);
    return value == 'true';
  }

  Future<void> setBiometricEnabled(bool enabled) async {
    await _storage.write(
      key: _biometricEnabledKey,
      value: enabled ? 'true' : 'false',
    );
  }

  /// Whether this device may receive push notifications. On unless the user switched it off.
  Future<bool> isPushEnabled() async => (await _storage.read(key: _pushEnabledKey)) != 'false';

  Future<void> setPushEnabled(bool enabled) => _storage.write(key: _pushEnabledKey, value: enabled ? 'true' : 'false');

  Future<String?> getBiometricUsername() =>
      _storage.read(key: _biometricUsernameKey);

  Future<void> setBiometricUsername(String? username) async {
    if (username != null && username.isNotEmpty) {
      await _storage.write(key: _biometricUsernameKey, value: username);
      // Sync current refresh token for biometric re-login
      final currentRefresh = await getRefreshToken();
      final currentUserId = await getUserId();
      if (currentRefresh != null && currentRefresh.isNotEmpty) {
        await _storage.write(key: _biometricRefreshTokenKey, value: currentRefresh);
      }
      if (currentUserId != null && currentUserId.isNotEmpty) {
        await _storage.write(key: _biometricUserIdKey, value: currentUserId);
      }
    } else {
      await _storage.delete(key: _biometricUsernameKey);
    }
  }

  Future<void> clearBiometric() async {
    await _storage.delete(key: _biometricEnabledKey);
    await _storage.delete(key: _biometricUsernameKey);
    await _storage.delete(key: _biometricRefreshTokenKey);
    await _storage.delete(key: _biometricUserIdKey);
  }

  Future<void> clearTokens({bool purgeBiometrics = false}) async {
    await _storage.delete(key: _accessTokenKey);
    await _storage.delete(key: _refreshTokenKey);
    await _storage.delete(key: _userIdKey);
    if (purgeBiometrics) {
      await clearBiometric();
    }
  }

  /// Checks if the user has already viewed the onboarding project guide.
  Future<bool> hasSeenProjectGuide() async {
    final val = await _storage.read(key: _hasSeenGuideKey);
    return val == 'true';
  }

  /// Records that the user has seen the project guide so it won't auto-pop again.
  Future<void> markProjectGuideAsSeen() async {
    await _storage.write(key: _hasSeenGuideKey, value: 'true');
  }
}
