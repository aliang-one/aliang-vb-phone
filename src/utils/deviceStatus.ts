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

/**
 * 「进行中永远置顶」优先于「离线设备沉底」的组合比较器。
 *
 * 2026-10-30 用户拍板的手机端展示顺序:
 *  1. 正在进行中(进行中 / 待审批)的对话**永远是第一组**,哪怕它挂在离线
 *     设备上——离线沉底只是第二位的组织手段,不能把正在跑的会话压到已结算
 *     会话下面;
 *  2. 组内再按「设备在线优先 → fallback」排;fallback 用
 *     `compareSessionsByStableActivity`,进行中组内即「用户提问时刻」倒序。
 *
 * 与直接 `offlineLastComparator(...)` 的区别就在这里:后者先按设备在线状态
 * 分组,离线设备上的进行中会话会被整组沉到底,与用户要求冲突。
 */
export function activeFirstOfflineLastComparator<T>(
  isActive: (item: T) => boolean,
  statusIndex: Map<string, DeviceStatus>,
  getDeviceId: (item: T) => string | undefined,
  fallback: (left: T, right: T) => number,
): (left: T, right: T) => number {
  const byDevice = offlineLastComparator(statusIndex, getDeviceId, fallback);
  return (left, right) => {
    const leftActive = isActive(left);
    const rightActive = isActive(right);
    if (leftActive !== rightActive) return leftActive ? -1 : 1;
    return byDevice(left, right);
  };
}
