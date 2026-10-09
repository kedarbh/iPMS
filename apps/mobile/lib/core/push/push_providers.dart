import 'dart:async';
import 'dart:io' show Platform;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../features/auth/providers/auth_provider.dart';
import '../../features/finance/presentation/request_detail_screen.dart';
import '../../features/finance/providers/finance_providers.dart';
import 'push_controller.dart';
import 'push_messaging.dart';
import 'push_payload.dart';
import 'push_repository.dart';

/// Lets a tapped push open a screen from outside the widget tree.
final GlobalKey<NavigatorState> rootNavigatorKey = GlobalKey<NavigatorState>();

/// Lets a push that arrives while the app is open show a banner on whatever screen is up.
final GlobalKey<ScaffoldMessengerState> rootMessengerKey = GlobalKey<ScaffoldMessengerState>();

final pushMessagingProvider = Provider<PushMessaging>((ref) => FirebasePushMessaging());

final pushRepositoryProvider = Provider<PushRepository>((ref) => PushRepository(apiClient: ref.watch(apiClientProvider)));

class PushStatusNotifier extends Notifier<PushStatus> {
  @override
  PushStatus build() => PushStatus.idle;

  void set(PushStatus status) => state = status;
}

final pushStatusProvider = NotifierProvider<PushStatusNotifier, PushStatus>(PushStatusNotifier.new);

/// Whether the user has push switched on for this device (on by default).
class PushEnabledNotifier extends AsyncNotifier<bool> {
  @override
  Future<bool> build() => ref.watch(tokenStorageProvider).isPushEnabled();

  Future<void> set(bool enabled) async {
    await ref.read(tokenStorageProvider).setPushEnabled(enabled);
    state = AsyncData(enabled);
    final controller = ref.read(pushControllerProvider);
    if (enabled) {
      await controller.start();
    } else {
      await controller.stop(unregister: true);
    }
  }
}

final pushEnabledProvider = AsyncNotifierProvider<PushEnabledNotifier, bool>(PushEnabledNotifier.new);

final pushControllerProvider = Provider<PushController>((ref) {
  return PushController(
    messaging: ref.watch(pushMessagingProvider),
    repository: ref.watch(pushRepositoryProvider),
    platform: Platform.isIOS ? 'IOS' : 'ANDROID',
    isEnabled: () => ref.read(tokenStorageProvider).isPushEnabled(),
    onForeground: (p) => showPushBanner(ref, p),
    onOpen: (p) => openPush(ref, p),
    onStatus: (s) => Future.microtask(() => ref.read(pushStatusProvider.notifier).set(s)),
  );
});

/// Starts push when someone is signed in. Sign-out stops it (and forgets the device) in `AuthNotifier.logout`.
final pushLifecycleProvider = Provider<void>((ref) {
  final controller = ref.watch(pushControllerProvider);
  ref.listen<AsyncValue<Object?>>(authStateProvider, (previous, next) {
    if (next.value != null) unawaited(controller.start());
  }, fireImmediately: true);
});

/// A push that arrives with the app open: refresh what it concerns and offer to open it.
void showPushBanner(Ref ref, PushPayload p) {
  ref.invalidate(financeNotificationsProvider);
  ref.invalidate(awaitingFinanceRequestsProvider);
  rootMessengerKey.currentState
    ?..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        behavior: SnackBarBehavior.floating,
        content: Text(p.title.isEmpty ? p.body : '${p.title}\n${p.body}'),
        action: SnackBarAction(label: 'Open', onPressed: () => openPush(ref, p)),
      ),
    );
}

/// Opens what a tapped push is about. A finance request opens its detail; anything else leaves the
/// app where it is, since the push has already told the user what it said.
void openPush(Ref ref, PushPayload p) {
  final requestId = p.financeRequestId;
  if (requestId == null) return;
  void go() => rootNavigatorKey.currentState?.push<void>(MaterialPageRoute(builder: (_) => RequestDetailScreen(requestId: requestId)));
  if (rootNavigatorKey.currentState != null) {
    go();
  } else {
    // Launched from a closed state: the navigator is not up until the first frame.
    WidgetsBinding.instance.addPostFrameCallback((_) => go());
  }
}
