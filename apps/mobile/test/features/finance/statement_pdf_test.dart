import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/finance/data/statement_pdf.dart';
import 'package:mobile/features/finance/domain/finance_models.dart';
import 'package:mobile/features/finance/domain/finance_statement.dart';

import 'finance_harness.dart';

void main() {
  test('the statement is a real PDF, naming whose it is', () async {
    final requests = [
      FinanceRequest.fromJson(record('a1', 'PAID', approved: '25000.00', created: isoOn(10, 4), extra: {'balance': balance('25000.00', paid: '25000.00')})),
      FinanceRequest.fromJson(record('s1', 'SETTLED', kind: 'SETTLEMENT', amount: '17250.00', approved: '17250.00', created: isoOn(10, 6), extra: {'advanceId': 'a3', 'appliedAmount': '17250.00'})),
    ];
    final statement = buildStatement(requests, '2026-10', DateTime(2026, 10, 10));
    final bytes = await buildStatementPdf(
      statement,
      const StatementOwner(name: 'Anil Gurung', role: 'Field engineer', employeeCode: 'FE-0418'),
      DateTime(2026, 10, 10, 9),
    );

    expect(utf8.decode(bytes.sublist(0, 5)), '%PDF-');
    expect(bytes.length, greaterThan(1500));
  });

  test('is named for its period', () {
    expect(periodLabel('2026-10'), 'October 2026');
    expect(periodLabel('all'), 'All time');
  });
}
