import mongoose, { type InferSchemaType } from "mongoose";
import { makeSchema, ObjectId } from "../../database/index.js";
import { PERMISSIONS, ROLES } from "../../config/permissions.js";

const userSchema = makeSchema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ROLES, required: true, index: true },
  isActive: { type: Boolean, default: true, index: true },
  lastLoginAt: Date,
  clientId: { type: ObjectId, ref: "Client", index: true },
  printerId: { type: ObjectId, ref: "Printer", index: true },
  managerProfileId: { type: ObjectId, ref: "ManagerProfile" },
  permissions: { type: [String], enum: PERMISSIONS, default: [] },
  tokenVersion: { type: Number, default: 0 },
  mustChangePassword: { type: Boolean, default: false },
  language: { type: String, enum: ["en", "ar"], default: "en" },
  createdBy: { type: ObjectId, ref: "User" },
});

export type UserDoc = InferSchemaType<typeof userSchema> & {
  _id: mongoose.Types.ObjectId;
};
export const User = mongoose.model<any>("User", userSchema);

const refreshSchema = makeSchema({
  userId: { type: ObjectId, ref: "User", required: true, index: true },
  jti: { type: String, required: true, unique: true },
  family: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true },
  revokedAt: Date,
  replacedBy: String,
});
refreshSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const RefreshToken = mongoose.model<any>("RefreshToken", refreshSchema);
