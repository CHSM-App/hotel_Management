library;

import 'dart:async';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:audioplayers/audioplayers.dart';

/// The exact same two-tone chime OrdersPanel.jsx's `playChime` synthesises
/// with Web Audio (two sine tones, 880Hz then 1320Hz, each with a quick
/// exponential swell and decay) — rebuilt here as raw PCM samples since
/// Flutter has no Web-Audio-style oscillator API to call into directly.
/// Generated once and cached: the bytes never change, so there is no reason
/// to resynthesise them on every order.
class NewOrderChime {
  NewOrderChime._();

  static const _sampleRate = 44100;
  static const _frequencies = [880.0, 1320.0];
  static const _toneStep = 0.18; // seconds between each tone's start
  static const _toneLength = 0.4; // seconds each tone plays for
  static const _attack = 0.02; // seconds to swell up to peak gain
  static const _decayEnd = 0.35; // seconds (from tone start) to fade to near-silent
  static const _peakGain = 0.35;
  static const _floorGain = 0.0001;

  static Uint8List? _wavBytes;

  /// Exponential ramp from [a] to [b] over the fraction [t] (0..1) through
  /// the segment — the same curve Web Audio's exponentialRampToValueAtTime
  /// draws between two automation points.
  static double _expRamp(double a, double b, double t) => a * math.pow(b / a, t);

  static double _gainAt(double tSinceStart) {
    if (tSinceStart <= _attack) {
      return _expRamp(_floorGain, _peakGain, tSinceStart / _attack);
    }
    if (tSinceStart <= _decayEnd) {
      return _expRamp(_peakGain, _floorGain, (tSinceStart - _attack) / (_decayEnd - _attack));
    }
    return _floorGain;
  }

  static Uint8List _synthesize() {
    final totalSeconds = (_frequencies.length - 1) * _toneStep + _toneLength;
    final sampleCount = (totalSeconds * _sampleRate).ceil();
    final samples = Int16List(sampleCount);

    for (var i = 0; i < _frequencies.length; i++) {
      final start = i * _toneStep;
      final startSample = (start * _sampleRate).round();
      final toneSamples = (_toneLength * _sampleRate).round();
      final frequency = _frequencies[i];
      for (var s = 0; s < toneSamples; s++) {
        final sampleIndex = startSample + s;
        if (sampleIndex >= sampleCount) break;
        final t = s / _sampleRate;
        final gain = _gainAt(t);
        final value = gain * math.sin(2 * math.pi * frequency * t);
        final existing = samples[sampleIndex];
        final mixed = (existing + value * 32767).clamp(-32768, 32767);
        samples[sampleIndex] = mixed.round();
      }
    }

    return _wrapWav(samples);
  }

  /// A minimal mono 16-bit PCM WAV container around [samples] — the smallest
  /// format every audioplayers backend decodes without surprises.
  static Uint8List _wrapWav(Int16List samples) {
    const bitsPerSample = 16;
    const channels = 1;
    final byteRate = _sampleRate * channels * bitsPerSample ~/ 8;
    final blockAlign = channels * bitsPerSample ~/ 8;
    final dataSize = samples.lengthInBytes;
    final fileSize = 36 + dataSize;

    final header = ByteData(44);
    void writeString(int offset, String s) {
      for (var i = 0; i < s.length; i++) {
        header.setUint8(offset + i, s.codeUnitAt(i));
      }
    }

    writeString(0, 'RIFF');
    header.setUint32(4, fileSize, Endian.little);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    header.setUint32(16, 16, Endian.little); // fmt chunk size
    header.setUint16(20, 1, Endian.little); // PCM
    header.setUint16(22, channels, Endian.little);
    header.setUint32(24, _sampleRate, Endian.little);
    header.setUint32(28, byteRate, Endian.little);
    header.setUint16(32, blockAlign, Endian.little);
    header.setUint16(34, bitsPerSample, Endian.little);
    writeString(36, 'data');
    header.setUint32(40, dataSize, Endian.little);

    final bytes = BytesBuilder();
    bytes.add(header.buffer.asUint8List());
    bytes.add(samples.buffer.asUint8List());
    return bytes.toBytes();
  }

  /// Plays the chime. Safe to call repeatedly in quick succession — each
  /// call gets its own short-lived player so an order arriving mid-chime
  /// doesn't get swallowed.
  static Future<void> play() async {
    _wavBytes ??= _synthesize();
    final player = AudioPlayer(playerId: 'new_order_chime_${DateTime.now().microsecondsSinceEpoch}');
    player.onPlayerComplete.first.then((_) => player.dispose());
    try {
      await player.play(BytesSource(_wavBytes!, mimeType: 'audio/wav'));
    } catch (_) {
      // A device with no audio output (or a platform that can't decode a
      // bytes source) must not crash the order poll over a missed chime.
      unawaited(player.dispose());
    }
  }
}
