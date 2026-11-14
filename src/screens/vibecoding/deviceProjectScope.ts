// Device-scoped project selection for the vibecoding create flow.
//
// Root cause this guards against (fresh-device "message won't send"):
// the create screen used to fall back to `projects[0]?.id` when the selected
// device had no projects of its own. On a brand-new device that fallback hands
// back a project belonging to a DIFFERENT device; the draft then sends a
// foreign `project_id` and the server's POST /api/ai/sessions rejects the turn
// with 404 project_not_found (`inputProject.deviceId !== device.id`) — a check
// that runs BEFORE the create-idempotency claim, so nothing is persisted and
// the failure is invisible server-side. The user just sees "won't send".
//
// The predicate mirrors the server's accessibility rule (project belongs to
// the device directly, or the device advertises it in projectIds).

import type { Device, Project } from '../../data/platformModels';

/** Whether `project` is usable from `device` (same device, or advertised on it). */
export function projectBelongsToDevice(project: Project, device?: Device): boolean {
  if (!device) return false;
  return project.deviceId === device.id || device.projectIds.includes(project.id);
}

/**
 * Initial project for the create screen: scoped to `deviceId`, never
 * cross-device. Empty string = no project selected (custom-path flow).
 */
export function initialProjectIdForDevice(
  projects: Project[],
  deviceId: string,
  devices: Device[],
): string {
  const device = devices.find(item => item.id === deviceId);
  const byProject =
    projects.find(project => project.deviceId === deviceId)?.id ?? '';
  if (byProject) return byProject;
  const byAdvertised = device
    ? (projects.find(project => device.projectIds.includes(project.id))?.id ?? '')
    : '';
  return byAdvertised;
}

/**
 * Resolve the screen's selected project. A projectId that does not belong to
 * the selected device resolves to undefined so startSession falls through to
 * the project_path flow (server upserts a manual project for THIS device)
 * instead of sending a foreign projectId.
 */
export function resolveDeviceScopedProject(
  projects: Project[],
  projectId: string,
  device?: Device,
): Project | undefined {
  if (!projectId) return undefined;
  return projects.find(
    project => project.id === projectId && projectBelongsToDevice(project, device),
  );
}
