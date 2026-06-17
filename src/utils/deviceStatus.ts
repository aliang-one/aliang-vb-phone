import { Device, DeviceStatus } from '../data/platformModels';

/** 快速按 deviceId 查设备在线状态，避免在排序比较器里反复 `.find`。 */
export const buildDeviceStatusIndex = (
  devices: Device[],
): Map<string, DeviceStatus> =>
  new Map(devices.map(device => [device.id, device.status]));

export const isDeviceStatusOffline = (status?: DeviceStatus): boolean =>
  status === 'offline';

/**
 * 生成一个排序比较器：离线设备相关条目沉到最后，组内顺序由 fallback 决定。
 * 未知 / 缺失的 deviceId 视为非离线（不误锁）。
 */
export function offlineLastComparator<T>(
  statusIndex: Map<string, DeviceStatus>,
  getDeviceId: (item: T) => string | undefined,
  fallback: (left: T, right: T) => number,
): (left: T, right: T) => number {
  return (left, right) => {
    const leftOffline = isDeviceStatusOffline(
      statusIndex.get(getDeviceId(left) ?? ''),
    );
    const rightOffline = isDeviceStatusOffline(
      statusIndex.get(getDeviceId(right) ?? ''),
    );
    if (leftOffline !== rightOffline) {
      return leftOffline ? 1 : -1;
    }
    return fallback(left, right);
  };
}
