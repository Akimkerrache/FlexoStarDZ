import mongoose from "mongoose";
import { makeSchema, ObjectId } from "../../database/index.js";

const notificationSchema = makeSchema({
  userId: { type: ObjectId, ref: "User", required: true, index: true },
  type: {
    type: String,
    required: true,
    enum: [
      "order_status",
      "order_assigned",
      "order_overdue",
      "approval_pending",
      "delivery_expected",
      "invoice_unpaid",
      "supplier_deadline",
      "non_conformity",
      "system",
    ],
  },
  title: { type: String, required: true },
  body: String,
  link: String,
  /** De-duplicates recurring alerts (e.g. one overdue alert per order per day). */
  dedupeKey: { type: String },
  readAt: Date,
});
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
notificationSchema.index(
  { userId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } },
);
export const Notification = mongoose.model<any>("Notification", notificationSchema);

export async function notifyUsers(
  userIds: unknown[],
  n: {
    type: string;
    title: string;
    body?: string;
    link?: string;
    dedupeKey?: string;
  },
) {
  const unique = [...new Set(userIds.filter(Boolean).map(String))];
  await Promise.all(
    unique.map((userId) =>
      Notification.create({ userId, ...n }).catch((e) => {
        if (e?.code !== 11000) throw e; // duplicate dedupeKey: already notified
      }),
    ),
  );
}
