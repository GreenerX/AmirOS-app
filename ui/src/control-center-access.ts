import type { ControlCenterStatus } from "./types";

/**
 * New managed beta packages may require an approved Mac before displaying the
 * private dashboard. Older local-only copies deliberately remain unaffected.
 */
export function requiresControlCenterActivation(controlCenter: ControlCenterStatus | undefined): boolean {
  if (!controlCenter?.configured || !controlCenter.activationRequired) return false;
  if (controlCenter.setupState !== "active") return true;
  return controlCenter.status !== "active" && controlCenter.status !== "offline_grace";
}

/**
 * A configured Control Center should always offer a visible connection and
 * recovery path. This lets an existing local install pair its Mac on demand
 * without hiding the only way to repair an unpaired connection.
 */
export function shouldShowControlCenterAccess(controlCenter: ControlCenterStatus | undefined): boolean {
  return Boolean(controlCenter?.configured);
}
