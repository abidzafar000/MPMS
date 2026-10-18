import { z } from "zod";
import type { PmsAction, PmsResponse } from "./pms-types";

export const requestSchema = z.object({
  action: z.string().min(1).max(60).refine(action => action !== "exportBackup", "Backup downloads are no longer available."),
  propertyId: z.string().max(100).optional(),
  version: z.number().int().min(0).optional(),
  payload: z.unknown().optional(),
}).strict();

export function buildPmsRequest(action: PmsAction, payload: unknown, response?: PmsResponse | null) {
  if (action === "exportBackup") throw new Error("Backup downloads are no longer available.");
  // A new property has no saved version yet. Do not send null context from onboarding.
  if (action === "createProperty") return { action, payload };

  const propertyId = response?.state?.property.id;
  const version = response?.version;
  if (!propertyId || typeof version !== "number" || !Number.isInteger(version) || version < 0) {
    throw new Error("Select a property before saving changes.");
  }
  return { action, payload, propertyId, version };
}
