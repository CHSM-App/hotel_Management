import 'package:dio/dio.dart';

import '../../domain/models/asset.dart';
import '../../domain/repository/assets_repo.dart';
import '../api/api_service.dart';

class AssetsImpl implements AssetsRepository {
  final ApiService api;

  AssetsImpl(this.api);

  @override
  Future<List<AssetCategory>> categories() => api.assetCategories();

  @override
  Future<AssetCategory> createCategory(String name) => api.createAssetCategory(name);

  @override
  Future<List<Vendor>> vendors({bool includeInactive = false}) =>
      api.assetVendors(includeInactive: includeInactive);

  @override
  Future<void> createVendor(Map<String, dynamic> body) => api.createAssetVendor(body);

  @override
  Future<void> updateVendor(int id, Map<String, dynamic> body) => api.updateAssetVendor(id, body);

  @override
  Future<List<Asset>> assets({bool includeInactive = false}) =>
      api.assets(includeInactive: includeInactive);

  @override
  Future<Asset> asset(int id) => api.asset(id);

  @override
  Future<Asset> assetByQr(String token) => api.assetByQr(token);

  @override
  Future<Asset> createAsset(FormData form) => api.createAsset(form);

  @override
  Future<List<Asset>> createAssetsBulk(FormData form) => api.createAssetsBulk(form);

  @override
  Future<Asset> updateAsset(int id, FormData form) => api.updateAsset(id, form);

  @override
  Future<Asset> setAssetStatus(int id, String status) => api.setAssetStatus(id, status);

  @override
  Future<void> deleteAsset(int id) => api.deleteAsset(id);

  @override
  Future<Response<List<int>>> assetBill(int id) => api.assetBill(id);

  @override
  Future<List<CoveragePeriod>> coverage(int assetId) => api.assetCoverage(assetId);

  @override
  Future<CoveragePeriod> addCoverage(int assetId, Map<String, dynamic> body) =>
      api.addAssetCoverage(assetId, body);

  @override
  Future<void> deleteCoverage(int assetId, int periodId) =>
      api.deleteAssetCoverage(assetId, periodId);

  @override
  Future<List<WorkOrder>> workOrders({int? assetId, String? status}) =>
      api.workOrders(assetId: assetId, status: status);

  @override
  Future<WorkOrder> createWorkOrder(Map<String, dynamic> body) => api.createWorkOrder(body);

  @override
  Future<List<WorkOrder>> createWorkOrdersBulk(Map<String, dynamic> body) =>
      api.createWorkOrdersBulk(body);

  @override
  Future<WorkOrder> updateWorkOrder(int id, Map<String, dynamic> body) =>
      api.updateWorkOrder(id, body);
}
