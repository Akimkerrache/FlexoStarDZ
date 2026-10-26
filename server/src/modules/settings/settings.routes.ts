import { Router } from "express";
import { env } from "../../config/env.js";
import { PERMISSIONS } from "../../config/permissions.js";
import { asyncHandler, ok } from "../../utils/http.js";
import { authenticate } from "../../middleware/index.js";
import { ORDER_STATUSES, TRANSITIONS } from "../orders/order.rules.js";
import {
  PLATE_STATUSES,
  PLATE_TRANSITIONS,
} from "../photopolymer-plates/plate.model.js";

const router = Router();
router.use(authenticate);

/** Non-secret runtime rules the dashboard needs for validation and display. */
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    ok(res, {
      jobNameRejectArabic: env.JOB_NAME_REJECT_ARABIC,
      colorCountIncludesPantone: env.COLOR_COUNT_INCLUDES_PANTONE,
      defaultCurrency: env.DEFAULT_CURRENCY,
      maxUploadSizeMb: env.MAX_UPLOAD_SIZE_MB,
      maxSingleUploadSizeMb: env.MAX_SINGLE_UPLOAD_SIZE_MB,
      storageConfigured: !!(
        env.R2_BUCKET_NAME &&
        env.R2_ACCESS_KEY_ID &&
        env.R2_SECRET_ACCESS_KEY &&
        (env.R2_ENDPOINT || env.R2_ACCOUNT_ID)
      ),
      permissions: PERMISSIONS,
      orderStatuses: ORDER_STATUSES,
      orderTransitions: Object.fromEntries(
        Object.entries(TRANSITIONS).map(([k, v]) => [k, v.map((e) => e.to)]),
      ),
      plateStatuses: PLATE_STATUSES,
      plateTransitions: PLATE_TRANSITIONS,
      alertScanIntervalMinutes: env.ALERT_SCAN_INTERVAL_MINUTES,
    });
  }),
);

export default router;
