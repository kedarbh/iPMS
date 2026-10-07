import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../auth/providers/auth_provider.dart';
import '../../media/providers/evidence_upload_provider.dart';
import '../data/finance_repository.dart';
import '../data/invoice_photo_uploader.dart';
import '../domain/finance_models.dart';

final financeRepositoryProvider = Provider<FinanceRepository>((ref) {
  ref.watch(sessionOwnerProvider);
  return FinanceRepository(apiClient: ref.watch(apiClientProvider));
});

/// The signed-in user's own requests, newest first.
final myFinanceRequestsProvider = FutureProvider<List<FinanceRequest>>((ref) {
  return ref.watch(financeRepositoryProvider).myRequests();
});

/// Other people's requests waiting on the signed-in user.
final awaitingFinanceRequestsProvider = FutureProvider<List<FinanceRequest>>((ref) {
  return ref.watch(financeRepositoryProvider).awaitingMe();
});

/// Everyone's requests in the approver's project scope.
final scopeFinanceRequestsProvider = FutureProvider<List<FinanceRequest>>((ref) {
  return ref.watch(financeRepositoryProvider).inMyScope();
});

/// Others' requests the approver has already acted on.
final handledFinanceRequestsProvider = FutureProvider<List<FinanceRequest>>((ref) {
  return ref.watch(financeRepositoryProvider).handledByMe();
});

/// Finance notifications, newest first.
final financeNotificationsProvider = FutureProvider<List<FinanceNotification>>((ref) {
  return ref.watch(financeRepositoryProvider).notifications();
});

/// Names by user id, for history and requester lines.
final financeUserNamesProvider = FutureProvider<Map<String, String>>((ref) {
  return ref.watch(financeRepositoryProvider).userNames();
});

final financeRequestProvider = FutureProvider.family<FinanceRequest, String>((ref, id) {
  return ref.watch(financeRepositoryProvider).getRequest(id);
});

/// Categories a request can be filed under (disabled ones left out).
final financeCategoriesProvider = FutureProvider<List<ExpenseCategory>>((ref) {
  return ref.watch(financeRepositoryProvider).categories();
});

final invoicePhotoUploaderProvider = Provider<InvoicePhotoUploader>((ref) {
  return InvoicePhotoUploader(
    media: ref.watch(mediaRepositoryProvider),
    deviceId: () => ref.read(tokenStorageProvider).getOrCreateDeviceId(),
  );
});
