import mongoose from "mongoose";
import {
  makeSchema,
  archiveFields,
  auditFields,
  ObjectId,
} from "../../database/index.js";

/**
 * Inventory is ARCHITECTURE ONLY in this release: schemas exist so the module can be added without
 * migrating existing data, but no API routes or UI are exposed until Flexostar confirms the scope
 * (open decision #10).
 */
const inventoryItemSchema = makeSchema({
  sku: { type: String, required: true, unique: true, uppercase: true },
  name: { type: String, required: true },
  catalogItemId: { type: ObjectId, ref: "CatalogItem" },
  unit: { type: String, default: "unit" },
  quantityOnHand: { type: Number, default: 0 },
  quantityReserved: { type: Number, default: 0 },
  alertThreshold: { type: Number, default: 0 },
  ...archiveFields,
  ...auditFields,
});
export const InventoryItem = mongoose.model<any>(
  "InventoryItem",
  inventoryItemSchema,
);

const stockMovementSchema = makeSchema({
  itemId: { type: ObjectId, ref: "InventoryItem", required: true, index: true },
  type: {
    type: String,
    enum: ["in", "out", "reserve", "release", "adjustment"],
    required: true,
  },
  quantity: { type: Number, required: true },
  orderId: { type: ObjectId, ref: "Order" },
  supplierId: { type: ObjectId, ref: "Supplier" },
  reason: String,
  ...auditFields,
});
export const StockMovement = mongoose.model<any>(
  "StockMovement",
  stockMovementSchema,
);
