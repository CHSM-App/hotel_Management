/// One entry of a booking's edit log: who, from which device, what moved.
class BookingEdit {
  final DateTime? at;
  final String? userName;
  final String? role;
  final String? device;
  final String? ip;
  final bool isCancel;
  final List<EditChange> changes;

  const BookingEdit({
    this.at,
    this.userName,
    this.role,
    this.device,
    this.ip,
    this.isCancel = false,
    this.changes = const [],
  });

  factory BookingEdit.fromJson(Map<String, dynamic> j) => BookingEdit(
    at: DateTime.tryParse('${j['at'] ?? ''}')?.toLocal(),
    userName: j['userName'] as String?,
    role: j['role'] as String?,
    device: (j['device'] ?? j['deviceId']) as String?,
    ip: j['ip'] as String?,
    isCancel: j['kind'] == 'CANCEL',
    changes: [
      for (final c in (j['changes'] as List? ?? const []))
        EditChange.fromJson(c as Map<String, dynamic>),
    ],
  );
}

class EditChange {
  final String field;
  final String? from;
  final String? to;

  const EditChange(this.field, this.from, this.to);

  factory EditChange.fromJson(Map<String, dynamic> j) => EditChange(
    '${j['field']}',
    j['from']?.toString(),
    j['to']?.toString(),
  );
}
