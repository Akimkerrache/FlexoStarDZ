import mongoose, {
  Schema,
  type SchemaOptions,
} from "mongoose";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

export const ObjectId = Schema.Types.ObjectId;

/** Schemas are intentionally loosely typed at the Mongoose layer; request/response shapes are enforced by Zod. */
export function makeSchema(def: Record<string, any>, options: SchemaOptions = {}): Schema<any> {
  const s = new Schema<any>(def, { timestamps: true, ...options } as any);
  s.set("toJSON", {
    versionKey: false,
    transform: (_doc: any, ret: any) => {
      if (ret._id) {
        ret.id = String(ret._id);
        delete ret._id;
      }
      delete ret.passwordHash;
      return ret;
    },
  });
  return s;
}

export const auditFields = {
  createdBy: { type: ObjectId, ref: "User" },
  updatedBy: { type: ObjectId, ref: "User" },
};

/** Soft-deletion: business records are archived, never hard-deleted. */
export const archiveFields = {
  isActive: { type: Boolean, default: true, index: true },
  archivedAt: { type: Date },
};

const counterSchema = new Schema({
  _id: String,
  seq: { type: Number, default: 0 },
});
const Counter =
  mongoose.models.Counter ?? mongoose.model<any>("Counter", counterSchema);

/** Atomic, gap-tolerant sequence generator (safe across concurrent requests). */
export async function nextSequence(key: string): Promise<number> {
  const doc = await Counter.findByIdAndUpdate(
    key,
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  ).lean<{ seq: number }>();
  return doc!.seq;
}

export async function nextCode(
  prefix: string,
  key = prefix,
  pad = 5,
): Promise<string> {
  const n = await nextSequence(key);
  return `${prefix}-${String(n).padStart(pad, "0")}`;
}

export async function connectDb(uri = env.MONGODB_URI) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  logger.info("MongoDB connected");
}

export const disconnectDb = () => mongoose.disconnect();
