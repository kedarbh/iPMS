import 'dart:typed_data';
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import '../domain/finance_models.dart';
import '../domain/finance_overview.dart';
import '../domain/finance_statement.dart';
import '../domain/finance_view.dart';

/// Whose statement it is, as the header names them.
class StatementOwner {
  const StatementOwner({required this.name, this.role, this.employeeCode});

  final String name;
  final String? role;
  final String? employeeCode;
}

String periodLabel(String key) => key == 'all' ? 'All time' : monthLabel(key);

/// The statement as a one-page-or-more PDF: header, the five totals, then every transaction.
Future<Uint8List> buildStatementPdf(FinanceStatement s, StatementOwner owner, DateTime generatedAt) async {
  final doc = pw.Document(title: 'Finance statement', author: owner.name);
  const ink = PdfColor.fromInt(0xFF111318);
  const muted = PdfColor.fromInt(0xFF737983);

  pw.Widget totalRow(String label, int minor, {bool bold = false}) => pw.Padding(
        padding: const pw.EdgeInsets.symmetric(vertical: 4),
        child: pw.Row(
          mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
          children: [
            pw.Text(label, style: pw.TextStyle(fontSize: 11, fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal)),
            pw.Text(formatRupees(minor), style: pw.TextStyle(fontSize: 11, fontWeight: pw.FontWeight.bold)),
          ],
        ),
      );

  doc.addPage(
    pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.all(36),
      header: (_) => pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.Text('Statement - ${periodLabel(s.periodKey)}', style: pw.TextStyle(fontSize: 18, fontWeight: pw.FontWeight.bold, color: ink)),
          pw.SizedBox(height: 4),
          pw.Text(
            [owner.name, if (owner.role != null) owner.role!, if ((owner.employeeCode ?? '').isNotEmpty) 'Employee ID ${owner.employeeCode}'].join('  |  '),
            style: const pw.TextStyle(fontSize: 10, color: muted),
          ),
          pw.Text('Generated ${DateFormat('d MMM yyyy, h:mm a').format(generatedAt)}', style: const pw.TextStyle(fontSize: 9, color: muted)),
          pw.SizedBox(height: 14),
        ],
      ),
      build: (_) => [
        totalRow('Advances received', s.received),
        totalRow('Settled with receipts', s.spent),
        totalRow('Balance returned', s.returned),
        totalRow('Excess claimed', s.claimed),
        pw.Divider(color: PdfColors.grey400),
        totalRow('Outstanding to settle', s.outstanding, bold: true),
        pw.SizedBox(height: 16),
        pw.Text('${s.rows.length} transactions', style: pw.TextStyle(fontSize: 12, fontWeight: pw.FontWeight.bold)),
        pw.SizedBox(height: 6),
        pw.TableHelper.fromTextArray(
          headerStyle: pw.TextStyle(fontSize: 9, fontWeight: pw.FontWeight.bold),
          cellStyle: const pw.TextStyle(fontSize: 9),
          headerDecoration: const pw.BoxDecoration(color: PdfColors.grey200),
          cellAlignments: {3: pw.Alignment.centerRight},
          headers: ['ID', 'Title', 'Date', 'Amount', 'Status'],
          data: [
            for (final v in s.rows)
              [
                v.request.number,
                v.request.purpose,
                DateFormat('d MMM yyyy').format(v.request.createdAt),
                formatMoney(v.amount),
                v.style.label,
              ],
          ],
        ),
      ],
    ),
  );
  return doc.save();
}
