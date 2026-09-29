import 'dart:io';

import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';

const _downloadsChannel = MethodChannel('hotel_manager/downloads');

/// Save straight to a real, user-visible file — the same silent, no-dialog
/// download a production app gives you.
///
/// Android has no shared Downloads folder plain dart:io may write into under
/// scoped storage, so this hands the bytes to a small native call
/// ([MainActivity]'s "saveToDownloads") that inserts them into
/// `MediaStore.Downloads` instead — the same public Downloads folder Chrome
/// downloads into, with no storage permission needed on Android 10+. iOS has
/// no equivalent shared folder, but the app's own documents directory shows
/// up under Files > On My iPhone > `<app name>` once file sharing is enabled
/// in Info.plist, so that's where it lands there. Desktop keeps writing
/// straight into the OS's real Downloads folder.
///
/// Returns the path (a content URI on Android) it landed at.
Future<String> saveBytesToDevice(Uint8List bytes, String filename) async {
  if (Platform.isAndroid) {
    final path = await _downloadsChannel.invokeMethod<String>('saveToDownloads', {
      'fileName': filename,
      'mimeType': mimeTypeForFilename(filename),
      'bytes': bytes,
    });
    if (path == null || path.isEmpty) throw Exception('Could not save the file.');
    return path;
  }

  final dir = Platform.isIOS
      ? await getApplicationDocumentsDirectory()
      : await getDownloadsDirectory() ?? await getApplicationDocumentsDirectory();
  final file = File('${dir.path}/$filename');
  await file.writeAsBytes(bytes, flush: true);
  return file.path;
}

/// Whether [openSavedFile] can actually do anything on this platform — only
/// Android gets the Snackbar's "Open" action; iOS has no system-wide "open
/// with" for an arbitrary local file, and desktop already dropped the file
/// into the real, visibly-browsable Downloads folder.
bool get canOpenSavedFile => Platform.isAndroid;

/// Opens a file [saveBytesToDevice] already saved, in whatever app the
/// system offers for its type — the tap-through behind the Snackbar's "Open"
/// action, the same as tapping a finished download in Chrome.
Future<void> openSavedFile(String path, String filename) async {
  if (!Platform.isAndroid) return;
  await _downloadsChannel.invokeMethod('openFile', {
    'uri': path,
    'mimeType': mimeTypeForFilename(filename),
  });
}

String mimeTypeForFilename(String filename) {
  final ext = filename.contains('.') ? filename.split('.').last.toLowerCase() : '';
  return switch (ext) {
    'pdf' => 'application/pdf',
    'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    _ => 'application/octet-stream',
  };
}
