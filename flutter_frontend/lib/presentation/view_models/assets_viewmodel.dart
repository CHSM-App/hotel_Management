library;

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_error_message.dart';
import '../../domain/models/asset.dart';
import '../../domain/usecase/assets_usecase.dart';

/// Asset inventory — one notifier for the whole section (register, work
/// orders, setup), the way AssetsPanel.jsx keeps categories/vendors/assets
/// state in one component. [bumps] plays the part it does in EventsState:
/// anything that changes an asset increments it so a detail view re-reads.
class AssetsState {
  final bool isLoading;
  final String? error;
  final List<Asset> assets;
  final List<AssetCategory> categories;
  final List<Vendor> vendors;
  final List<WorkOrder> workOrders;
  final bool catalogueLoading;
  final bool submitting;
  final int bumps;

  const AssetsState({
    this.isLoading = false,
    this.error,
    this.assets = const [],
    this.categories = const [],
    this.vendors = const [],
    this.workOrders = const [],
    this.catalogueLoading = false,
    this.submitting = false,
    this.bumps = 0,
  });

  AssetsState copyWith({
    bool? isLoading,
    String? error,
    bool clearError = false,
    List<Asset>? assets,
    List<AssetCategory>? categories,
    List<Vendor>? vendors,
    List<WorkOrder>? workOrders,
    bool? catalogueLoading,
    bool? submitting,
    int? bumps,
  }) => AssetsState(
    isLoading: isLoading ?? this.isLoading,
    error: clearError ? null : (error ?? this.error),
    assets: assets ?? this.assets,
    categories: categories ?? this.categories,
    vendors: vendors ?? this.vendors,
    workOrders: workOrders ?? this.workOrders,
    catalogueLoading: catalogueLoading ?? this.catalogueLoading,
    submitting: submitting ?? this.submitting,
    bumps: bumps ?? this.bumps,
  );

  List<AssetCategory> get activeCategories => categories.where((c) => c.isActive).toList();

  List<Vendor> get activeVendors => vendors.where((v) => v.isActive).toList();

  int get openWorkOrderCount => workOrders.where((w) => w.status != 'CLOSED').length;
}

class AssetsViewModel extends StateNotifier<AssetsState> {
  final AssetsUsecase usecase;

  AssetsViewModel(this.usecase) : super(const AssetsState());

  Future<void> loadAssets({bool includeInactive = false}) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final assets = await usecase.assets(includeInactive: includeInactive);
      state = state.copyWith(isLoading: false, assets: assets);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: apiErrorMessage(e));
    }
  }

  Future<void> loadCatalogue() async {
    state = state.copyWith(catalogueLoading: true, clearError: true);
    try {
      final results = await Future.wait([
        usecase.categories(),
        usecase.vendors(includeInactive: true),
        usecase.workOrders(),
      ]);
      state = state.copyWith(
        catalogueLoading: false,
        categories: results[0] as List<AssetCategory>,
        vendors: results[1] as List<Vendor>,
        workOrders: results[2] as List<WorkOrder>,
      );
    } catch (e) {
      state = state.copyWith(catalogueLoading: false, error: apiErrorMessage(e));
    }
  }

  void _bump() => state = state.copyWith(bumps: state.bumps + 1);

  // ── Setup: categories & vendors ────────────────────────────────────────

  Future<bool> saveCategory(String name) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      await usecase.createCategory(name);
      state = state.copyWith(submitting: false);
      await loadCatalogue();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> saveVendor(Map<String, dynamic> body, {int? id}) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      if (id != null) {
        await usecase.updateVendor(id, body);
      } else {
        await usecase.createVendor(body);
      }
      state = state.copyWith(submitting: false);
      await loadCatalogue();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  // ── Assets ────────────────────────────────────────────────────────────

  Future<Asset?> fetchAsset(int id) async {
    try {
      return await usecase.asset(id);
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return null;
    }
  }

  Future<bool> saveAsset(FormData form, {int? id}) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      if (id != null) {
        await usecase.updateAsset(id, form);
      } else {
        await usecase.createAsset(form);
      }
      state = state.copyWith(submitting: false);
      _bump();
      await loadAssets();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> saveAssetsBulk(FormData form) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      await usecase.createAssetsBulk(form);
      state = state.copyWith(submitting: false);
      _bump();
      await loadAssets();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> setStatus(int id, String status) async {
    try {
      await usecase.setAssetStatus(id, status);
      _bump();
      await loadAssets();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> deleteAsset(int id) async {
    try {
      await usecase.deleteAsset(id);
      _bump();
      await loadAssets();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }

  // ── Coverage (warranty / AMC) ────────────────────────────────────────

  Future<List<CoveragePeriod>> coverage(int assetId) async {
    try {
      return await usecase.coverage(assetId);
    } catch (_) {
      return const [];
    }
  }

  Future<bool> addCoverage(int assetId, Map<String, dynamic> body) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      await usecase.addCoverage(assetId, body);
      state = state.copyWith(submitting: false);
      _bump();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> deleteCoverage(int assetId, int periodId) async {
    try {
      await usecase.deleteCoverage(assetId, periodId);
      _bump();
      return true;
    } catch (e) {
      state = state.copyWith(error: apiErrorMessage(e));
      return false;
    }
  }

  // ── Work orders ───────────────────────────────────────────────────────

  Future<bool> saveWorkOrder(Map<String, dynamic> body) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      await usecase.createWorkOrder(body);
      state = state.copyWith(submitting: false);
      _bump();
      await loadCatalogue();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> saveWorkOrdersBulk(Map<String, dynamic> body) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      await usecase.createWorkOrdersBulk(body);
      state = state.copyWith(submitting: false);
      _bump();
      await loadCatalogue();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  Future<bool> updateWorkOrder(int id, Map<String, dynamic> body) async {
    state = state.copyWith(submitting: true, clearError: true);
    try {
      await usecase.updateWorkOrder(id, body);
      state = state.copyWith(submitting: false);
      _bump();
      await loadCatalogue();
      return true;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiErrorMessage(e));
      return false;
    }
  }

  void clearError() => state = state.copyWith(clearError: true);
}
