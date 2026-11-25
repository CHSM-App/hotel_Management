import 'dart:io';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
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

  Future<void> _download() async {
    final ext = (_contentType ?? '').contains('pdf')
        ? 'pdf'
        : (_contentType ?? '').contains('png')
        ? 'png'
        : (_contentType ?? '').contains('webp')
        ? 'webp'
        : 'jpg';
    final messenger = ScaffoldMessenger.of(context);
    try {
      final path = await FilePicker.saveFile(
        dialogTitle: 'Save ID proof',
        fileName: 'id-proof.$ext',
        bytes: _bytes,
      );
      if (path == null) return;
      // Desktop dialogs only return the chosen path; the bytes are ours to write.
      if (Platform.isWindows || Platform.isMacOS || Platform.isLinux) {
        await File(path).writeAsBytes(_bytes!);
      }
      messenger.showSnackBar(const SnackBar(content: Text('ID proof saved')));
    } catch (_) {
      messenger.showSnackBar(const SnackBar(content: Text('Could not save the ID proof.')));
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
        actions: [
          if (_bytes != null)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: FilledButton.icon(
                style: FilledButton.styleFrom(
                  backgroundColor: Colors.white,
                  foregroundColor: Colors.black,
                ),
                icon: const Icon(Icons.download_rounded, size: 20),
                label: const Text('Download'),
                onPressed: _download,
              ),
            ),
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: FilledButton.icon(
              style: FilledButton.styleFrom(
                backgroundColor: AppTheme.danger,
                foregroundColor: Colors.white,
              ),
              icon: const Icon(Icons.close_rounded, size: 20),
              label: const Text('Close'),
              onPressed: () => Navigator.of(context).maybePop(),
            ),
          ),
        ],
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
