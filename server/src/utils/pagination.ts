import type { Model, FilterQuery } from "mongoose";
import { z } from "zod";

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .string()
    .regex(/^-?[a-zA-Z0-9_.]+$/)
    .optional(),
  search: z.string().trim().max(100).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

export async function paginate<T>(
  model: Model<T>,
  filter: FilterQuery<T>,
  q: { page: number; limit: number; sort?: string },
  opts: { allowedSort?: string[]; select?: string; populate?: any } = {},
) {
  const sortKey = q.sort?.replace(/^-/, "");
  const sort: Record<string, 1 | -1> =
    q.sort &&
    (!opts.allowedSort || (sortKey && opts.allowedSort.includes(sortKey)))
      ? { [sortKey!]: q.sort.startsWith("-") ? -1 : 1 }
      : { createdAt: -1 };
  let query = model
    .find(filter)
    .sort(sort)
    .skip((q.page - 1) * q.limit)
    .limit(q.limit);
  if (opts.select) query = query.select(opts.select);
  if (opts.populate) query = query.populate(opts.populate);
  const [items, total] = await Promise.all([
    query.exec(),
    model.countDocuments(filter),
  ]);
  return {
    items,
    meta: {
      page: q.page,
      limit: q.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.limit)),
    },
  };
}
