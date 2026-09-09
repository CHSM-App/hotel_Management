import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:printing/printing.dart';

import '../theme.dart';
import '../../widgets/neu.dart';

/// The guest's uploaded ID proof — a photo or a scanned PDF, whichever they
/// handed over. Fetched on open rather than passed in: the document sits
/// behind its own authenticated route, not on the booking payload itself.
class IdProofViewerScreen extends StatefulWidget {
  final String title;
  final Future<(Uint8List bytes, String? contentType)> Function() load;

  const IdProofViewerScreen({
    super.key,
    required this.title,
    required this.load,
  });

  @override
  State<IdProofViewerScreen> createState() => _IdProofViewerScreenState();
}

class _IdProofViewerScreenState extends State<IdProofViewerScreen> {
  Uint8List? _bytes;
  String? _contentType;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final (bytes, contentType) = await widget.load();
      if (!mounted) return;
      setState(() {
        _bytes = bytes;
        _contentType = contentType;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Could not open the ID proof.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(widget.title),
      ),
      body: SafeArea(
        child: _loading
            ? const Center(
                child: CircularProgressIndicator(color: Colors.white),
              )
            : _error != null
            ? Center(
                child: Padding(
                  padding: const EdgeInsets.all(AppTheme.s16),
                  child: NeuNotice(
                    icon: Icons.cloud_off_rounded,
                    message: _error!,
                    action: NeuButton(
                      onPressed: _load,
                      child: const Text('Try again'),
                    ),
                  ),
                ),
              )
            : (_contentType ?? '').contains('pdf')
            ? PdfPreview(
                build: (format) async => _bytes!,
                canChangePageFormat: false,
                canChangeOrientation: false,
                canDebug: false,
              )
            : InteractiveViewer(
                minScale: 1,
                maxScale: 4,
                child: Center(child: Image.memory(_bytes!)),
              ),
      ),
    );
  }
}
