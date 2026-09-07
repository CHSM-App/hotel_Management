import 'dart:io';
import 'dart:typed_data';

import 'package:path_provider/path_provider.dart';

/// Save straight to a real file — the public Downloads folder where a
/// desktop build can reach it, the app's own documents directory on a phone,
/// where nothing may write to the shared one without a picker this button
/// never asked for.
///
/// Returns the path it landed at.
Future<String> saveBytesToDevice(Uint8List bytes, String filename) async {
  final dir =
      await getDownloadsDirectory() ?? await getApplicationDocumentsDirectory();
  final file = File('${dir.path}/$filename');
  await file.writeAsBytes(bytes, flush: true);
  return file.path;
}
