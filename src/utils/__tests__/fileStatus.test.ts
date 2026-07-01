import { normalizeFileStatus } from '../fileStatus';

describe('normalizeFileStatus', () => {
  test('clean / undefined / 空 / 未知 → clean', () => {
    expect(normalizeFileStatus('clean')).toBe('clean');
    expect(normalizeFileStatus(undefined)).toBe('clean');
    expect(normalizeFileStatus('')).toBe('clean');
    expect(normalizeFileStatus('garbage')).toBe('clean');
  });

  test('modified / added / deleted 原样透传', () => {
    expect(normalizeFileStatus('modified')).toBe('modified');
    expect(normalizeFileStatus('added')).toBe('added');
    expect(normalizeFileStatus('deleted')).toBe('deleted');
  });

  test('大小写不敏感 + 容错空白', () => {
    expect(normalizeFileStatus('Modified')).toBe('modified');
    expect(normalizeFileStatus(' ADDED ')).toBe('added');
  });
});
