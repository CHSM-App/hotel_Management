import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:dio/dio.dart';
import 'package:flutter/painting.dart' show FilterQuality;

import '../../domain/models/printer_config.dart';
import '../../domain/models/receipt_doc.dart';
import '../constant.dart';

/// Fetches the property's logo and turns it into what a thermal receipt can
/// print: shrunk to a modest size and reduced to plain black and white.
class ReceiptLogoLoader {
  ReceiptLogoLoader._();

  static final _cache = <String, ReceiptLogo>{};

  /// Why the last [load] returned nothing, for telling the desk.
  static String? lastError;

  /// Wide enough to read, narrow enough to leave the receipt looking like a
  /// receipt, and short enough to be a small amount of data to send.
  static int maxWidth(ThermalPaper paper) => paper.dots ~/ 2;
  static const maxHeight = 120;

  /// Null when there is no logo or it cannot be fetched or read — a missing
  /// logo must never stop a bill printing.
  static Future<ReceiptLogo?> load(String? url, ThermalPaper paper) async {
    lastError = null;
    if (url == null || url.trim().isEmpty) return null;
    final key = '$url@${paper.dots}';
    final hit = _cache[key];
    if (hit != null) return hit;
    try {
      final res = await Dio().get<List<int>>(
        '$baseUrl$url',
        options: Options(responseType: ResponseType.bytes, receiveTimeout: const Duration(seconds: 8)),
      );
      final data = res.data;
      if (data == null || data.isEmpty) {
        lastError = 'the logo file is empty';
        return null;
      }
      final bytes = Uint8List.fromList(data);
      // SVG is allowed at upload but cannot be turned into dots here.
      final head = String.fromCharCodes(bytes.take(256)).toLowerCase();
      if (head.contains('<svg') || head.startsWith('<?xml')) {
        lastError = 'SVG logos cannot be printed, upload a PNG or JPG';
        return null;
      }
      final logo = await fromBytes(bytes, maxWidth: maxWidth(paper));
      if (logo == null) {
        lastError = 'the logo could not be read';
      } else {
        _cache[key] = logo;
      }
      return logo;
    } on DioException catch (e) {
      lastError = 'it could not be downloaded (${e.response?.statusCode ?? 'no connection'})';
      return null;
    } catch (_) {
      lastError = 'the logo could not be read';
      return null;
    }
  }

  /// Decode, fit inside [maxWidth] x [maxHeight] keeping the proportions, put
  /// it on white (a transparent logo would otherwise print as a black block),
  /// and threshold to black/white at 128.
  static Future<ReceiptLogo?> fromBytes(Uint8List bytes, {required int maxWidth}) async {
    final codec = await ui.instantiateImageCodec(bytes);
    final frame = await codec.getNextFrame();
    final src = frame.image;
    final scale = math.min(1.0, math.min(maxWidth / src.width, maxHeight / src.height));
    final w = math.max(1, (src.width * scale).round());
    final h = math.max(1, (src.height * scale).round());

    final rec = ui.PictureRecorder();
    final canvas = ui.Canvas(rec)..drawColor(const ui.Color(0xFFFFFFFF), ui.BlendMode.src);
    canvas.drawImageRect(
      src,
      ui.Rect.fromLTWH(0, 0, src.width.toDouble(), src.height.toDouble()),
      ui.Rect.fromLTWH(0, 0, w.toDouble(), h.toDouble()),
      ui.Paint()..filterQuality = FilterQuality.high,
    );
    final out = await rec.endRecording().toImage(w, h);
    final bd = await out.toByteData(format: ui.ImageByteFormat.rawRgba);
    src.dispose();
    out.dispose();
    if (bd == null) return null;

    final rgba = bd.buffer.asUint8List();
    final bw = Uint8List(rgba.length);
    for (var i = 0; i < rgba.length; i += 4) {
      final luma = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) ~/ 1000;
      final v = luma < 128 ? 0 : 255;
      bw[i] = bw[i + 1] = bw[i + 2] = v;
      bw[i + 3] = 255;
    }
    return ReceiptLogo(w, h, bw);
  }
}
