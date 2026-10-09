import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/config/env.dart';
import 'core/push/push_providers.dart';
import 'core/security/token_storage.dart';
import 'core/theme/app_theme.dart';
import 'features/auth/presentation/login_screen.dart';
import 'features/auth/providers/auth_provider.dart';
import 'features/finance/presentation/finance_screen.dart';
import 'features/profile/presentation/profile_screen.dart';
import 'features/projects/presentation/project_list_screen.dart';
import 'features/tasks/presentation/task_list_screen.dart';
import 'shared/layout/main_scaffold.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // A server address chosen on the sign-in screen wins over the built-in one.
  try {
    AppConfig.setCustomApiUrl(await TokenStorage().getApiBaseUrl());
  } catch (_) {
    // Keychain unavailable: fall back to the built-in address.
  }
  runApp(
    const ProviderScope(
      child: IpmsApp(),
    ),
  );
}

class IpmsApp extends ConsumerWidget {
  const IpmsApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authStateProvider);
    final user = authState.value;
    ref.watch(pushLifecycleProvider);

    // A sign-in or sign-out in progress keeps the previous value, so the
    // screen the user is on stays put (and can react when it finishes). Only
    // the very first session check, before anything is known, shows a splash.
    final Widget home;
    if (user != null) {
      home = const MainScaffold(
        pages: [
          TaskListScreen(),
          ProjectListScreen(),
          FinanceScreen(),
          ProfileScreen(),
        ],
      );
    } else if (authState.isLoading && !authState.hasValue && !authState.hasError) {
      home = const Scaffold(body: Center(child: CircularProgressIndicator()));
    } else {
      home = const LoginScreen();
    }

    return MaterialApp(
      title: 'Axiom Field App',
      navigatorKey: rootNavigatorKey,
      scaffoldMessengerKey: rootMessengerKey,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      home: home,
    );
  }
}
