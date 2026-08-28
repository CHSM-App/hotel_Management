# Flutter App Architecture Blueprint

> Reverse-engineered from the **RetailPulse / order_booking_app** Flutter project.
> Use this as a template to bootstrap new projects with the identical folder structure,
> layering, networking stack, state management and code style.

---

## 1. Architecture at a Glance

The app is **Clean Architecture + MVVM**, wired together with **Riverpod** providers,
**Retrofit-over-Dio** for networking, and **sqflite** as an offline mirror/outbox.

```
UI (screens/, widgets/)
        │  ref.watch(xViewModelProvider)  /  ref.read(...notifier).method()
        ▼
ViewModel (StateNotifier<XState>)          ← presentation/viewModels/
        │  usecase.method()
        ▼
UseCase (plain Dart class)                 ← domain/usecase/
        │  repository.method()             (depends on the ABSTRACT repo)
        ▼
Repository interface (abstract)            ← domain/repository/
        ▲ implements
Repository impl                            ← data/repositories/
   ├── ApiService  (Retrofit)              ← data/api/
   └── XxxDao      (sqflite)               ← data/local/  +  data/DB/
```

**Golden rule of dependency direction:** `screens → viewModels → usecase → domain/repository (abstract)`.
The concrete `data/` layer is only ever bound at the provider level, so nothing above
`domain` imports `data` except the provider files.

### Layer responsibilities

| Layer | Folder | Owns | Never does |
|---|---|---|---|
| Core | `lib/core/` | Dio instance, interceptors, token state, secure storage, connectivity, base URL | Business logic |
| Models | `lib/domain/models/` | DTOs + `fromJson`/`toJson`/`copyWith` | Networking, DB |
| Repo contracts | `lib/domain/repository/` | Abstract classes only | Any implementation |
| UseCases | `lib/domain/usecase/` | One thin method per user action | Hold state, touch Dio/DB |
| Repo impls | `lib/data/repositories/` | Remote+local orchestration, sync logic | Riverpod, BuildContext |
| API | `lib/data/api/` | Retrofit `abstract class ApiService` + generated `.g.dart` | Anything hand-written |
| DAO | `lib/data/local/` | Raw sqflite CRUD per table | HTTP |
| DB | `lib/data/DB/` | Schema, migrations, `clearAllTables()` | Business rules |
| ViewModels | `lib/presentation/viewModels/` | `XState` + `StateNotifier<XState>` | Direct API/DAO calls |
| Providers | `lib/presentation/providers/` | Dependency wiring only | Logic |
| Controllers | `lib/presentation/controllers/` | Cross-cutting reactive side effects (auto-sync) | UI |
| Screens | `lib/screens/` | Widgets, local UI state, formatting | Network/DB |

---

## 2. Folder Structure (copy this verbatim)

```
lib/
├── main.dart
├── core/
│   ├── constant.dart                  # baseUrl and other global consts
│   ├── network/
│   │   ├── dio_provider.dart          # Dio + ApiService providers
│   │   ├── interceptor.dart           # TokenInterceptor (auth + refresh + 401 logout)
│   │   ├── network_service.dart       # connectivity_plus wrapper -> Stream<bool>
│   │   ├── network_overlay.dart       # global "no internet" wrapper widget
│   │   └── token_provider.dart        # TokenState + TokenNotifier (in-memory auth state)
│   └── storage/
│       └── token_storage.dart         # FlutterSecureStorage static helper
├── data/
│   ├── api/
│   │   ├── api_service.dart           # @RestApi abstract class — the ONLY HTTP surface
│   │   └── api_service.g.dart         # generated
│   ├── DB/
│   │   └── app_database.dart          # sqflite schema + version + onUpgrade
│   ├── local/
│   │   └── <feature>_dao.dart         # one DAO per table
│   └── repositories/
│       └── <feature>_impl.dart        # implements domain/repository contract
├── domain/
│   ├── models/
│   │   ├── <model>.dart               # @JsonSerializable
│   │   └── <model>.g.dart             # generated
│   ├── repository/
│   │   └── <feature>_repo.dart        # abstract class
│   └── usecase/
│       └── <feature>_usecase.dart
├── presentation/
│   ├── controllers/
│   │   └── sync_controller.dart
│   ├── providers/
│   │   ├── repository_provider.dart   # api+dao -> repo impl
│   │   ├── usecase_provider.dart      # repo -> usecase
│   │   ├── viewModel_provider.dart    # usecase -> viewModel
│   │   ├── connectivity_provider.dart
│   │   ├── network_provider.dart
│   │   └── locale_provider.dart
│   └── viewModels/
│       └── <feature>_viewmodel.dart   # XState + StateNotifier<XState>
├── screens/
│   ├── splash_screen.dart             # auth gate / role routing
│   ├── login_screen.dart
│   ├── otp_screen.dart
│   ├── theme.dart                     # AppTheme: colors, gradients, ThemeData
│   ├── admin_screen/
│   │   ├── ...
│   │   └── widgets/                   # screens-group-local widgets
│   └── employee_screen/
└── widgets/                           # app-wide reusable widgets (AppSearchBar, ...)
```

Notes on the convention actually used here:
- Screens are grouped **by role/persona** (`admin_screen/`, `employee_screen/`), not by feature.
- Group-local widgets live in `<group>/widgets/`; truly shared ones in `lib/widgets/`.
- `theme.dart` lives inside `screens/` in this project (move to `core/theme/` if you prefer).

---

## 3. Dependencies (pubspec.yaml)

```yaml
dependencies:
  # State & Storage
  flutter_riverpod: ^2.6.1
  flutter_secure_storage: ^10.0.0
  shared_preferences: ^2.5.4
  sqflite: ^2.3.3
  sqflite_common_ffi: ^2.3.3

  # Networking
  dio: ^5.9.0
  retrofit: 4.9.2
  connectivity_plus: 7.0.0

  # Serialization
  json_annotation: 4.9.0

  uuid: ^4.4.0        # local_id generation for offline rows
  path: ^1.9.0        # DB path join

dev_dependencies:
  flutter_lints: ^5.0.0    # ⚠️ missing in the source project — see §14.5

  # Code generation — keep these version-locked together
  retrofit_generator: ^10.2.1
  json_serializable: ^6.11.4
  build_runner: ^2.10.5
```

The source project also declares `freezed` / `freezed_annotation` but never uses them
(§14.6). Either drop them or adopt freezed for state classes (§15.2) — the latter is
recommended.

Regenerate with:

```bash
dart run build_runner build --delete-conflicting-outputs
# or during development
dart run build_runner watch --delete-conflicting-outputs
```

---

## 4. Networking Stack

### 4.1 Base URL — `core/constant.dart`

```dart
// const String baseUrl = 'https://dev-tunnel.example.com/';  // keep dev URL commented
const String baseUrl = 'https://retailpulse.vengurlatech.com/';
```

Single global const, imported by both `dio_provider.dart` and the `@RestApi` annotation.

### 4.2 Dio — `core/network/dio_provider.dart`

```dart
final dioProvider = FutureProvider<Dio>((ref) {
  final dio = Dio(BaseOptions(
    baseUrl: baseUrl,
    connectTimeout: const Duration(seconds: 30),
    receiveTimeout: const Duration(seconds: 30),
    sendTimeout:    const Duration(seconds: 30),
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  ));

  dio.interceptors.add(LogInterceptor(requestBody: true, responseBody: true));
  dio.interceptors.add(TokenInterceptor(
    dio: dio,
    ref: ref,
    authRepository: ref.watch(authRepoProvider),
  ));

  return dio;
});

final apiServiceProvider = Provider<ApiService>((ref) {
  final dio = ref.watch(dioProvider).value;
  return ApiService(dio!);
});
```

There is also a **bare, interceptor-free** `authRepoProvider` used *by* the interceptor
itself — this breaks the circular dependency when refreshing the token:

```dart
final authRepoProvider = Provider<AuthImpl>((ref) {
  final dio = Dio(BaseOptions(baseUrl: baseUrl));  // no interceptors!
  return AuthImpl(ApiService(dio));
});
```

> ⚠️ Replicate that split. If the refresh call goes through the interceptor-bearing
> Dio, a 401 on refresh triggers infinite recursion.

### 4.3 Token interceptor — `core/network/interceptor.dart`

Responsibilities, in order:

1. `onRequest` → read access token from `tokenProvider`, attach `Authorization: Bearer <token>`.
2. `onError` → if status is **not** 401, pass through.
3. No refresh token → `clearTokens()` + hard-navigate to login.
4. Call `authRepository.refreshAccessToken(...)`, save new tokens, **retry the original
   request** via `dio.fetch(reqOptions)` with the new header and `handler.resolve(response)`.
5. Refresh failed → `clearTokens()` + navigate to login.

```dart
class TokenInterceptor extends Interceptor {
  final Dio dio;
  final Ref ref;
  final AuthImpl authRepository;

  TokenInterceptor({required this.dio, required this.ref, required this.authRepository});

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final token = ref.read(tokenProvider).accessToken;
    if (token != null && token.isNotEmpty) {
      options.headers['Authorization'] = "Bearer $token";
    }
    handler.next(options);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    if (err.response?.statusCode != 401) return handler.next(err);

    final refreshToken = ref.read(tokenProvider).refreshToken;
    if (refreshToken == null || refreshToken.isEmpty) {
      await ref.read(tokenProvider.notifier).clearTokens();
      _goToLogin();
      return handler.next(err);
    }

    try {
      final res = await authRepository.refreshAccessToken(
        TokenResponse(refreshToken: refreshToken),
      );
      await ref.read(tokenProvider.notifier)
          .saveTokens(res.accessToken!, res.refreshToken!, res.roleId ?? 0);
      return _retryRequest(err, handler);
    } catch (_) {
      await ref.read(tokenProvider.notifier).clearTokens();
      _goToLogin();
      return handler.next(err);
    }
  }

  Future<void> _retryRequest(DioException err, ErrorInterceptorHandler handler) async {
    final reqOptions = err.requestOptions;
    final newToken = ref.read(tokenProvider).accessToken;
    reqOptions.headers['Authorization'] = "Bearer $newToken";
    try {
      final response = await dio.fetch(reqOptions);
      handler.resolve(response);
    } catch (e) {
      handler.next(err);
    }
  }

  void _goToLogin() {
    Future.microtask(() {
      navigatorKey.currentState?.pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => LoginScreen()),
        (route) => false,
      );
    });
  }
}
```

Forced logout uses a **global `navigatorKey`** declared in `main.dart` — required
because the interceptor has no `BuildContext`.

### 4.4 Retrofit API surface — `data/api/api_service.dart`

One abstract class holds *every* endpoint in the app, sectioned by comment banners.

```dart
@RestApi(baseUrl: baseUrl)
abstract class ApiService {
  factory ApiService(Dio dio, {String baseUrl}) = _ApiService;

  // ===== ADMIN API =====

  // ---- GET ----
  @GET("/")
  Future<HttpResponse> checkHealth();                       // health probe

  @GET("users/employeeList/{company_id}")
  Future<List<EmployeeLogin>> getEmployeeList(@Path("company_id") String companyId);

  @GET("login/checkPhone")
  Future<List<LoginInfo>> checkPhone(@Query("mobile_no") String mobileNo);

  // ---- POST ----
  @POST("login/CreateLogin")
  Future<TokenResponse> createLogin(@Body() TokenResponse tokenResponse);

  @POST("login/refreshAccessToken")
  Future<TokenResponse> refreshAccessToken(@Body() TokenResponse tokenResponse);

  @POST("insert/checkIn/{emp_id}/{latitude}/{longitude}")
  Future<CheckInStatusRequest> checkIn(
    @Path("emp_id") int empId,
    @Path("latitude") double latitude,
    @Path("longitude") double longitude,
  );

  // ---- MULTIPART ----
  @MultiPart()
  @POST("upload/shopImage")
  Future<dynamic> uploadShopImage(
    @Part(name: "image") File image,
    @Part(name: "shop_id") String shopId,
  );

  // ---- DELETE ----
  @DELETE("index/deleteShop/{shop_id}")
  Future<dynamic> deleteShop(@Path("shop_id") int shopId);
}
```

Conventions used:
- **Path params keep server snake_case** in the annotation, camelCase in Dart:
  `@Path("company_id") String companyId`.
- Return the model directly (`Future<List<Product>>`) when typed; use `Future<dynamic>`
  for envelope responses like `{success: true, location_id: 12}`.
- `Future<HttpResponse>` when you need the raw status code (health check).
- File uploads use `@MultiPart()` + `@Part(name: "...")` with `File` args. Multipart
  forms with many scalar fields are declared as a long `@Part`-per-field parameter list
  rather than a `@Body()` model (see `addShopDetails`).
- Sections separated by `//GET API`, `//POST API`, `// DELETE API`, and a long
  `//EMPLOYEE API-----` banner between personas.

### 4.5 Connectivity — `core/network/network_service.dart`

```dart
class NetworkService {
  final Connectivity _connectivity = Connectivity();

  Stream<bool> get onConnectivityChanged async* {
    yield await checkConnection();      // emit immediately on cold start
    yield await checkRealInternet();    // then a real reachability check
    await for (final result in _connectivity.onConnectivityChanged) {
      yield !result.contains(ConnectivityResult.none);
    }
  }

  Future<bool> checkConnection() async =>
      !(await _connectivity.checkConnectivity()).contains(ConnectivityResult.none);

  Future<bool> checkRealInternet() async {
    try {
      final r = await InternetAddress.lookup('google.com');
      return r.isNotEmpty && r[0].rawAddress.isNotEmpty;
    } catch (_) { return false; }
  }
}
```

Distinguishing "has a network interface" from "actually reachable" matters — replicate both.

---

## 5. Auth & Token Handling

### 5.1 Secure storage — `core/storage/token_storage.dart`

A **static** class over `FlutterSecureStorage`, with three fixed keys plus a
generic key/value escape hatch:

```dart
class TokenStorage {
  static const _accessTokenKey  = 'ACCESS_TOKEN';
  static const _refreshTokenKey = 'REFRESH_TOKEN';
  static const _roleIdKey       = 'ROLE_ID';
  static const FlutterSecureStorage _storage = FlutterSecureStorage();

  static Future<void> saveTokens(String access, String refresh, int roleId) async { ... }
  static Future<Map<String, String>?> getTokens() async { ... }   // null if incomplete
  static Future<void> clear() async => _storage.deleteAll();

  // generic values: name, mobile_no, company_id, region_id, user_id, ...
  static Future<void> saveValue(String key, String value) async { ... }
  static Future<String?> getValue(String key) async { ... }
}
```

### 5.2 In-memory token state — `core/network/token_provider.dart`

```dart
class TokenState {
  final String? accessToken;
  final String? refreshToken;
  final int? roleId;
  final bool isLoading;
  const TokenState({this.roleId, this.accessToken, this.refreshToken, this.isLoading = true});

  bool get isLoggedIn => accessToken != null && refreshToken != null && roleId != 0;

  TokenState copyWith({...}) => TokenState(...);
}

class TokenNotifier extends StateNotifier<TokenState> {
  TokenNotifier() : super(const TokenState());

  Future<void> loadTokens()  async { ... }   // hydrate from secure storage at boot
  Future<void> saveTokens(String a, String r, int roleId) async { ... }
  Future<void> clearTokens() async { ... }
}

final tokenProvider = StateNotifierProvider<TokenNotifier, TokenState>((ref) => TokenNotifier());
```

The pattern: **secure storage is the source of truth on disk, `TokenState` is the
synchronous read cache** the interceptor uses (`ref.read(tokenProvider).accessToken`).

Non-token session data (name, `company_id`, `region_id`, `user_id`, `role_id`) is also
persisted via `TokenStorage.saveValue` and rehydrated in the login ViewModel's
`loadFromStorage()` constructor call — that's how `companyId` is available app-wide
without a network round trip.

### 5.3 Boot + auth gate

`main.dart` pre-hydrates tokens *before* `runApp`, using a throwaway `ProviderContainer`:

```dart
final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();
final GlobalKey<ScaffoldMessengerState> rootScaffoldMessengerKey = GlobalKey<ScaffoldMessengerState>();

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final container = ProviderContainer();
  await container.read(tokenProvider.notifier).loadTokens();

  runApp(
    ProviderScope(
      child: Consumer(
        builder: (context, ref, _) {
          ref.read(syncControllerProvider);   // activate the auto-sync listener
          return const EmployeePortalApp();
        },
      ),
    ),
  );
}
```

`SplashScreen` is the routing gate — it reloads tokens then branches on `roleId`:

```dart
Future<void> checkLogin() async {
  await ref.read(tokenProvider.notifier).loadTokens();
  final t = ref.read(tokenProvider);

  if (t.isLoggedIn) {
    if (t.roleId == 1)      _go(const AdminDashboardScreen());
    else if (t.roleId == 2) _go(const MainNavigationScreen());
    else if (t.roleId == 3) _go(const MainNavigationScreen());
    else                    _go(const LoginScreen());
  } else {
    _go(const LoginScreen());
  }
}
```

---

## 6. Models

Hand-written `@JsonSerializable` classes with explicit `@JsonKey` snake_case mapping.

```dart
import 'package:json_annotation/json_annotation.dart';
part 'product.g.dart';

@JsonSerializable(explicitToJson: true)
class Product {
  // ===== SERVER FIELDS =====
  @JsonKey(name: 'product_id')      final int? productId;
  @JsonKey(name: 'product_name')    final String? productName;
  @JsonKey(name: 'company_id')      final String? companyId;

  // ===== READ-ONLY SERVER FIELDS (never sent back) =====
  @JsonKey(name: 'product_unit', includeToJson: false) final String? productUnit;

  // ===== LOCAL DB ONLY =====
  @JsonKey(ignore: true) final String? localId;    // client UUID for offline rows
  @JsonKey(ignore: true) final bool isSynced;
  @JsonKey(ignore: true) final DateTime? updatedAt;

  Product({ this.productId, this.productName, this.companyId,
            this.productUnit, this.localId, this.isSynced = false, this.updatedAt });

  factory Product.fromJson(Map<String, dynamic> json) => _$ProductFromJson(json);
  Map<String, dynamic> toJson() => _$ProductToJson(this);

  Product copyWith({ ... }) => Product( x: x ?? this.x, ... );
}
```

Model rules used throughout:
- Fields grouped with banner comments: `// ===== SERVER FIELDS =====`, `// ===== LOCAL DB ONLY =====`.
- Almost everything nullable (`int?`, `String?`) — the backend is lenient.
- `@JsonKey(ignore: true)` for offline-only columns (`localId`, `isSynced`, `updatedAt`).
- `@JsonKey(includeToJson: false)` for computed/read-only server fields.
- Every model exposes `fromJson`, `toJson`, and `copyWith`.
- Nested models use `@JsonSerializable(explicitToJson: true)`; sub-entities (e.g.
  `ProductSubType`) live in the same file as their parent.

**Defensive `fromJson`** — when the backend is inconsistent about casing, normalize
before delegating to the generated function (see `Order`):

```dart
factory Order.fromJson(Map<String, dynamic> json) {
  final n = Map<String, dynamic>.from(json);
  n['order_id']    ??= json['orderId'];
  n['employee_id'] ??= json['employeeId'];
  n['shop_name']   ??= json['shopName'];
  n['emp_name']    ??= json['employee_name'] ?? json['employeeName'] ?? json['empName'];
  return _$OrderFromJson(n);
}
```

Derived values are computed in the constructor initializer list:

```dart
}) : totalPrice = totalPrice ?? items.fold(0, (sum, i) => sum + i.totalPrice);
```

Models destined for sqflite additionally expose a `toLocalJson()` when the DB shape
differs from the wire shape.

---

## 7. Repository Layer

### 7.1 Contract — `domain/repository/product_repo.dart`

```dart
abstract class ProductRepository {
  Future<void> addOrUpdateProductOffline(Product product);
  Future<List<Product>> getAllProducts(String companyId);
  Future<void> syncRemoteToLocal(String companyId);
  Future<void> deleteSubProduct(List<int> subItemIds);
  Future<List<ProductData>> productReport(String companyId);
}
```

### 7.2 Implementation — `data/repositories/product_impl.dart`

Constructor takes `(ApiService api, XxxDao local)`. Reads are **local-first after a
remote refresh**; failures during refresh are swallowed so cached data still renders.

```dart
class ProductImpl implements ProductRepository {
  final ApiService api;
  final ProductDao local;

  ProductImpl(this.api, this.local);

  @override
  Future<List<Product>> getAllProducts(String companyId) async {
    await syncRemoteToLocal(companyId);   // best-effort refresh
    return local.getAllProducts();        // always serve from cache
  }

  @override
  Future<void> syncRemoteToLocal(String companyId) async {
    try {
      final remote = await api.fetchProductList(companyId);
      if (remote.isEmpty) {
        await local.deleteProductsNotIn([]);
        return;
      }
      final serverIds = [for (final p in remote) if (p.productId != null) p.productId!];

      await local.insertProducts(remote, markSynced: true);   // 1. upsert
      await local.deleteProductsNotIn(serverIds);             // 2. drop stale
    } catch (e) {
      print('Remote → Local sync failed');                    // never rethrow
    }
  }

  @override
  Future<List<ProductData>> productReport(String companyId) async {
    try {
      return await api.productReport(companyId);
    } catch (e) {
      print('Failed to fetch product report: $e');
      rethrow;                                                // pure-remote: surface it
    }
  }
}
```

Rule of thumb: **cache-backed reads swallow errors; pure-remote reads rethrow.**

### 7.3 Offline outbox pattern — `data/repositories/shop_visit.dart`

For writes that must survive being offline, the repo enqueues locally, then drains the
queue with a re-entrancy guard and a retry cap:

```dart
class VisitImpl implements VisitRepository {
  final OfflineVisitDao local;
  final ApiService apiService;
  bool _isSyncing = false;                        // re-entrancy guard

  Future<void> saveVisitOffline(VisitPayload visit) async {
    await local.insert(visit);      // status = 'pending'
    await syncOfflineVisits();      // opportunistic drain
  }

  Future<void> syncOfflineVisits() async {
    if (_isSyncing) return;
    _isSyncing = true;
    try {
      for (final row in await local.fetchPending()) {
        final id = row['id'] as int;
        if ((row['retry_count'] as int) >= 5) continue;   // give up after 5

        try {
          await local.markSyncing(id);
          final visit = VisitPayload.fromJson(jsonDecode(row['payload']));
          final response = await apiService.addLocation(visit);

          if (response['success'] != true) throw Exception('sync failed for $id');

          final serverId = response['location_id'];
          serverId is int
              ? await local.markSyncedWithServerId(id, serverId)
              : await local.markSynced(id);
        } catch (e) {
          await local.incrementRetry(id);        // back to 'pending'
        }
      }
    } finally {
      _isSyncing = false;
    }
  }
}
```

Row lifecycle: `pending → syncing → synced` (or back to `pending` with `retry_count + 1`).

---

## 8. Local Database (sqflite)

### 8.1 Singleton + schema — `data/DB/app_database.dart`

```dart
class AppDatabase {
  static Database? _db;

  static Future<Database> get database async => _db ??= await _init();

  static Future<Database> _init() async {
    final path = join(await getDatabasesPath(), 'offline_queue.db');
    return openDatabase(
      path,
      version: 10,
      onCreate: (db, _) async {
        await _createOfflineVisitsTable(db);
        await _createShopsTable(db);
        await _createProductsTable(db);
        // ... one private static method per table
      },
      onUpgrade: (db, oldVersion, newVersion) async {
        if (oldVersion < 10) {
          try {
            await db.execute('ALTER TABLE products ADD COLUMN quantity_per_box INTEGER');
          } catch (_) { /* column may already exist */ }
        }
      },
    );
  }

  static Future<void> _createProductsTable(Database db) async {
    await db.execute('''
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_id TEXT UNIQUE,
        product_id INTEGER UNIQUE,
        product_name TEXT,
        company_id TEXT,
        is_synced INTEGER DEFAULT 0,
        updated_at TEXT
      )
    ''');
  }

  static Future<void> clearAllTables() async {
    final db = await database;
    await db.transaction((txn) async {
      await txn.delete('products');
      await txn.delete('offline_orders');
      // ... every table — called on logout
    });
  }
}
```

### 8.2 Standard offline column set

Every synced table carries some subset of:

| Column | Purpose |
|---|---|
| `local_id TEXT UNIQUE` | client-generated UUID, stable before the server assigns an id |
| `server_id` / `server_<x>_id INTEGER UNIQUE` | server primary key once synced |
| `payload TEXT` | full JSON blob for pure outbox tables |
| `status TEXT` | `pending` / `syncing` / `synced` |
| `sync_action TEXT` | `create` / `update` / `delete` |
| `is_synced INTEGER DEFAULT 0` | boolean-as-int |
| `is_deleted INTEGER DEFAULT 0` | soft delete / tombstone |
| `retry_count INTEGER DEFAULT 0` | retry backoff/cap |
| `captured_at TEXT` / `updated_at TEXT` | ISO-8601 strings |

### 8.3 DAO style — `data/local/*_dao.dart`

Plain classes, no base class, each method opens the shared DB:

```dart
class OfflineVisitDao {
  Future<void> insert(VisitPayload visit) async {
    final db = await AppDatabase.database;
    await db.insert('offline_visits', {
      'local_id': visit.localId,
      'payload': jsonEncode(visit.toLocalJson()),
      'status': 'pending',
      'captured_at': visit.capturedAt!.toIso8601String(),
    }, conflictAlgorithm: ConflictAlgorithm.ignore);
  }

  Future<List<Map<String, dynamic>>> fetchPending({int limit = 20}) async {
    final db = await AppDatabase.database;
    return db.query('offline_visits',
        where: 'status = ?', whereArgs: ['pending'],
        orderBy: 'captured_at ASC', limit: limit);
  }

  Future<void> markSynced(int id) async {
    final db = await AppDatabase.database;
    await db.update('offline_visits', {'status': 'synced'},
        where: 'id = ?', whereArgs: [id]);
  }

  Future<void> incrementRetry(int id) async {
    final db = await AppDatabase.database;
    await db.rawUpdate('''
      UPDATE offline_visits
      SET retry_count = retry_count + 1, status = 'pending'
      WHERE id = ?
    ''', [id]);
  }
}
```

Bulk server→local upserts use `db.batch()` + `batch.commit(noResult: true)`, preceded by
a read of existing keys into a `Map`/`Set` so each row can be routed to insert-vs-update
without a per-row query.

---

## 9. UseCases

Thin pass-through wrappers — one class per feature, one method per user action.
They exist to keep ViewModels ignorant of repository shape and to be the seam for tests.

```dart
class ProductUsecase {
  final ProductRepository productRepository;
  ProductUsecase(this.productRepository);

  /// Add or update a product (offline + online)
  Future<void> addOrUpdateProduct(Product product) async {
    await productRepository.addOrUpdateProductOffline(product);
  }

  /// Get all products (local + fetch remote if possible)
  Future<List<Product>> getAllProducts(String companyId) {
    return productRepository.getAllProducts(companyId);
  }

  /// Delete a product subtype
  Future<void> deleteProductSubType(List<int> subItemId) async {
    await productRepository.deleteSubProduct(subItemId);
  }
}
```

Each method carries a one-line `///` doc comment describing the user-facing action.

---

## 10. State Management (Riverpod + StateNotifier MVVM)

### 10.1 The `XState` + `XViewModel` pair

Each feature file in `presentation/viewModels/` contains **both** an immutable state
class and its notifier.

```dart
class ProductState {
  final bool isLoading;
  final String? error;
  final AsyncValue<List<Product>>? productList;
  final AsyncValue<List<ProductData>>? productReport;

  const ProductState({
    this.isLoading = false,
    this.error,
    this.productList   = const AsyncValue.loading(),
    this.productReport = const AsyncValue.loading(),
  });

  ProductState copyWith({
    bool? isLoading,
    String? error,
    AsyncValue<List<Product>>? productList,
    AsyncValue<List<ProductData>>? productReport,
  }) => ProductState(
    isLoading:     isLoading     ?? this.isLoading,
    error:         error         ?? this.error,
    productList:   productList   ?? this.productList,
    productReport: productReport ?? this.productReport,
  );
}
```

Note the hybrid: a **flat `isLoading` / `error`** pair for global feature status, plus
a **per-collection `AsyncValue<T>`** so each list tracks its own loading/data/error.

### 10.2 The ViewModel

Every async method follows the exact same three-beat shape:

```dart
class ProductViewModel extends StateNotifier<ProductState> {
  final ProductUsecase usecase;
  ProductViewModel(this.usecase) : super(const ProductState());

  /// Fetch Product List
  Future<void> fetchProductList(String companyId) async {
    state = state.copyWith(isLoading: true, error: null);        // 1. enter loading
    try {
      final products = await usecase.getAllProducts(companyId);  // 2. call usecase
      state = state.copyWith(
        isLoading: false,
        productList: AsyncValue.data(products),
      );
    } catch (e, st) {                                            // 3. capture (e, st)
      state = state.copyWith(
        isLoading: false,
        error: e.toString(),
        productList: AsyncValue.error(e, st),
      );
    }
  }
}
```

Extra guards used where double-submit matters:

```dart
class ShopViewModel extends StateNotifier<ShopState> {
  bool _isAddingShop = false;

  Future<void> addShop(ShopDetails shop) async {
    if (_isAddingShop || state.isLoading) return;   // idempotency guard
    _isAddingShop = true;
    state = state.copyWith(isLoading: true, error: null);
    try {
      await usecase.addShop(shop);
      await getEmpShopList(shop.companyId, shop.regionId ?? 0, listType);  // refetch
      state = state.copyWith(isLoading: false);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: e.toString());
    } finally {
      _isAddingShop = false;
    }
  }
}
```

Some ViewModels also self-hydrate in their constructor:

```dart
AdminloginViewModel(this.usecase) : super(const AdminloginState()) {
  loadFromStorage();   // pull name / company_id / region_id / user_id from secure storage
}
```

### 10.3 Three-file provider wiring

Dependency injection is split across three files, each one layer of the graph.
**This is the single most important structural convention to copy.**

**`providers/repository_provider.dart`** — `Dio + DAO → repository impl`

```dart
final productRepositoryProvider = Provider<ProductRepository>((ref) {
  final dio   = ref.watch(dioProvider).value!;
  final api   = ApiService(dio);
  final local = ProductDao();
  return ProductImpl(api, local);
});
```

**`providers/usecase_provider.dart`** — `repository → usecase`

```dart
final productUsecaseProvider = Provider<ProductUsecase>((ref) {
  final productRepo = ref.watch(productRepositoryProvider);
  return ProductUsecase(productRepo);
});
```

**`providers/viewModel_provider.dart`** — `usecase → ViewModel`

```dart
final productViewModelProvider =
    StateNotifierProvider<ProductViewModel, ProductState>((ref) {
  final usecase = ref.watch(productUsecaseProvider);
  return ProductViewModel(usecase);
});
```

Adding a feature = **7 files, always in this order**:
`model → repo contract → DAO → repo impl → usecase → viewModel → 3 provider entries`.

Providers declared in `viewModel_provider.dart` are the *only* ones screens import.

### 10.4 Reactive controllers — `presentation/controllers/sync_controller.dart`

A `Provider<void>` that exists purely for its `ref.listen` side effect. Instantiated
once in `main.dart` so it stays alive for the app lifetime.

```dart
final syncControllerProvider = Provider<void>((ref) {
  ref.listen<AsyncValue<List<ConnectivityResult>>>(connectivityProvider, (prev, next) async {
    final wasOffline = prev?.value?.contains(ConnectivityResult.none) ?? true;
    final isOnline   = next.value != null && !next.value!.contains(ConnectivityResult.none);

    final companyId = ref.read(adminloginViewModelProvider).companyId ?? "";
    final userId    = ref.read(adminloginViewModelProvider).userId;
    final regionId  = ref.read(adminloginViewModelProvider).regionId ?? 0;
    final type      = (ref.read(tokenProvider).roleId ?? 0) == 3 ? 2 : 1;

    // fire only on the offline -> online edge
    if (wasOffline && isOnline && companyId.isNotEmpty) {
      try {
        await ref.read(visitViewModelProvider.notifier).sync();
        await ref.read(shopViewModelProvider.notifier).getEmpShopList(companyId, regionId, type);
        await ref.read(productViewModelProvider.notifier).fetchProductList(companyId);
        await ref.read(ordersViewModelProvider.notifier).getAllOrders(userId);
      } catch (e) { /* silent */ }
    }
  });
});
```

Key idea: **edge-triggered, not level-triggered** — compare `previous` vs `next`.

### 10.5 Ambient providers

```dart
final networkServiceProvider = Provider((ref) => NetworkService());

final networkStatusProvider = StreamProvider<bool>((ref) =>
    ref.watch(networkServiceProvider).onConnectivityChanged);

final connectivityProvider = StreamProvider<List<ConnectivityResult>>((ref) =>
    Connectivity().onConnectivityChanged);

final localeProvider = StateNotifierProvider<LocaleNotifier, Locale>((ref) => LocaleNotifier());

final apiStateProvider = StateNotifierProvider<ApiStateNotifier, ApiState>((ref) =>
    ApiStateNotifier(ref.watch(apiServiceProvider)));
```

`LocaleNotifier` persists the chosen language to `SharedPreferences` and maps display
names to codes (`'Marathi' → 'mr'`), loading in its constructor.

`ApiStateNotifier` periodically polls `checkHealth()` (every 2 min) and maps
`DioExceptionType` to human error strings — copy this for a "server unavailable" banner:

```dart
if (e is DioException) {
  switch (e.type) {
    case DioExceptionType.connectionTimeout:
    case DioExceptionType.sendTimeout:
    case DioExceptionType.receiveTimeout:  msg = "Server timeout"; break;
    case DioExceptionType.connectionError: msg = "Cannot reach server"; break;
    case DioExceptionType.badResponse:     msg = "Server error (${e.response?.statusCode})"; break;
    default:                               msg = "Server unavailable";
  }
}
```

---

## 11. UI Layer Conventions

### 11.1 Widget class shape

Always `ConsumerStatefulWidget` / `ConsumerState` (or `ConsumerWidget` for stateless).

```dart
class CatalogPage extends ConsumerStatefulWidget {
  const CatalogPage({Key? key}) : super(key: key);

  @override
  ConsumerState<CatalogPage> createState() => _CatalogPageState();
}
```

### 11.2 Kick off fetches in `initState` via `Future.microtask`

Never call `ref.read(...).method()` synchronously in `initState` — wrap it:

```dart
@override
void initState() {
  super.initState();
  Future.microtask(() {
    ref.read(productViewModelProvider.notifier).fetchProductList(
          ref.read(adminloginViewModelProvider).companyId ?? '',
        );
  });
}
```

### 11.3 Reading state in `build`

`ref.watch` for state, `ref.read(...notifier)` for actions. Render `AsyncValue` with
`.when(data:, loading:, error:)`, guarded by the flat `isLoading` for the first paint:

```dart
@override
Widget build(BuildContext context) {
  final state = ref.watch(productViewModelProvider);
  final hasProducts = state.productList?.value != null;

  return Scaffold(
    body: SafeArea(
      child: (state.isLoading && !hasProducts)
          ? _wrapRefresh(_buildLoading())
          : (state.productList?.when(
                data:    (products) => Column(children: [_buildHeader(products), Expanded(child: _buildList())]),
                loading: () => _wrapRefresh(_buildLoading()),
                error:   (e, _) => _wrapRefresh(_buildError(e.toString())),
              ) ?? _wrapRefresh(_buildLoading())),
    ),
  );
}
```

`state.isLoading && !hasProducts` is the "show spinner only on cold load, keep stale
data visible during refresh" idiom — worth keeping.

### 11.4 Screen file layout

```dart
// 1. imports
// 2. ── Brand tokens ──  (file-private consts)
const _kPrimary       = Color(0xFFE8720C);
const _kBackground    = Color(0xFFF5F5F5);
const _kTextPrimary   = Color(0xFF1A1A1A);

// 3. widget class + State
// 4. local UI state fields (controllers, Timer? _debounce, filtered lists)
// 5. initState / dispose
// 6. handlers (_filterProducts, _onSearchChanged, _refreshX)
// 7. formatters/helpers (formatUnit, _typeColor, _typeIcon)
// 8. build()
// 9. private _buildXxx() sub-widget methods, separated by banner comments:
//    // ── Header ────────────────────────────────────────────────────
```

Search inputs are debounced at 300 ms and the `Timer` is cancelled in `dispose`:

```dart
void _onSearchChanged(String query, List<Product> products) {
  _debounce?.cancel();
  _debounce = Timer(const Duration(milliseconds: 300), () => _filterProducts(query, products));
}
```

Enum-ish string values get `switch`-based presentation helpers rather than a map:

```dart
Color _typeColor(String? type) {
  switch (type) {
    case 'Beverage': return const Color(0xFF0EA5E9);
    case 'Grocery':  return const Color(0xFFF59E0B);
    default:         return const Color(0xFF64748B);
  }
}
```

### 11.5 Theming

`screens/theme.dart` holds `class AppTheme` with grouped static consts and a
`lightTheme` `ThemeData`, grouped by banner comments:

```dart
class AppTheme {
  // Primary Colors
  static const Color primaryColor = Color(0xFFFFB74D);
  static const Color primaryDark  = Color(0xFFFFA726);
  static const Color primaryLight = Color(0xFFFFE0B2);

  // Background & Surface
  static const Color backgroundColor = Color(0xFFFFFDF9);
  static const Color cardBackground  = Color(0xFFFFFFFF);

  // Text Colors
  static const Color textPrimary   = Color(0xFF2C1810);
  static const Color textSecondary = Color(0xFF6B4423);

  // Status Colors
  static const Color successColor = Color(0xFF4CAF50);
  static const Color errorColor   = Color(0xFFE53935);

  // ========================
  // VIBRANT GRADIENTS
  // ========================
  static const LinearGradient primaryGradient = LinearGradient(
    colors: [Color(0xFFFFC20A), Color(0xFFFFB74D)],
    begin: Alignment.topLeft, end: Alignment.bottomRight,
  );

  static ThemeData get lightTheme => ThemeData( ... );
}
```

Applied in `main.dart` as `theme: AppTheme.lightTheme, themeMode: ThemeMode.light`.

> In practice this project *also* defines file-private `_kPrimary`-style tokens per
> screen. Pick one — the `AppTheme` route is the one to standardize on for a new project.

### 11.6 Reusable state widgets

`screens/<group>/widgets/admin_retry_widgets.dart` provides parameterized empty/error
states with sensible defaults:

```dart
class AdminNoInternetRetry extends StatelessWidget {
  final VoidCallback onRetry;
  final String title;
  final String message;
  final String buttonLabel;

  const AdminNoInternetRetry({
    super.key,
    required this.onRetry,
    this.title       = 'No Internet Connection',
    this.message     = 'Check your WiFi or mobile data\nand try again.',
    this.buttonLabel = 'Retry',
  });
}
```

Built on `ListView(physics: AlwaysScrollableScrollPhysics())` so pull-to-refresh
still works on an empty screen.

`core/network/network_overlay.dart` wraps a subtree and swaps in an offline page based
on `networkStatusProvider`, degrading to `child` on loading/error.

---

## 12. Code Style Cheat-Sheet

**Naming**
- Files: `snake_case.dart` — `product_viewmodel.dart`, `offline_visit_dao.dart`.
  (The project has a few camelCase strays like `employeeMap.dart` / `viewModel_provider.dart`;
  standardize on snake_case for a new project.)
- Classes: `XImpl` (repo impl), `XRepository` (contract), `XUsecase`, `XViewModel`, `XState`, `XDao`.
- Providers: `<feature><Layer>Provider` — `productRepositoryProvider`,
  `productUsecaseProvider`, `productViewModelProvider`.
- Dart identifiers camelCase; JSON/SQL keys snake_case, bridged by `@JsonKey(name:)`.

**Comments**
- Banner separators for sections: `// ── Header ────────`, `// ===== SERVER FIELDS =====`,
  `//GET API`, `// ========================`.
- `///` doc comments on usecase and notifier methods, phrased as the user action.
- Numbered inline steps in sync routines: `// 1️⃣ Upsert everything`, `// 2️⃣ Delete stale`.

**Error handling**
- ViewModels: `catch (e, st)` → store `e.toString()` in `error` **and** `AsyncValue.error(e, st)`.
- Repository sync paths: `try/catch` that logs and **does not rethrow** (cached data must still render).
- Repository direct fetches: `catch (e) { print(...); rethrow; }` so the ViewModel can surface it.
- Background/opportunistic work: swallow silently.
- Migration `ALTER TABLE`s wrapped in `try { } catch (_) { }`.

**Immutability**
- All state and model classes have `final` fields, `const` constructors where possible,
  and a `copyWith`. State is never mutated — always `state = state.copyWith(...)`.

**Async**
- `Future<void>` for commands, `Future<T>` for queries.
- Re-entrancy guards (`bool _isSyncing`, `bool _isAddingShop`) around anything drainable
  or double-submittable.
- Retry caps (`retry_count >= 5 → skip`) instead of unbounded retry.

**Lints** — `include: package:flutter_lints/flutter.yaml`, no custom rules. Note this
include is currently inert because the package isn't installed (§14.5).

---

## 13. New Project Bootstrap Checklist

1. `flutter create <app_name>`; copy `pubspec.yaml` deps from §3, `flutter pub get`.
2. Create the full `lib/` tree from §2 (empty folders + placeholder files).
3. `core/constant.dart` → set `baseUrl`.
4. `core/storage/token_storage.dart` → copy verbatim.
5. `core/network/token_provider.dart` → copy; adjust `TokenState` fields to your auth payload.
6. `core/network/interceptor.dart` → copy; point `_goToLogin()` at your login screen.
7. `core/network/dio_provider.dart` → copy; keep the **bare `authRepoProvider`** split.
8. `core/network/network_service.dart` → copy verbatim.
9. `data/DB/app_database.dart` → define your tables using the standard offline column set (§8.2).
10. `data/api/api_service.dart` → declare endpoints; run `build_runner`.
11. `main.dart` → global `navigatorKey`, pre-`runApp` token load, `ref.read(syncControllerProvider)`.
12. `screens/splash_screen.dart` → auth gate + role routing.
13. `screens/theme.dart` → `AppTheme` palette.
14. Per feature, add the 7 files in order (§10.3) and register the 3 provider entries.
15. `presentation/controllers/sync_controller.dart` → list your offline-capable ViewModels.

---

## 14. Known Defects — Fix These Before Copying

These are actual bugs found in the source, not style opinions. Each one is worth fixing
in the new project (and back-porting here).

### 14.1 🔴 The pre-`runApp` token load is thrown away

`main.dart` loads tokens into a **throwaway** `ProviderContainer` that `ProviderScope`
never sees — `ProviderScope` builds its own container, so the work is discarded (and the
container is never disposed). It only *appears* to work because `SplashScreen` reloads
tokens in `initState`.

```dart
// ❌ current — container is orphaned
final container = ProviderContainer();
await container.read(tokenProvider.notifier).loadTokens();
runApp(ProviderScope(child: ...));

// ✅ fix — hand the warmed container to the tree
final container = ProviderContainer();
await container.read(tokenProvider.notifier).loadTokens();
runApp(
  UncontrolledProviderScope(
    container: container,
    child: const EmployeePortalApp(),
  ),
);
```

Then `SplashScreen` can drop its duplicate `loadTokens()` calls (it currently makes two —
one unawaited in `initState`, one awaited in `checkLogin`).

### 14.2 🔴 `copyWith` silently drops a parameter

`ProductState.copyWith` accepts `AsyncValue<ProductResponse>? addUpdateResponse` but never
assigns it — and `ProductViewModel.addOrUpdateProduct` / `deleteProductSubType` both pass
their error into it. **Those errors vanish.** Either add the field to the state class or
delete the parameter and route errors through the existing `error` field.

### 14.3 🔴 Concurrent 401s trigger N parallel refreshes

`TokenInterceptor` has no mutex. Five in-flight requests that all 401 will fire five
refresh calls; four of them race and the last writer wins — often with an already-rotated
(now invalid) refresh token. Guard with a shared in-flight future:

```dart
class TokenInterceptor extends Interceptor {
  Future<bool>? _refreshing;   // shared across all concurrent 401s

  Future<bool> _refreshOnce() {
    return _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);
  }

  Future<bool> _doRefresh() async {
    final refreshToken = ref.read(tokenProvider).refreshToken;
    if (refreshToken == null || refreshToken.isEmpty) return false;
    try {
      final res = await authRepository.refreshAccessToken(
        TokenResponse(refreshToken: refreshToken),
      );
      await ref.read(tokenProvider.notifier)
          .saveTokens(res.accessToken!, res.refreshToken!, res.roleId ?? 0);
      return true;
    } catch (_) {
      return false;
    }
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    if (err.response?.statusCode != 401) return handler.next(err);

    if (await _refreshOnce()) return _retryRequest(err, handler);

    await ref.read(tokenProvider.notifier).clearTokens();
    _emitSessionExpired();
    return handler.next(err);
  }
}
```

Also add a retry-loop breaker so a 401 *on the retried request* doesn't recurse:

```dart
if (err.requestOptions.extra['__retried'] == true) return handler.next(err);
reqOptions.extra['__retried'] = true;
```

### 14.4 🔴 `isLoggedIn` passes when `roleId` is null

```dart
bool get isLoggedIn => accessToken != null && refreshToken != null && roleId != 0;
//                                                                   ^^^ null != 0 is TRUE
```

A null `roleId` slips through, then `SplashScreen` falls into the `else` branch and routes
to login anyway — so the bug is masked, not absent. Fix:

```dart
bool get isLoggedIn =>
    (accessToken?.isNotEmpty ?? false) &&
    (refreshToken?.isNotEmpty ?? false) &&
    (roleId ?? 0) != 0;
```

### 14.5 🔴 `flutter_lints` is referenced but not installed

`analysis_options.yaml` has `include: package:flutter_lints/flutter.yaml`, but
`flutter_lints` is **not** in `dev_dependencies`. The include fails to resolve, so the
recommended lint set is silently not applied. Add it:

```yaml
dev_dependencies:
  flutter_lints: ^5.0.0
```

### 14.6 🟠 `freezed` is a dead dependency

`freezed` + `freezed_annotation` are declared and are generator-heavy, but no file in
`lib/` uses them. Either remove both, or actually adopt freezed for state classes (§15.2).

### 14.7 🟠 `Timer.periodic(seconds: 1)` connectivity poll

`EnhancedNetworkStateNotifier._init` polls connectivity **every second** for the app's
whole lifetime, on top of an already-active stream subscription. Delete the timer; the
subscription is sufficient. If you want periodic reachability checks, use `checkRealInternet()`
on a 30–60s cadence, not a 1s platform-channel hit.

### 14.8 🟠 Request/response logging leaks tokens in release

`LogInterceptor(requestBody: true, responseBody: true)` prints `Authorization` headers and
full bodies. Gate it:

```dart
if (kDebugMode) {
  dio.interceptors.add(LogInterceptor(requestBody: true, responseBody: true));
}
```

### 14.9 🟠 Silent `catch` blocks hide failures

`sync_controller.dart` has `catch (e) { }` and `VisitImpl.countTodayVisits` has
`catch (e) {}` — completely empty. At minimum log them; a sync that silently never
succeeds is indistinguishable from one that works.

### 14.10 Smaller items

| Issue | Fix |
|---|---|
| `ref.watch(dioProvider).value!` force-unwraps a `FutureProvider` | Make it a plain `Provider<Dio>` — nothing in it is async (§15.1) |
| A fresh `ApiService(dio)` built in **every** repository provider | Reuse `apiServiceProvider` |
| `print(...)` for logging in repositories | Real logger (§15.5) |
| `error: error ?? this.error` can never clear an error | Explicit `bool clearError = false` (§15.3) |
| `ShopState` uses `error: error`, `ProductState` uses `error ?? this.error` | Pick one policy for all states |
| Two color systems (`AppTheme` vs per-screen `_kPrimary`) | Standardize on `AppTheme` |
| Mixed file naming (`employeeMap.dart`, `viewModel_provider.dart`) | All snake_case |
| Interceptor navigates directly via `navigatorKey` | Emit an auth event the UI listens to (§15.6) |
| Imperative `Navigator.pushReplacement` everywhere | `go_router` with a `redirect` on `tokenProvider` (§15.6) |
| `sync_controller` reads `adminloginViewModelProvider` for session data | Move session scope into its own `sessionProvider` (§15.7) |
| Hardcoded `baseUrl` const, dev URL commented out above it | `--dart-define` env config (§15.8) |

---

## 15. Recommended Upgrades (drop-in code)

Improvements to the architecture itself. Ordered by payoff-to-effort.

### 15.1 Make `dioProvider` synchronous

Nothing in the Dio setup is async, so `FutureProvider` + `.value!` buys nothing but risk.

```dart
final dioProvider = Provider<Dio>((ref) {
  final dio = Dio(BaseOptions(baseUrl: Env.baseUrl, /* timeouts, headers */));
  if (kDebugMode) dio.interceptors.add(LogInterceptor(requestBody: true, responseBody: true));
  dio.interceptors.add(TokenInterceptor(dio: dio, ref: ref, authRepository: ref.watch(authRepoProvider)));
  return dio;
});

final apiServiceProvider = Provider<ApiService>((ref) => ApiService(ref.watch(dioProvider)));
```

Every repository provider then simplifies to:

```dart
final productRepositoryProvider = Provider<ProductRepository>((ref) =>
    ProductImpl(ref.watch(apiServiceProvider), ProductDao()));
```

That deletes two lines of boilerplate from every repository provider and removes all `!`.

### 15.2 Generate state classes with `freezed`

`ProductState` is ~40 lines of hand-written `copyWith` that already contains a bug (§14.2).
`freezed` is already a dependency — use it and the whole class becomes:

```dart
@freezed
class ProductState with _$ProductState {
  const factory ProductState({
    @Default(false) bool isLoading,
    String? error,
    @Default(AsyncValue.loading()) AsyncValue<List<Product>> productList,
    @Default(AsyncValue.loading()) AsyncValue<List<ProductData>> productReport,
  }) = _ProductState;
}
```

You get `copyWith`, `==`, `hashCode`, and `toString` for free. Correct `==` matters: Riverpod
skips rebuilds when the new state equals the old one, which the current identity-based
classes can never do.

### 15.3 One error-clearing policy

Hand-written `copyWith` can't distinguish "not passed" from "passed null". Standardize:

```dart
ProductState copyWith({
  bool? isLoading,
  String? error,
  bool clearError = false,          // explicit opt-in to clearing
  AsyncValue<List<Product>>? productList,
}) => ProductState(
  isLoading: isLoading ?? this.isLoading,
  error: clearError ? null : (error ?? this.error),
  productList: productList ?? this.productList,
);
```

Then `state.copyWith(isLoading: true, clearError: true)` at the top of every command.
(With freezed, use `Object? error = _sentinel` instead.)

### 15.4 Collapse the ViewModel boilerplate

Every ViewModel method is the same three beats. Extract it once:

```dart
mixin AsyncGuard<S> on StateNotifier<S> {
  Future<void> guard(
    Future<void> Function() body, {
    required S Function(S s, bool loading) setLoading,
    required S Function(S s, Object e, StackTrace st) setError,
  }) async {
    state = setLoading(state, true);
    try {
      await body();
    } catch (e, st) {
      state = setError(state, e, st);
    } finally {
      state = setLoading(state, false);
    }
  }
}
```

Or, more idiomatically for a full migration, use Riverpod's `AsyncNotifier`, whose
`AsyncValue.guard` does exactly this:

```dart
class ProductNotifier extends AsyncNotifier<List<Product>> {
  @override
  Future<List<Product>> build() =>
      ref.watch(productUsecaseProvider).getAllProducts(_companyId);

  Future<void> refreshList() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() => ref.read(productUsecaseProvider).getAllProducts(_companyId));
  }
}
```

`AsyncNotifier` also gives you `ref.invalidate(...)` for free, replacing the manual
"call the fetch again after a mutation" pattern in `ShopViewModel.addShop`.

### 15.5 Real logging

```dart
// core/logging/app_logger.dart
final log = Logger(printer: PrettyPrinter(methodCount: 0));
```

Replace `print('Remote → Local sync failed')` with `log.w('sync failed', error: e, stackTrace: st)`.
Repositories currently discard the stack trace entirely — always pass it through.

### 15.6 Auth events instead of `navigatorKey`

The interceptor reaching into `navigatorKey` couples the network layer to the widget tree
and makes it untestable. Emit an event; let the UI react.

```dart
// core/network/auth_event_provider.dart
enum AuthEvent { sessionExpired }

final authEventProvider = StateProvider<AuthEvent?>((ref) => null);
```

Interceptor: `ref.read(authEventProvider.notifier).state = AuthEvent.sessionExpired;`

Root widget:

```dart
ref.listen<AuthEvent?>(authEventProvider, (_, next) {
  if (next == AuthEvent.sessionExpired) context.go('/login');
});
```

With `go_router` this collapses further into a `redirect` driven by `tokenProvider`,
which also removes every `Navigator.pushReplacement` in `SplashScreen`:

```dart
final router = GoRouter(
  refreshListenable: ref.watch(tokenListenableProvider),
  redirect: (context, state) {
    final t = ref.read(tokenProvider);
    if (t.isLoading) return '/splash';
    if (!t.isLoggedIn) return '/login';
    return t.roleId == 1 ? '/admin' : '/employee';
  },
  routes: [...],
);
```

### 15.7 A dedicated `sessionProvider`

Session scope (`companyId`, `userId`, `regionId`, `roleId`) is currently read off
`adminloginViewModelProvider` from all over the app — including `sync_controller`, which
has nothing to do with admin login. Give it its own home:

```dart
class Session {
  final String companyId;
  final int userId;
  final int regionId;
  final int roleId;
  const Session({required this.companyId, required this.userId,
                 required this.regionId, required this.roleId});
  bool get isComplete => companyId.isNotEmpty && userId != 0;
}

final sessionProvider = StateNotifierProvider<SessionNotifier, Session>(...);
```

Screens then stop threading `companyId` through every ViewModel call, and the ViewModel
can read it itself.

### 15.8 Environment config instead of a hardcoded const

```dart
// core/constant.dart
class Env {
  static const baseUrl = String.fromEnvironment(
    'BASE_URL',
    defaultValue: 'https://retailpulse.vengurlatech.com/',
  );
}
```

```bash
flutter run --dart-define=BASE_URL=https://staging.example.com/
flutter build apk --release --dart-define=BASE_URL=https://retailpulse.vengurlatech.com/
```

Retrofit's `@RestApi(baseUrl: ...)` needs a true `const`, so `String.fromEnvironment` works
there where `dotenv` would not. This also kills the commented-out dev URL in the source.

### 15.9 Typed error handling at the repository boundary

Right now a `DioException` travels all the way to the UI and gets rendered with
`e.toString()` — users see `DioException [connection error]: ...`. Map it once, at the edge:

```dart
sealed class AppFailure {
  const AppFailure();
  String get message;
}
class NetworkFailure    extends AppFailure { String get message => 'No internet connection.'; }
class ServerFailure     extends AppFailure { final int? code; const ServerFailure(this.code);
                                             String get message => 'Server error${code != null ? ' ($code)' : ''}.'; }
class UnauthorizedFailure extends AppFailure { String get message => 'Session expired. Please log in again.'; }
class UnknownFailure    extends AppFailure { String get message => 'Something went wrong.'; }

AppFailure mapDioError(Object e) {
  if (e is! DioException) return UnknownFailure();
  return switch (e.type) {
    DioExceptionType.connectionError ||
    DioExceptionType.connectionTimeout ||
    DioExceptionType.receiveTimeout ||
    DioExceptionType.sendTimeout        => NetworkFailure(),
    DioExceptionType.badResponse        => e.response?.statusCode == 401
                                              ? UnauthorizedFailure()
                                              : ServerFailure(e.response?.statusCode),
    _                                   => UnknownFailure(),
  };
}
```

The `DioExceptionType` switch already exists inside `ApiStateNotifier` — this just promotes
it to a shared, reusable mapper. ViewModels then store `AppFailure` instead of `String`, and
the UI can branch on the type (show a Retry button only for `NetworkFailure`).

### 15.10 Add a retry interceptor

Transient network blips currently surface as hard errors. `dio_smart_retry` handles this in
one line and pairs naturally with the offline-first repositories:

```dart
dio.interceptors.add(RetryInterceptor(
  dio: dio,
  retries: 3,
  retryDelays: const [Duration(seconds: 1), Duration(seconds: 2), Duration(seconds: 4)],
));
```

Register it **after** `TokenInterceptor` so refreshes aren't retried as ordinary failures.

### 15.11 Replace `retry_count` with exponential backoff

`retry_count >= 5 → skip forever` means a row that hit five transient failures is stranded
permanently with no path back. Add a `next_attempt_at TEXT` column and select on it:

```sql
SELECT * FROM offline_visits
WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
ORDER BY captured_at ASC LIMIT 20
```

On failure, set `next_attempt_at = now + 2^retry_count minutes` (capped). Rows recover on
their own instead of needing an app reinstall.

### 15.12 Foreign keys and indexes in the schema

`product_subtypes.server_product_id` and `offline_order_items.local_order_id` are logical
foreign keys with no constraint and no index — every join is a table scan, and orphan rows
are possible. Enable enforcement and index the join columns:

```dart
openDatabase(
  path,
  version: 11,
  onConfigure: (db) => db.execute('PRAGMA foreign_keys = ON'),
  onCreate: (db, _) async {
    // ...
    await db.execute('CREATE INDEX IF NOT EXISTS idx_order_items_local_order_id '
                     'ON offline_order_items(local_order_id)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_subtypes_server_product_id '
                     'ON product_subtypes(server_product_id)');
  },
);
```

Also note `_createOfflineOrdersTable` and `_createOfflineOrdersItemsTable` use bare
`CREATE TABLE` while every other table uses `CREATE TABLE IF NOT EXISTS` — make them consistent.

### 15.13 Migration discipline

`onUpgrade` currently has a single `if (oldVersion < 10)` branch wrapped in a swallow-all
`try/catch`, which means the migration history before v10 is lost and a failed migration is
invisible. Use sequential, non-swallowing steps:

```dart
onUpgrade: (db, oldVersion, newVersion) async {
  for (var v = oldVersion + 1; v <= newVersion; v++) {
    await _migrations[v]!(db);     // Map<int, Future<void> Function(Database)>
  }
},
```

---

## 16. Testing

The project has **one** test (`test/domain/order_model_test.dart`) — model serialization
only. The layering makes far more than that cheap to test; take advantage of it in the new
project.

```
test/
├── domain/
│   ├── models/           # fromJson/toJson round-trips, defensive-parse edge cases
│   └── usecase/          # usecase with a mock repository
├── data/
│   ├── repositories/     # sync logic with mock ApiService + mock DAO
│   └── local/            # DAOs against sqflite_common_ffi (already a dependency!)
└── presentation/
    └── viewModels/       # state transitions with a mock usecase
```

`sqflite_common_ffi` is already in `dependencies` — that's exactly what lets DAO tests run
on the desktop VM:

```dart
void main() {
  setUpAll(() {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
  });

  test('pending visits drain in captured_at order', () async { ... });
}
```

ViewModel tests need no mocking framework beyond a hand-written fake, because the usecase
is a plain class:

```dart
class _FakeUsecase implements ProductUsecase {
  @override
  Future<List<Product>> getAllProducts(String companyId) async => [Product(productId: 1)];
  // ...
}

test('fetchProductList moves through loading to data', () async {
  final vm = ProductViewModel(_FakeUsecase());
  expect(vm.state.isLoading, false);
  final future = vm.fetchProductList('c1');
  expect(vm.state.isLoading, true);
  await future;
  expect(vm.state.productList?.value, hasLength(1));
});
```

Override providers in widget tests rather than reaching for the network:

```dart
ProviderScope(
  overrides: [productUsecaseProvider.overrideWithValue(_FakeUsecase())],
  child: const MaterialApp(home: CatalogPage()),
);
```

**Highest-value tests to write first**, given where the bugs actually are:
1. Token refresh under concurrent 401s (§14.3).
2. Outbox drain: retry increments, cap behaviour, `pending → syncing → synced` transitions.
3. `syncRemoteToLocal` stale-row deletion — especially the empty-remote-list branch.
4. `Order.fromJson` casing-normalization fallbacks.

---

## 17. Priority Order for a New Project

If you're starting fresh and want the biggest wins first:

| Priority | Change | Section |
|---|---|---|
| 1 | Fix the four 🔴 defects before they get copied forward | §14.1–14.5 |
| 2 | `Provider<Dio>` instead of `FutureProvider`, reuse `apiServiceProvider` | §15.1 |
| 3 | `freezed` state classes (correct `==`, no hand-written `copyWith` bugs) | §15.2 |
| 4 | Env-based `baseUrl`, debug-gated logging | §15.8, §14.8 |
| 5 | Typed `AppFailure` at the repository boundary | §15.9 |
| 6 | `sessionProvider` extracted from the login ViewModel | §15.7 |
| 7 | `go_router` + auth events replacing `navigatorKey` | §15.6 |
| 8 | Backoff + indexes in the offline layer | §15.11, §15.12 |
| 9 | `AsyncNotifier` migration (Riverpod 3 direction) | §15.4 |
| 10 | Test suite across all four layers | §16 |

Everything in §1–§13 is the part worth copying as-is. §14–§15 is what to change on the way out.
