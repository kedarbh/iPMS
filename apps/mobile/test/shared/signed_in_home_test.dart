import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/auth/domain/models/auth_user.dart';
import 'package:mobile/main.dart';

Future<void> pumpHome(WidgetTester tester, AuthUser user) async {
  await tester.pumpWidget(
    ProviderScope(child: MaterialApp(home: SignedInHome(user: user))),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
}

void main() {
  const inHouse = AuthUser(
    id: 'u-1', email: 'in@house', permissions: ['task.view', 'finance_request.view'],
  );
  const vendor = AuthUser(id: 'u-2', email: 'ven@dor', permissions: ['task.view']);

  testWidgets('shows the Finance tab to a user who may use finance', (tester) async {
    await pumpHome(tester, inHouse);
    expect(find.byIcon(Icons.account_balance_wallet_outlined), findsOneWidget);
  });

  testWidgets('hides the Finance tab from a user whose finance is handled elsewhere', (tester) async {
    await pumpHome(tester, vendor);
    expect(find.byIcon(Icons.account_balance_wallet_outlined), findsNothing);
    // Tasks is the selected tab, so the bar draws its filled icon.
    expect(find.byIcon(Icons.assignment_rounded), findsOneWidget);

    // Profile is still reachable at its own index.
    await tester.tap(find.byIcon(Icons.person_outline_rounded));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Security'), findsOneWidget);
  });
}
