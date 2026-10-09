import 'dart:async';
import 'package:flutter/foundation.dart' show debugPrint;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/push/push_providers.dart';
import '../../../core/security/token_storage.dart';
import '../data/auth_repository.dart';
import '../domain/models/auth_user.dart';

final tokenStorageProvider = Provider<TokenStorage>((ref) {
  return TokenStorage();
});

final apiClientProvider = Provider<ApiClient>((ref) {
  final tokenStorage = ref.watch(tokenStorageProvider);
  return ApiClient(
    tokenStorage: tokenStorage,
    // Read when it fires, not now: the auth notifier itself depends on this client.
    onSessionExpired: () => ref.read(authStateProvider.notifier).sessionExpired(),
  );
});

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  final tokenStorage = ref.watch(tokenStorageProvider);
  return AuthRepository(apiClient: apiClient, tokenStorage: tokenStorage);
});

class AuthNotifier extends AsyncNotifier<AuthUser?> {
  @override
  FutureOr<AuthUser?> build() async {
    final repo = ref.watch(authRepositoryProvider);
    final hasSession = await repo.hasSavedSession();
    if (!hasSession) {
      return null;
    }
    try {
      return await repo.getCurrentUser();
    } on NetworkException {
      // Offline at launch says nothing about the session: keep the tokens so
      // signing in again (or biometrics) can restore it once back online.
      return null;
    } catch (_) {
      await repo.logout();
      return null;
    }
  }

  Future<void> login(String email, String password) async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(() async {
      return await ref.read(authRepositoryProvider).login(
            email: email,
            password: password,
          );
    });
    if (state.hasError) {
      // Shown on the sign-in screen too; logged so a device console says why.
      debugPrint('Sign-in failed: ${state.error}');
    }
    if (state.value != null) {
      // The main screen offers biometric sign-in once it is showing; the
      // login screen is gone by then.
      ref.read(biometricOfferPendingProvider.notifier).set(true);
    }
  }

  Future<void> loginWithBiometrics(String username) async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(() async {
      return await ref
          .read(authRepositoryProvider)
          .loginWithBiometrics(username: username);
    });
  }

  /// Saves the caller's own profile. Throws when the server refuses, leaving
  /// the signed-in user as it was, so the caller can say what went wrong.
  Future<void> updateProfile({
    String? fullName,
    String? email,
    String? employeeCode,
    String? phone,
  }) async {
    final updated = await ref.read(authRepositoryProvider).updateProfile(
          fullName: fullName,
          email: email,
          employeeCode: employeeCode,
          phone: phone,
        );
    state = AsyncValue.data(updated);
  }

  /// The server refused to refresh the session (expired or revoked). Return
  /// to sign-in; the session kept for biometrics, if any, is left to decide
  /// for itself whether it is still valid.
  void sessionExpired() {
    if (state.value != null) state = const AsyncValue.data(null);
  }

  /// Signs out. While biometric sign-in is enrolled (and [purgeBiometrics]
  /// is false) this only locks the app, so Face ID / fingerprint can reopen
  /// the session; otherwise every session is revoked on the server.
  Future<void> logout({bool purgeBiometrics = false}) async {
    // Forget this device while the session still works; a signed-out phone must not get someone's pushes.
    try {
      await ref.read(pushControllerProvider).stop(unregister: true);
    } catch (_) {}
    state = const AsyncValue.loading();
    final keep = !purgeBiometrics &&
        await ref.read(tokenStorageProvider).isBiometricEnabled();
    await ref.read(authRepositoryProvider).logout(keepBiometricSession: keep);
    state = const AsyncValue.data(null);
  }
}

/// Set after a password sign-in, so the main screen can offer to turn on
/// biometric sign-in. Cleared once the offer has been made.
class BiometricOfferPendingNotifier extends Notifier<bool> {
  @override
  bool build() => false;

  void set(bool value) => state = value;
}

final biometricOfferPendingProvider =
    NotifierProvider<BiometricOfferPendingNotifier, bool>(
  BiometricOfferPendingNotifier.new,
);

final authStateProvider =
    AsyncNotifierProvider<AuthNotifier, AuthUser?>(AuthNotifier.new);

/// The account whose data the app is holding: the last user who signed in.
/// Changes only when a *different* user signs in, never on sign-out, so a
/// biometric lock and unlock keeps unsent photos while a new account on the
/// same phone never sees the previous one's work. Data providers watch it to
/// start clean for each account.
class SessionOwnerNotifier extends Notifier<String?> {
  @override
  String? build() {
    ref.listen(authStateProvider, (_, next) {
      final id = next.value?.id;
      if (id != null && id != state) state = id;
    });
    return ref.read(authStateProvider).value?.id;
  }
}

final sessionOwnerProvider =
    NotifierProvider<SessionOwnerNotifier, String?>(SessionOwnerNotifier.new);
