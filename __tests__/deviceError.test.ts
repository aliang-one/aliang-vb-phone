import i18n from '../src/i18n';
import { describeDeviceError } from '../src/utils/deviceError';

describe('describeDeviceError — device binding conflict family', () => {
  it.each([
    ['error code', { code: 'device_id_already_bound' }],
    ['raw server body', new Error('agent server returned 409: {"error":"device_id_already_bound"}')],
    ['pair-route variant', { code: 'device_already_bound' }],
  ])('maps %s to the bound-account copy (offline=false)', (_label, error) => {
    const result = describeDeviceError(error);
    expect(result).not.toBeNull();
    expect(result!.offline).toBe(false);
    expect(result!.title).toBe(i18n.t('common:error.deviceBoundTitle'));
    expect(result!.detail).toBe(i18n.t('common:error.deviceBoundDetail'));
  });

  it('does not swallow unrelated errors', () => {
    expect(describeDeviceError(new Error('network dropped'))).toBeNull();
    expect(describeDeviceError({ code: 'project_path_missing' })).toBeNull();
  });
});
