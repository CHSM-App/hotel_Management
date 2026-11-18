import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
// Not redundant: importing the plugin package is what makes it the default
// factory on Android and iOS; sqflite_ffi alone leaves none set there.
// ignore: unnecessary_import
import 'package:sqflite/sqflite.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// The device's local SQLite file: the HTTP cache and the outbox of writes
/// waiting to reach the server (see the offline plan).
///
/// sqflite ships its own plugin on Android and iOS; Windows and Linux have no
/// such plugin, so there it runs on sqflite_common_ffi. [init] picks the
/// factory once at boot. It never touches business tables — those live on the
/// server — only what the device must remember while it cannot reach it.
class AppDatabase {
  AppDatabase._();

  static const _version = 2;
  static Database? _db;

  /// Tests point this at a temp file, since path_provider has no plugin there.
  static String? pathOverride;

  /// Call once from main() before the first read. Safe to call twice.
  static void init() {
    if (Platform.isWindows || Platform.isLinux) {
      sqfliteFfiInit();
      databaseFactory = databaseFactoryFfi;
    }
  }

  static Future<Database> get database async => _db ??= await _open();

  static Future<Database> _open() async {
    if (pathOverride != null) return _create(pathOverride!);
    // Application support, not the Documents folder: this is an app's private
    // state, not a file the user should see, move, or open in another program
    // while the app has it locked.
    final dir = Platform.isAndroid || Platform.isIOS
        ? await getDatabasesPath()
        : (await getApplicationSupportDirectory()).path;
    await Directory(dir).create(recursive: true);
    return _create(p.join(dir, 'front_desk_offline.db'));
  }

  static Future<Database> _create(String path) {
    return openDatabase(
      path,
      version: _version,
      onCreate: (db, _) async {
        await _createV1(db);
        await _createV2(db);
      },
      onUpgrade: (db, from, to) async {
        if (from < 2) {
          await db.execute('ALTER TABLE outbox ADD COLUMN meta TEXT');
          await _createV2(db);
        }
      },
    );
  }

  static Future<void> _createV1(Database db) async {
    // One row per distinct GET the desk has seen, scoped to the lodge and
    // user so a shared device never serves one account another's data.
    await db.execute('''
      CREATE TABLE http_cache (
        scope      TEXT NOT NULL,
        url        TEXT NOT NULL,
        body       TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (scope, url)
      )
    ''');
    // Writes made while offline, replayed in id order. client_uuid is the
    // Idempotency-Key, so a retry after a lost response cannot duplicate.
    await db.execute('''
      CREATE TABLE outbox (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        scope       TEXT NOT NULL,
        client_uuid TEXT NOT NULL UNIQUE,
        feature     TEXT NOT NULL,
        method      TEXT NOT NULL,
        path        TEXT NOT NULL,
        body        TEXT,
        files       TEXT,
        depends_on  TEXT,
        status      TEXT NOT NULL DEFAULT 'pending',
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error  TEXT,
        created_at  TEXT NOT NULL,
        meta        TEXT
      )
    ''');
    await db.execute('CREATE INDEX outbox_status ON outbox (scope, status)');
  }

  static Future<void> _createV2(Database db) async {
    // What the device downloaded to keep running offline: rooms, rates,
    // seasons, GST slabs, the room chart (see GET /sync/bootstrap).
    await db.execute('''
      CREATE TABLE IF NOT EXISTS ref_store (
        scope      TEXT NOT NULL,
        key        TEXT NOT NULL,
        body       TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (scope, key)
      )
    ''');
    // A stay as this device now believes it to be: one that was created here
    // and has not reached the server yet (negative id), or one the server
    // knows whose latest changes (check-in, check-out) are still waiting to be
    // sent. Server-shaped JSON, so the same Booking model reads it.
    await db.execute('''
      CREATE TABLE IF NOT EXISTS local_stays (
        scope      TEXT NOT NULL,
        id         INTEGER NOT NULL,
        body       TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope, id)
      )
    ''');
    // Which server id a booking made here finally got.
    await db.execute('''
      CREATE TABLE IF NOT EXISTS id_map (
        scope     TEXT NOT NULL,
        local_id  INTEGER NOT NULL,
        server_id INTEGER NOT NULL,
        PRIMARY KEY (scope, local_id)
      )
    ''');
    await db.execute(
      'CREATE TABLE IF NOT EXISTS local_seq (name TEXT PRIMARY KEY, n INTEGER NOT NULL)',
    );
  }

  /// Wipes everything on logout or when the lodge changes. The outbox is
  /// cleared only by the caller that has already checked it is empty — see the
  /// plan: logout is blocked while writes are still waiting.
  static Future<void> clearCache() async {
    final db = await database;
    await db.delete('http_cache');
  }
}
