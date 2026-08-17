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
 * The Control Center card belongs to a managed beta package or a Mac that has
 * already started using the Control Center. Older local-only installs should
 * not receive a new, irrelevant connection task.
 */
export function shouldShowControlCenterAccess(controlCenter: ControlCenterStatus | undefined): boolean {
  return Boolean(
    controlCenter?.activationRequired
    || (controlCenter?.configured && controlCenter.status !== "unpaired"),
  );
}
