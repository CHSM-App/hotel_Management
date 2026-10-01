import 'json.dart';

/// A grouping for physical property — "Air conditioners", "Furniture" — see
/// asset_categories in schema.sql. Mirrors AssetsPanel.jsx's category picker.
class AssetCategory {
  final int id;
  final String name;
  final bool isActive;
  final String? depreciationBlock;
  final num? depreciationRatePercent;
  final String depreciationMethod;

  const AssetCategory({
    required this.id,
    this.name = '',
    this.isActive = true,
    this.depreciationBlock,
    this.depreciationRatePercent,
    this.depreciationMethod = 'WDV',
  });

  factory AssetCategory.fromJson(Map<String, dynamic> json) => AssetCategory(
    id: asInt(json['id']),
    name: asStringOrNull(json['name']) ?? '',
    isActive: asBool(json['isActive']),
    depreciationBlock: asStringOrNull(json['depreciationBlock']),
    depreciationRatePercent: asNumOrNull(json['depreciationRatePercent']),
    depreciationMethod: asStringOrNull(json['depreciationMethod']) ?? 'WDV',
  );
}

/// Standard Income Tax Act block rates, offered as a picker when assigning a
/// category's depreciation rate — mirrors IT_ACT_BLOCKS in AssetsPanel.jsx.
const kItActBlocks = <String, num>{
  'Buildings': 10,
  'Furniture & Fixtures': 10,
  'Plant & Machinery': 15,
  'Computers & Software': 40,
  'Motor Vehicles': 15,
};

const kDepreciationMethods = ['WDV', 'SLM'];
const kDepreciationMethodLabel = {
  'WDV': 'Reducing balance (WDV)',
  'SLM': 'Straight-line (SLM)',
};

/// A repair/service payee — shared between Assets and Expenses (one
/// dbo.vendors directory, see vendors/vendors.service.js).
class Vendor {
  final int id;
  final String name;
  final String contactPerson;
  final String phone;
  final String email;
  final String specialty;
  final String notes;
  final bool isActive;

  const Vendor({
    required this.id,
    this.name = '',
    this.contactPerson = '',
    this.phone = '',
    this.email = '',
    this.specialty = '',
    this.notes = '',
    this.isActive = true,
  });

  factory Vendor.fromJson(Map<String, dynamic> json) => Vendor(
    id: asInt(json['id']),
    name: asStringOrNull(json['name']) ?? '',
    contactPerson: asStringOrNull(json['contactPerson']) ?? '',
    phone: asStringOrNull(json['phone']) ?? '',
    email: asStringOrNull(json['email']) ?? '',
    specialty: asStringOrNull(json['specialty']) ?? '',
    notes: asStringOrNull(json['notes']) ?? '',
    isActive: asBool(json['isActive']),
  );
}

/// One tracked item — a fridge, a generator, a sofa. Mirrors mapAsset in
/// assets.service.js field-for-field.
class Asset {
  final int id;
  final String name;
  final int categoryId;
  final String categoryName;
  final String? assetTag;
  final String brand;
  final String model;
  final String serialNumber;
  final String purchaseDate;
  final num? purchaseCost;
  final int? roomId;
  final String? roomNumber;
  final String floor;
  final String department;
  final String locationNote;
  final int? vendorId;
  final String? vendorName;
  final String? warrantyExpiry;
  final String? amcExpiry;
  final String? amcCoverageNote;
  final bool hasBillDocument;
  final String status;
  final String? qrToken;
  final bool isActive;
  final int openWorkOrders;
  final String? deadDate;
  final String? deadReason;
  final String? disposalNote;
  final num? recoveryCost;
  final String? disposedBy;

  const Asset({
    required this.id,
    this.name = '',
    this.categoryId = 0,
    this.categoryName = '',
    this.assetTag,
    this.brand = '',
    this.model = '',
    this.serialNumber = '',
    this.purchaseDate = '',
    this.purchaseCost,
    this.roomId,
    this.roomNumber,
    this.floor = '',
    this.department = '',
    this.locationNote = '',
    this.vendorId,
    this.vendorName,
    this.warrantyExpiry,
    this.amcExpiry,
    this.amcCoverageNote,
    this.hasBillDocument = false,
    this.status = 'IN_USE',
    this.qrToken,
    this.isActive = true,
    this.openWorkOrders = 0,
    this.deadDate,
    this.deadReason,
    this.disposalNote,
    this.recoveryCost,
    this.disposedBy,
  });

  factory Asset.fromJson(Map<String, dynamic> json) => Asset(
    id: asInt(json['id']),
    name: asStringOrNull(json['name']) ?? '',
    categoryId: asInt(json['categoryId']),
    categoryName: asStringOrNull(json['categoryName']) ?? '',
    assetTag: asStringOrNull(json['assetTag']),
    brand: asStringOrNull(json['brand']) ?? '',
    model: asStringOrNull(json['model']) ?? '',
    serialNumber: asStringOrNull(json['serialNumber']) ?? '',
    purchaseDate: asStringOrNull(json['purchaseDate']) ?? '',
    purchaseCost: asNumOrNull(json['purchaseCost']),
    roomId: asIntOrNull(json['roomId']),
    roomNumber: asStringOrNull(json['roomNumber']),
    floor: asStringOrNull(json['floor']) ?? '',
    department: asStringOrNull(json['department']) ?? '',
    locationNote: asStringOrNull(json['locationNote']) ?? '',
    vendorId: asIntOrNull(json['vendorId']),
    vendorName: asStringOrNull(json['vendorName']),
    warrantyExpiry: asStringOrNull(json['warrantyExpiry']),
    amcExpiry: asStringOrNull(json['amcExpiry']),
    amcCoverageNote: asStringOrNull(json['amcCoverageNote']),
    hasBillDocument: asBool(json['hasBillDocument']),
    status: asStringOrNull(json['status']) ?? 'IN_USE',
    qrToken: asStringOrNull(json['qrToken']),
    isActive: asBool(json['isActive']),
    openWorkOrders: asInt(json['openWorkOrders']),
    deadDate: asStringOrNull(json['deadDate']),
    deadReason: asStringOrNull(json['deadReason']),
    disposalNote: asStringOrNull(json['disposalNote']),
    recoveryCost: asNumOrNull(json['recoveryCost']),
    disposedBy: asStringOrNull(json['disposedBy']),
  );
}

const kAssetStatuses = ['IN_USE', 'UNDER_REPAIR', 'RETIRED'];

const kAssetStatusLabel = {
  'IN_USE': 'In use',
  'UNDER_REPAIR': 'Under repair',
  'RETIRED': 'Retired',
};

/// One warranty or AMC stretch on an asset's coverage history. Mirrors
/// mapCoveragePeriod in assets.service.js.
class CoveragePeriod {
  final int id;
  final int assetId;
  final String coverageType; // WARRANTY | AMC
  final int? vendorId;
  final String? vendorName;
  final String? startDate;
  final String endDate;
  final num? cost;
  final String coverageNote;
  final String createdAt;

  const CoveragePeriod({
    required this.id,
    this.assetId = 0,
    this.coverageType = 'WARRANTY',
    this.vendorId,
    this.vendorName,
    this.startDate,
    this.endDate = '',
    this.cost,
    this.coverageNote = '',
    this.createdAt = '',
  });

  factory CoveragePeriod.fromJson(Map<String, dynamic> json) => CoveragePeriod(
    id: asInt(json['id']),
    assetId: asInt(json['assetId']),
    coverageType: asStringOrNull(json['coverageType']) ?? 'WARRANTY',
    vendorId: asIntOrNull(json['vendorId']),
    vendorName: asStringOrNull(json['vendorName']),
    startDate: asStringOrNull(json['startDate']),
    endDate: asStringOrNull(json['endDate']) ?? '',
    cost: asNumOrNull(json['cost']),
    coverageNote: asStringOrNull(json['coverageNote']) ?? '',
    createdAt: json['createdAt']?.toString() ?? '',
  );
}

/// A breakdown or routine-service ticket against one asset. Mirrors
/// mapWorkOrder in assets.service.js.
class WorkOrder {
  final int id;
  final int assetId;
  final String assetName;
  final String issueType; // BREAKDOWN | ROUTINE_SERVICE
  final String description;
  final String status; // OPEN | IN_PROGRESS | CLOSED
  final int? reportedBy;
  final String? reportedByName;
  final String assignedToName;
  final int? vendorId;
  final String? vendorName;
  final num? partsCost;
  final num? laborCost;
  final String partsUsedNote;
  final bool isWarrantyClaim;
  final String resolutionNote;
  final String openedAt;
  final String? closedAt;

  const WorkOrder({
    required this.id,
    this.assetId = 0,
    this.assetName = '',
    this.issueType = 'BREAKDOWN',
    this.description = '',
    this.status = 'OPEN',
    this.reportedBy,
    this.reportedByName,
    this.assignedToName = '',
    this.vendorId,
    this.vendorName,
    this.partsCost,
    this.laborCost,
    this.partsUsedNote = '',
    this.isWarrantyClaim = false,
    this.resolutionNote = '',
    this.openedAt = '',
    this.closedAt,
  });

  factory WorkOrder.fromJson(Map<String, dynamic> json) => WorkOrder(
    id: asInt(json['id']),
    assetId: asInt(json['assetId']),
    assetName: asStringOrNull(json['assetName']) ?? '',
    issueType: asStringOrNull(json['issueType']) ?? 'BREAKDOWN',
    description: asStringOrNull(json['description']) ?? '',
    status: asStringOrNull(json['status']) ?? 'OPEN',
    reportedBy: asIntOrNull(json['reportedBy']),
    reportedByName: asStringOrNull(json['reportedByName']),
    assignedToName: asStringOrNull(json['assignedToName']) ?? '',
    vendorId: asIntOrNull(json['vendorId']),
    vendorName: asStringOrNull(json['vendorName']),
    partsCost: asNumOrNull(json['partsCost']),
    laborCost: asNumOrNull(json['laborCost']),
    partsUsedNote: asStringOrNull(json['partsUsedNote']) ?? '',
    isWarrantyClaim: asBool(json['isWarrantyClaim']),
    resolutionNote: asStringOrNull(json['resolutionNote']) ?? '',
    openedAt: json['openedAt']?.toString() ?? '',
    closedAt: json['closedAt']?.toString(),
  );
}

const kWorkOrderStatuses = ['OPEN', 'IN_PROGRESS', 'CLOSED'];
const kWorkOrderStatusLabel = {
  'OPEN': 'Open',
  'IN_PROGRESS': 'In progress',
  'CLOSED': 'Closed',
};
const kIssueTypeLabel = {
  'BREAKDOWN': 'Breakdown',
  'ROUTINE_SERVICE': 'Routine service',
};
