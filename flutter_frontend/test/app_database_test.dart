import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hotel_manager/data/db/app_database.dart';

void main() {
  test('opens, creates both tables, and clearCache spares the outbox', () async {
    final dir = Directory.systemTemp.createTempSync('fd_db');
    AppDatabase.pathOverride = '${dir.path}/t.db';
    AppDatabase.init();

    final db = await AppDatabase.database;
    await db.insert('http_cache',
        {'scope': 's', 'url': '/rooms', 'body': '[]', 'fetched_at': 'now'});
    await db.insert('outbox', {
      'scope': 's', 'client_uuid': 'u1', 'feature': 'expense',
      'method': 'POST', 'path': '/expenses', 'created_at': 'now',
    });

    await AppDatabase.clearCache();

    expect(await db.query('http_cache'), isEmpty);
    expect((await db.query('outbox')).single['status'], 'pending');
    await db.close();
  });
}
