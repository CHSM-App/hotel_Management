import 'package:dio/dio.dart';

import '../models/asset.dart';

/// Asset inventory — mirrors AssetsPanel.jsx.
abstract class AssetsRepository {
  Future<List<AssetCategory>> categories();

  Future<AssetCategory> createCategory(String name);

  Future<List<Vendor>> vendors({bool includeInactive = false});

  Future<void> createVendor(Map<String, dynamic> body);

  Future<void> updateVendor(int id, Map<String, dynamic> body);

  Future<List<Asset>> assets({bool includeInactive = false});

  Future<Asset> asset(int id);

  Future<Asset> assetByQr(String token);

  Future<Asset> createAsset(FormData form);

  Future<List<Asset>> createAssetsBulk(FormData form);

  Future<Asset> updateAsset(int id, FormData form);

  Future<Asset> setAssetStatus(int id, String status);

  Future<void> deleteAsset(int id);

  Future<Response<List<int>>> assetBill(int id);

  Future<List<CoveragePeriod>> coverage(int assetId);

  Future<CoveragePeriod> addCoverage(int assetId, Map<String, dynamic> body);

  Future<void> deleteCoverage(int assetId, int periodId);

  Future<List<WorkOrder>> workOrders({int? assetId, String? status});

  Future<WorkOrder> createWorkOrder(Map<String, dynamic> body);

  Future<List<WorkOrder>> createWorkOrdersBulk(Map<String, dynamic> body);

  Future<WorkOrder> updateWorkOrder(int id, Map<String, dynamic> body);
}
