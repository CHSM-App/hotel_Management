import 'package:dio/dio.dart';

import '../models/asset.dart';
import '../repository/assets_repo.dart';

class AssetsUsecase {
  final AssetsRepository repository;

  AssetsUsecase(this.repository);

  Future<List<AssetCategory>> categories() => repository.categories();

  Future<void> createCategory(String name) => repository.createCategory(name);

  Future<List<Vendor>> vendors({bool includeInactive = false}) =>
      repository.vendors(includeInactive: includeInactive);

  Future<void> createVendor(Map<String, dynamic> body) => repository.createVendor(body);

  Future<void> updateVendor(int id, Map<String, dynamic> body) =>
      repository.updateVendor(id, body);

  Future<List<Asset>> assets({bool includeInactive = false}) =>
      repository.assets(includeInactive: includeInactive);

  Future<Asset> asset(int id) => repository.asset(id);

  Future<Asset> assetByQr(String token) => repository.assetByQr(token);

  Future<Asset> createAsset(FormData form) => repository.createAsset(form);

  Future<List<Asset>> createAssetsBulk(FormData form) => repository.createAssetsBulk(form);

  Future<Asset> updateAsset(int id, FormData form) => repository.updateAsset(id, form);

  Future<Asset> setAssetStatus(int id, String status) => repository.setAssetStatus(id, status);

  Future<void> deleteAsset(int id) => repository.deleteAsset(id);

  Future<Response<List<int>>> assetBill(int id) => repository.assetBill(id);

  Future<List<CoveragePeriod>> coverage(int assetId) => repository.coverage(assetId);

  Future<CoveragePeriod> addCoverage(int assetId, Map<String, dynamic> body) =>
      repository.addCoverage(assetId, body);

  Future<void> deleteCoverage(int assetId, int periodId) =>
      repository.deleteCoverage(assetId, periodId);

  Future<List<WorkOrder>> workOrders({int? assetId, String? status}) =>
      repository.workOrders(assetId: assetId, status: status);

  Future<WorkOrder> createWorkOrder(Map<String, dynamic> body) => repository.createWorkOrder(body);

  Future<List<WorkOrder>> createWorkOrdersBulk(Map<String, dynamic> body) =>
      repository.createWorkOrdersBulk(body);

  Future<WorkOrder> updateWorkOrder(int id, Map<String, dynamic> body) =>
      repository.updateWorkOrder(id, body);
}
