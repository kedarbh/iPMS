import 'dart:async';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../../../core/config/env.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/services/watermark_service.dart' show maxEvidencePhotoBytes;
import '../../auth/providers/auth_provider.dart';
import '../../tasks/domain/models/task_evidence.dart';
import '../../tasks/providers/evidence_provider.dart';
import '../data/media_repository.dart';

final mediaRepositoryProvider = Provider<MediaRepository>((ref) {
  return MediaRepository(apiClient: ref.watch(apiClientProvider));
});

final evidenceUploaderProvider = Provider<EvidenceUploader>((ref) {
  return EvidenceUploader(ref);
});

/// Moves captured photos from the phone to the media bucket.
///
/// A photo is sent once it belongs to a checklist item (the server files it
/// under the work order and item). Every step is idempotent on the photo's
/// media id, so a retry after a dropped connection picks up where it stopped.
class EvidenceUploader {
  EvidenceUploader(this._ref);

  final Ref _ref;
  final Set<String> _inFlight = {};

  static const Duration _pollInterval = Duration(seconds: 2);

  /// Most uploads in flight at once. A task can hold up to 1500 photos;
  /// starting them all together reads every file into memory at once and
  /// trips the server's per-user cap on unfinished uploads (429).
  static const int maxConcurrentUploads = 4;

  /// Most ids `POST /media/uploads/status` takes in one call.
  static const int statusBatchSize = 200;

  int _activeUploads = 0;
  final List<Completer<void>> _waitingForSlot = [];

  Future<void> _acquireSlot() async {
    if (_activeUploads < maxConcurrentUploads) {
      _activeUploads++;
      return;
    }
    final turn = Completer<void>();
    _waitingForSlot.add(turn);
    // The slot is handed over by _releaseSlot, so the count stays as it is.
    await turn.future;
  }

  void _releaseSlot() {
    if (_waitingForSlot.isNotEmpty) {
      _waitingForSlot.removeAt(0).complete();
    } else {
      _activeUploads--;
    }
  }

  MediaRepository get _media => _ref.read(mediaRepositoryProvider);
  TaskEvidenceNotifier get _evidence => _ref.read(taskEvidenceProvider.notifier);

  /// Uploads every photo of [taskId] that is on a checklist item and not yet
  /// on the server. Returns once each has been attempted.
  Future<void> uploadPending(String taskId) async {
    final pending = (_ref.read(taskEvidenceProvider)[taskId] ?? const <TaskEvidence>[])
        .where(_needsUpload)
        .map((e) => e.id)
        .toList();
    await Future.wait(pending.map((id) => upload(taskId, id)));
  }

  /// Uploads one photo. Failures are recorded on the evidence, not thrown.
  /// At most [maxConcurrentUploads] run at once; the rest wait their turn.
  Future<void> upload(String taskId, String evidenceId) async {
    if (AppConfig.demoMode) return;
    if (!_inFlight.add(evidenceId)) return;
    await _acquireSlot();
    try {
      var ev = _evidence.find(taskId, evidenceId);
      if (ev == null || !_needsUpload(ev)) return;

      if (ev.uploadStatus == EvidenceUploadStatus.rejected) {
        // The server deleted the refused bytes; the same id cannot be reused.
        _evidence.updateEvidence(taskId, evidenceId,
            (e) => e.copyWith(mediaId: const Uuid().v7(), clearContentHash: true));
        ev = _evidence.find(taskId, evidenceId)!;
      }
      _setStatus(taskId, evidenceId, EvidenceUploadStatus.uploading);

      final bytes = await File(ev.filePath).readAsBytes();
      if (bytes.length > maxEvidencePhotoBytes) {
        _setStatus(taskId, evidenceId, EvidenceUploadStatus.failed,
            error: 'Photo is larger than 5 MB. Retake it.');
        return;
      }
      final hash = ev.contentHash ?? sha256.convert(bytes).toString();
      _evidence.updateEvidence(taskId, evidenceId, (e) => e.copyWith(contentHash: hash));
      final deviceId = await _ref.read(tokenStorageProvider).getOrCreateDeviceId();
      final target = ev;

      Future<String> send() async {
        final registration = await _media.register(
          id: target.mediaId,
          workOrderId: taskId,
          checklistItemId: target.checklistItemId!,
          sizeBytes: bytes.length,
          contentHash: hash,
          capturedAt: target.capturedAt,
          deviceId: deviceId,
          latitude: target.hasLocationFix ? target.latitude : null,
          longitude: target.hasLocationFix ? target.longitude : null,
        );
        if (!registration.needsBytes) return registration.status;
        if (registration.mode != 'single') {
          throw const ApiException(message: 'The server asked for a multipart upload, which photos never need.');
        }
        await _media.putBytes(registration, bytes);
        return _media.complete(target.mediaId);
      }

      String status;
      try {
        status = await send();
      } on ApiException catch (e) {
        // 412: the bytes had not arrived when `complete` ran. Send again once.
        if (e.statusCode != 412) rethrow;
        status = await send();
      }
      _applyServerStatus(taskId, evidenceId, status);
    } on ApiException catch (e) {
      _setStatus(
        taskId,
        evidenceId,
        // 409: this id is already registered with different bytes; only a
        // fresh id can carry this file, which the rejected path provides.
        e.statusCode == 409 ? EvidenceUploadStatus.rejected : EvidenceUploadStatus.failed,
        error: e.message,
      );
    } catch (e) {
      _setStatus(taskId, evidenceId, EvidenceUploadStatus.failed, error: 'Upload failed: $e');
    } finally {
      _releaseSlot();
      _inFlight.remove(evidenceId);
    }
  }

  /// Asks the server how the photos it is still checking turned out.
  Future<void> refreshStatuses(String taskId) async {
    if (AppConfig.demoMode) return;
    final verifying = (_ref.read(taskEvidenceProvider)[taskId] ?? const <TaskEvidence>[])
        .where((e) => e.uploadStatus == EvidenceUploadStatus.verifying)
        .toList();
    if (verifying.isEmpty) return;
    final byMediaId = {for (final e in verifying) e.mediaId: e.id};
    final ids = byMediaId.keys.toList();
    // The server refuses more than [statusBatchSize] ids per call, so ask in batches.
    for (var start = 0; start < ids.length; start += statusBatchSize) {
      final end = start + statusBatchSize < ids.length ? start + statusBatchSize : ids.length;
      final statuses = await _media.status(ids.sublist(start, end));
      for (final item in statuses) {
        final evidenceId = byMediaId[item.id];
        if (evidenceId == null) continue;
        _applyServerStatus(taskId, evidenceId, item.status, rejectReason: item.rejectReason);
      }
    }
  }

  /// Uploads [evidenceIds] and waits until the server has verified them all.
  /// Returns the ones that did not make it (failed, rejected, or still
  /// verifying at [timeout]); an empty list means all are READY.
  Future<List<TaskEvidence>> uploadAndWait(
    String taskId,
    Set<String> evidenceIds, {
    Duration timeout = const Duration(seconds: 90),
  }) async {
    if (AppConfig.demoMode) return const [];
    List<TaskEvidence> current() => (_ref.read(taskEvidenceProvider)[taskId] ?? const <TaskEvidence>[])
        .where((e) => evidenceIds.contains(e.id))
        .toList();

    await Future.wait(current().where(_needsUpload).map((e) => upload(taskId, e.id)));

    final deadline = DateTime.now().add(timeout);
    while (current().any((e) => e.uploadStatus == EvidenceUploadStatus.verifying) &&
        DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(_pollInterval);
      try {
        await refreshStatuses(taskId);
      } on ApiException {
        // Keep polling until the deadline; a blip is not a verdict.
      }
    }
    return current().where((e) => !e.isUploaded).toList();
  }

  /// Deletes a photo from the phone and, if it reached the server, discards
  /// it there too so an unused retake does not linger in the bucket.
  Future<void> discard(String taskId, String evidenceId) async {
    final ev = _evidence.find(taskId, evidenceId);
    if (ev == null) return;
    final reachedServer = ev.uploadStatus != EvidenceUploadStatus.local;
    if (!AppConfig.demoMode && reachedServer && ev.uploadStatus != EvidenceUploadStatus.attached) {
      try {
        await _media.discard(ev.mediaId);
      } catch (_) {
        // Best effort: unattached files on a closed work order are swept
        // server-side, and the local copy is what the user asked to remove.
      }
    }
    _evidence.removeEvidence(taskId, evidenceId);
  }

  bool _needsUpload(TaskEvidence e) =>
      !e.isSubmitted &&
      e.checklistItemId != null &&
      e.checklistItemId!.isNotEmpty &&
      (e.uploadStatus == EvidenceUploadStatus.local ||
          e.uploadStatus == EvidenceUploadStatus.failed ||
          e.uploadStatus == EvidenceUploadStatus.rejected);

  void _applyServerStatus(String taskId, String evidenceId, String status, {String? rejectReason}) {
    switch (status) {
      case 'READY':
        _setStatus(taskId, evidenceId, EvidenceUploadStatus.ready);
      case 'ATTACHED':
        _setStatus(taskId, evidenceId, EvidenceUploadStatus.attached);
      case 'VERIFYING':
        _setStatus(taskId, evidenceId, EvidenceUploadStatus.verifying);
      case 'REJECTED':
        _setStatus(taskId, evidenceId, EvidenceUploadStatus.rejected,
            error: 'Server rejected the photo${rejectReason != null ? ' ($rejectReason)' : ''}. Retry to send it again.');
      default:
        // PENDING after complete, DISCARDED, or UNKNOWN: send it again.
        _setStatus(taskId, evidenceId, EvidenceUploadStatus.failed,
            error: 'Upload did not finish (status $status). Retry to send it again.');
    }
  }

  void _setStatus(String taskId, String evidenceId, String status, {String? error}) {
    _evidence.updateEvidence(
      taskId,
      evidenceId,
      (e) => e.copyWith(uploadStatus: status, uploadError: error, clearUploadError: error == null),
    );
  }
}
