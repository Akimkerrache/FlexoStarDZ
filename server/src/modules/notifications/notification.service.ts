import { User } from "../users/user.model.js";
import { notifyUsers } from "./notification.model.js";
import type { Permission } from "../../config/permissions.js";

type Payload = {
  type: string;
  title: string;
  body?: string;
  link?: string;
  dedupeKey?: string;
};

export async function notifyStaff(
  permission: Permission,
  payload: Payload,
  excludeUserId?: string,
) {
  const users = await User.find({
    isActive: true,
    $or: [{ role: "admin" }, { role: "manager", permissions: permission }],
  }).select("_id");
  await notifyUsers(
    users.map((u) => u._id).filter((id) => String(id) !== excludeUserId),
    payload,
  );
}

export async function notifyClient(clientId: unknown, payload: Payload) {
  if (!clientId) return;
  const users = await User.find({ isActive: true, clientId }).select("_id");
  await notifyUsers(
    users.map((u) => u._id),
    payload,
  );
}

export async function notifyPrinter(printerId: unknown, payload: Payload) {
  if (!printerId) return;
  const users = await User.find({ isActive: true, printerId }).select("_id");
  await notifyUsers(
    users.map((u) => u._id),
    payload,
  );
}
