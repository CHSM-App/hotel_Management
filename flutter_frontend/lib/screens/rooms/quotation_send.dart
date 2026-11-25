import 'dart:typed_data';

import 'package:dio/dio.dart' show DioException;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/dio_provider.dart';
import '../../domain/models/saved_quotation.dart';
import '../../presentation/providers/view_model_provider.dart';
import '../../presentation/view_models/rooms_viewmodel.dart';
import 'quotation_doc_pdf.dart';
import 'quotation_pdf.dart';
import 'quotation_whatsapp.dart';

/// The quotation's PDF as bytes — the room letter for a room quotation (which
/// needs the live rooms for its facts), the generic letter otherwise. Null,
/// after [say]-ing why, when a room has since been removed.
Future<Uint8List?> quotationPdfBytes(WidgetRef ref, SavedQuotation q, void Function(String) say) async {
  final me = ref.read(authViewModelProvider).me;
  if (!q.isRoom) return QuotationDocPdf.build(q, lodge: me?.lodge, preparedBy: me?.user.name);
  final rooms = ref.read(roomsViewModelProvider).rooms;
  final quoted = <QuotedRoom>[];
  for (final r in q.rooms) {
    final room = rooms.where((x) => x.id == r.roomId).firstOrNull;
    if (room == null) {
      say('Room ${r.roomNumber} is no longer available, so this quotation cannot be re-issued.');
      return null;
    }
    quoted.add(QuotedRoom(room: room, fromDate: r.fromDate, toDate: r.toDate, result: r.result));
  }
  final phone = q.guestPhone ?? '';
  return QuotationPdf.build(
    quoted,
    total: q.total,
    lodge: me?.lodge,
    guestName: q.guestName,
    guestPhone: phone.length == 10 ? '+91 ${phone.substring(0, 5)} ${phone.substring(5)}' : phone,
    preparedBy: me?.user.name,
  );
}

/// Sends a saved quotation to the guest on WhatsApp. With the property's
/// approved template set up (WHATSAPP_QUOTATION_TEMPLATE_ID) and a guest
/// number, the server sends it itself, PDF link included. Otherwise it opens a
/// WhatsApp chat with the message typed in (and the link, when one could be
/// made). Used by the detail sheet and by "Save & send" on the new-quotation
/// forms. Failures are reported through [say]; nothing throws.
Future<void> sendSavedQuotation(WidgetRef ref, SavedQuotation q, void Function(String) say) async {
  final me = ref.read(authViewModelProvider).me;
  final api = ref.read(apiServiceProvider);
  String? link;
  final bytes = await quotationPdfBytes(ref, q, say);
  if (bytes == null) return;
  final filename = '${q.referenceCode}.pdf';
  if ((q.guestPhone ?? '').isNotEmpty) {
    try {
      final to = await api.sendQuotationWhatsApp(q.id, bytes, filename);
      say('Quotation sent on WhatsApp to +$to.');
      return;
    } on DioException catch (e) {
      // 503: the template is not set up — fall through to the chat link.
      if (e.response?.statusCode != 503) {
        say(RoomsViewModel.messageFor(e));
        return;
      }
    } catch (e) {
      say(RoomsViewModel.messageFor(e));
      return;
    }
  }
  try {
    link = await api.shareQuotationLink(q.id, bytes, filename);
  } catch (_) {
    say('Could not create the quotation link. Sending the message without it.');
  }
  final ok = await openQuotationOnWhatsApp(q, hotel: me?.lodge.name ?? '', hotelPhone: me?.lodge.phone, link: link);
  if (!ok) say('Could not open WhatsApp.');
}
