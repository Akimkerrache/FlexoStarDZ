import mongoose from "mongoose";
import { makeSchema, ObjectId } from "../../database/index.js";

export const FILE_CATEGORIES = [
  "design",
  "proof",
  "print_ready",
  "document",
  "invoice",
  "delivery_proof",
  "plate_original",
  "plate_corrected",
  "other",
] as const;
export const ACCESS_CLASSES = ["shared", "internal"] as const;

const fileSchema = makeSchema({
  originalName: { type: String, required: true },
  objectKey: { type: String, required: true, unique: true },
  mimeType: { type: String, required: true },
  sizeBytes: { type: Number, required: true, min: 0 },
  checksumSha256: String,
  category: { type: String, enum: FILE_CATEGORIES, default: "design" },
  clientId: { type: ObjectId, ref: "Client", index: true },
  orderId: { type: ObjectId, ref: "Order", index: true },
  plateId: { type: ObjectId, ref: "PhotopolymerPlate", index: true },
  invoiceId: { type: ObjectId, ref: "Invoice" },
  deliveryId: { type: ObjectId, ref: "Delivery" },
  uploadedBy: { type: ObjectId, ref: "User", required: true, index: true },
  version: { type: Number, default: 1 },
  versionGroupId: { type: ObjectId, index: true },
  previousVersionId: { type: ObjectId, ref: "FileAsset" },
  accessClass: { type: String, enum: ACCESS_CLASSES, default: "shared" },
  uploadState: {
    type: String,
    enum: ["pending", "ready", "aborted", "failed"],
    default: "pending",
    index: true,
  },
  uploadMode: { type: String, enum: ["single", "multipart"], required: true },
  multipartUploadId: { type: String, select: false },
  partSizeBytes: Number,
  partCount: Number,
  completedAt: Date,
  archivedAt: Date,
  /** Honest scan state: no scanner is configured, so files are never reported as scanned. */
  scanStatus: { type: String, enum: ["not_scanned"], default: "not_scanned" },
});
fileSchema.index({ originalName: "text" });
export const FileAsset = mongoose.model<any>("FileAsset", fileSchema);
