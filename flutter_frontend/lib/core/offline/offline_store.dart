import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:dio/dio.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart' show ConflictAlgorithm;

import '../../data/db/app_database.dart';

/// Everything the device keeps for working with no network — the queue of
/// actions waiting to reach the server, the stays it has changed itself, and
/// the rates it downloaded to price them. One small class over the local
/// SQLite file (see AppDatabase); every row is scoped to the lodge, so a
/// shared device never mixes two properties.

String newUuid() {
  final r = Random.secure();
  String hex(int n) => List.generate(n, (_) => r.nextInt(16).toRadixString(16)).join();
  return '${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + r.nextInt(4)).toRadixString(16)}${hex(3)}-${hex(12)}';
}

/// An ID-proof photo has to survive an app restart, so a queued request keeps
/// its files on disk rather than in memory. Tests point this elsewhere.
class OutboxFiles {
  static String? rootOverride;
  static Future<String> root() async =>
      rootOverride ?? p.join((await getApplicationSupportDirectory()).path, 'outbox_files');
}

/// A multipart request taken apart so it can be written to SQLite and put back
/// together later — the booking screens build a `FormData` with
/// `MultipartFile.fromFileSync`, which cannot be stored as it is.
class FormSnapshot {
  final List<List<String>> fields;
  final List<Map<String, String>> files;

  const FormSnapshot(this.fields, this.files);

  static Future<FormSnapshot> capture(FormData form, String uuid) async {
    final dir = Directory(p.join(await OutboxFiles.root(), uuid));
    final files = <Map<String, String>>[];
    var i = 0;
    for (final entry in form.files) {
      await dir.create(recursive: true);
      final file = entry.value;
      final bytes = <int>[];
      await for (final chunk in file.finalize()) {
        bytes.addAll(chunk);
      }
      final name = '${i++}_${(file.filename ?? 'file').replaceAll(RegExp(r'[^\w.\-]'), '_')}';
      final path = p.join(dir.path, name);
      await File(path).writeAsBytes(bytes);
      files.add({
        'field': entry.key,
        'filename': file.filename ?? name,
        'contentType': file.contentType?.toString() ?? '',
        'path': path,
      });
    }
    return FormSnapshot([
      for (final f in form.fields) [f.key, f.value],
    ], files);
  }

  Future<FormData> rebuild() async {
    final form = FormData();
    for (final f in fields) {
      form.fields.add(MapEntry(f[0], f[1]));
    }
    for (final f in files) {
      form.files.add(
        MapEntry(
          f['field']!,
          MultipartFile.fromBytes(
            await File(f['path']!).readAsBytes(),
            filename: f['filename'],
            contentType: (f['contentType'] ?? '').isEmpty ? null : DioMediaType.parse(f['contentType']!),
          ),
        ),
      );
    }
    return form;
  }

  String? field(String name) {
    for (final f in fields) {
      if (f[0] == name) return f[1];
    }
    return null;
  }

  Map<String, dynamic> toJson() => {'fields': fields, 'files': files};

  factory FormSnapshot.fromJson(Map<String, dynamic> j) => FormSnapshot(
    [
      for (final f in j['fields'] as List) [for (final x in f as List) x.toString()],
    ],
    [
      for (final f in j['files'] as List) {for (final e in (f as Map).entries) '${e.key}': '${e.value}'},
    ],
  );

  Future<void> deleteFiles() async {
    for (final f in files) {
      try {
        await File(f['path']!).delete();
      } catch (_) {}
    }
  }
}

class OutboxOp {
  final int id;
  final String clientUuid;

  /// booking.create, booking.checkin, booking.settle
  final String feature;
  final String method;

  /// May carry `{id}`, replaced at send time with the server id of the stay in
  /// [meta]['bookingRef'] — a booking made offline has none until its create
  /// has been accepted.
  final String path;
  final Map<String, dynamic>? json;
  final FormSnapshot? form;
  final String status;
  final int retryCount;
  final String? lastError;
  final String createdAt;
  final Map<String, dynamic> meta;

  const OutboxOp({
    required this.id,
    required this.clientUuid,
    required this.feature,
    required this.method,
    required this.path,
    required this.status,
    required this.retryCount,
    required this.createdAt,
    this.json,
    this.form,
    this.lastError,
    this.meta = const {},
  });

  int? get bookingRef => meta['bookingRef'] is int ? meta['bookingRef'] as int : int.tryParse('${meta['bookingRef']}');

  /// What the Sync center calls it.
  String get title => switch (feature) {
    'booking.create' => 'New booking${meta['guestName'] != null ? ' · ${meta['guestName']}' : ''}',
    'booking.checkin' => 'Check-in${meta['guestName'] != null ? ' · ${meta['guestName']}' : ''}',
    'booking.settle' => 'Check-out & bill${meta['guestName'] != null ? ' · ${meta['guestName']}' : ''}',
    _ => feature,
  };
}

class OfflineStore {
  final String Function() scope;
  OfflineStore(this.scope);

  // ── Reference data ───────────────────────────────────────────────────────

  Future<Map<String, dynamic>?> refGet(String key) async {
    final db = await AppDatabase.database;
    final rows = await db.query('ref_store', where: 'scope = ? AND key = ?', whereArgs: [scope(), key], limit: 1);
    if (rows.isEmpty) return null;
    return jsonDecode(rows.first['body'] as String) as Map<String, dynamic>;
  }

  Future<void> refPut(String key, Map<String, dynamic> body) async {
    final db = await AppDatabase.database;
    await db.insert('ref_store', {
      'scope': scope(),
      'key': key,
      'body': jsonEncode(body),
      'fetched_at': DateTime.now().toIso8601String(),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  /// What the HTTP cache last saw for a GET — the raw JSON, for the engine to
  /// work from (a booking's nights and food, the lodge's own details).
  Future<dynamic> cachedGet(String url) async {
    final db = await AppDatabase.database;
    final rows = await db.query('http_cache', where: 'scope = ? AND url = ?', whereArgs: [scope(), url], limit: 1);
    if (rows.isEmpty) return null;
    return jsonDecode(rows.first['body'] as String);
  }

  // ── Stays changed on this device ─────────────────────────────────────────

  Future<Map<String, dynamic>?> stayGet(int id) async {
    final db = await AppDatabase.database;
    final rows = await db.query('local_stays', where: 'scope = ? AND id = ?', whereArgs: [scope(), id], limit: 1);
    if (rows.isEmpty) return null;
    return jsonDecode(rows.first['body'] as String) as Map<String, dynamic>;
  }

  Future<void> stayPut(int id, Map<String, dynamic> body) async {
    final db = await AppDatabase.database;
    await db.insert('local_stays', {
      'scope': scope(),
      'id': id,
      'body': jsonEncode(body),
      'updated_at': DateTime.now().toIso8601String(),
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<void> stayDelete(int id) async {
    final db = await AppDatabase.database;
    await db.delete('local_stays', where: 'scope = ? AND id = ?', whereArgs: [scope(), id]);
  }

  Future<List<Map<String, dynamic>>> staysAll() async {
    final db = await AppDatabase.database;
    final rows = await db.query('local_stays', where: 'scope = ?', whereArgs: [scope()]);
    return [for (final r in rows) jsonDecode(r['body'] as String) as Map<String, dynamic>];
  }

  // ── Ids ──────────────────────────────────────────────────────────────────

  Future<int?> serverIdFor(int localId) async {
    final db = await AppDatabase.database;
    final rows = await db.query('id_map', where: 'scope = ? AND local_id = ?', whereArgs: [scope(), localId], limit: 1);
    return rows.isEmpty ? null : rows.first['server_id'] as int;
  }

  Future<void> mapId(int localId, int serverId) async {
    final db = await AppDatabase.database;
    await db.insert('id_map', {'scope': scope(), 'local_id': localId, 'server_id': serverId},
        conflictAlgorithm: ConflictAlgorithm.replace);
  }

  Future<int> nextSeq(String name) async {
    final db = await AppDatabase.database;
    return db.transaction((txn) async {
      final rows = await txn.query('local_seq', where: 'name = ?', whereArgs: [name]);
      final n = (rows.isEmpty ? 0 : rows.first['n'] as int) + 1;
      await txn.insert('local_seq', {'name': name, 'n': n}, conflictAlgorithm: ConflictAlgorithm.replace);
      return n;
    });
  }

  // ── Outbox ───────────────────────────────────────────────────────────────

  Future<OutboxOp> enqueue({
    required String feature,
    required String method,
    required String path,
    Map<String, dynamic>? json,
    FormData? form,
    FormSnapshot? snapshot,
    String? clientUuid,
    Map<String, dynamic> meta = const {},
  }) async {
    final uuid = clientUuid ?? newUuid();
    snapshot ??= form == null ? null : await FormSnapshot.capture(form, uuid);
    final db = await AppDatabase.database;
    final now = DateTime.now().toIso8601String();
    final id = await db.insert('outbox', {
      'scope': scope(),
      'client_uuid': uuid,
      'feature': feature,
      'method': method,
      'path': path,
      'body': json == null ? null : jsonEncode(json),
      'files': snapshot == null ? null : jsonEncode(snapshot.toJson()),
      'status': 'pending',
      'retry_count': 0,
      'created_at': now,
      'meta': jsonEncode(meta),
    });
    return OutboxOp(
      id: id,
      clientUuid: uuid,
      feature: feature,
      method: method,
      path: path,
      json: json,
      form: snapshot,
      status: 'pending',
      retryCount: 0,
      createdAt: now,
      meta: meta,
    );
  }

  OutboxOp _op(Map<String, Object?> r) => OutboxOp(
    id: r['id'] as int,
    clientUuid: r['client_uuid'] as String,
    feature: r['feature'] as String,
    method: r['method'] as String,
    path: r['path'] as String,
    json: r['body'] == null ? null : jsonDecode(r['body'] as String) as Map<String, dynamic>,
    form: r['files'] == null ? null : FormSnapshot.fromJson(jsonDecode(r['files'] as String) as Map<String, dynamic>),
    status: r['status'] as String,
    retryCount: r['retry_count'] as int,
    lastError: r['last_error'] as String?,
    createdAt: r['created_at'] as String,
    meta: r['meta'] == null ? const {} : jsonDecode(r['meta'] as String) as Map<String, dynamic>,
  );

  Future<List<OutboxOp>> ops({List<String>? statuses}) async {
    final db = await AppDatabase.database;
    final rows = statuses == null
        ? await db.query('outbox', where: 'scope = ?', whereArgs: [scope()], orderBy: 'id ASC')
        : await db.query(
            'outbox',
            where: 'scope = ? AND status IN (${List.filled(statuses.length, '?').join(',')})',
            whereArgs: [scope(), ...statuses],
            orderBy: 'id ASC',
          );
    return rows.map(_op).toList();
  }

  Future<void> setStatus(int id, String status, {String? error, bool retry = false}) async {
    final db = await AppDatabase.database;
    await db.rawUpdate(
      'UPDATE outbox SET status = ?, last_error = ?, retry_count = retry_count + ? WHERE id = ?',
      [status, error, retry ? 1 : 0, id],
    );
  }

  Future<void> remove(OutboxOp op) async {
    final db = await AppDatabase.database;
    await db.delete('outbox', where: 'id = ?', whereArgs: [op.id]);
    await op.form?.deleteFiles();
  }

  /// Whether anything is still waiting for this stay — decides when the local
  /// copy can be dropped and the server's own taken as the truth again.
  Future<bool> hasOpenOps(int bookingRef) async {
    final open = await ops(statuses: ['pending', 'syncing', 'conflict', 'failed', 'blocked']);
    return open.any((o) => o.bookingRef == bookingRef);
  }
}
