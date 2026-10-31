import { activeFirstOfflineLastComparator, offlineLastComparator } from '../deviceStatus';
import type { DeviceStatus } from '../../data/platformModels';

type Item = { id: string; deviceId: string; active: boolean; rank: number };

const statusIndex = new Map<string, DeviceStatus>([
  ['dev-online', 'online'],
  ['dev-offline', 'offline'],
]);

const item = (id: string, deviceId: string, active: boolean, rank: number): Item => ({
  id,
  deviceId,
  active,
  rank,
});

// 组内 fallback:rank 大的在前
const byRankDesc = (left: Item, right: Item) => right.rank - left.rank;

const ids = (items: Item[]) => items.map(entry => entry.id);

describe('offlineLastComparator(原有行为:离线设备沉底)', () => {
  it('离线设备的条目沉到最后,组内按 fallback', () => {
    const sorted = [
      item('offline-new', 'dev-offline', false, 9),
      item('online-old', 'dev-online', false, 1),
      item('online-new', 'dev-online', false, 5),
    ].sort(offlineLastComparator(statusIndex, entry => entry.deviceId, byRankDesc));
    expect(ids(sorted)).toEqual(['online-new', 'online-old', 'offline-new']);
  });
});

describe('activeFirstOfflineLastComparator(2026-10-30:进行中永远置顶)', () => {
  const compare = activeFirstOfflineLastComparator(
    (entry: Item) => entry.active,
    statusIndex,
    entry => entry.deviceId,
    byRankDesc,
  );

  it('离线设备上的进行中会话仍压在在线设备的已结算会话之上', () => {
    const sorted = [
      item('online-done', 'dev-online', false, 99),
      item('offline-running', 'dev-offline', true, 1),
    ].sort(compare);
    expect(ids(sorted)).toEqual(['offline-running', 'online-done']);
  });

  it('进行中组内:组内先让离线设备沉底,再按 fallback', () => {
    const sorted = [
      item('running-offline', 'dev-offline', true, 99),
      item('running-online-old', 'dev-online', true, 1),
      item('running-online-new', 'dev-online', true, 5),
    ].sort(compare);
    expect(ids(sorted)).toEqual([
      'running-online-new',
      'running-online-old',
      'running-offline',
    ]);
  });

  it('已结算组内保留「在线优先 → fallback」', () => {
    const sorted = [
      item('done-offline', 'dev-offline', false, 99),
      item('done-online', 'dev-online', false, 1),
    ].sort(compare);
    expect(ids(sorted)).toEqual(['done-online', 'done-offline']);
  });
});
