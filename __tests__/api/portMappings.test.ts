import { apiDelete, apiGet, apiPost } from '../../src/api/client';
import {
  createPortMapping,
  fetchPortMappings,
  revokePortMapping,
  type PortMapping,
} from '../../src/api/portMappings';

jest.mock('../../src/api/client', () => ({
  apiDelete: jest.fn(),
  apiGet: jest.fn(),
  apiPost: jest.fn(),
}));

const mockedDelete = apiDelete as jest.MockedFunction<typeof apiDelete>;
const mockedGet = apiGet as jest.MockedFunction<typeof apiGet>;
const mockedPost = apiPost as jest.MockedFunction<typeof apiPost>;

const mapping: PortMapping = {
  id: 'pm_1',
  slug: 'short1',
  user_id: 'user_1',
  device_id: 'device_1',
  target_host: '127.0.0.1',
  target_port: 3000,
  upstream_scheme: 'http',
  status: 'active',
  created_at: '2026-07-21T08:00:00.000Z',
  expires_at: '2026-07-21T16:00:00.000Z',
  short_url: 'https://tunnel.example/short1',
};

describe('port mapping API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('unwraps the mapping list response', async () => {
    mockedGet.mockResolvedValue({ mappings: [mapping] });

    await expect(fetchPortMappings()).resolves.toEqual([mapping]);
    expect(mockedGet).toHaveBeenCalledWith('/api/port-mappings');
  });

  it('serializes the create request using the server field names', async () => {
    mockedPost.mockResolvedValue(mapping);

    await createPortMapping({
      deviceId: 'device_1',
      targetHost: '127.0.0.1',
      targetPort: 3000,
      expiresInSeconds: 28_800,
    });

    expect(mockedPost).toHaveBeenCalledWith(
      '/api/port-mappings',
      {
        device_id: 'device_1',
        target_host: '127.0.0.1',
        target_port: 3000,
        expires_in_seconds: 28_800,
      },
      { timeoutMs: 20_000 },
    );
  });

  it('URL-encodes mapping ids when revoking', async () => {
    mockedDelete.mockResolvedValue({ ...mapping, status: 'revoked' });

    await revokePortMapping('pm/unsafe');

    expect(mockedDelete).toHaveBeenCalledWith(
      '/api/port-mappings/pm%2Funsafe',
    );
  });
});
