import { fetchPortMappings, createPortMapping } from '../src/api/portMappings';
import { apiGet, apiPost } from '../src/api/client';

jest.mock('../src/api/client', () => ({
  apiGet: jest.fn().mockResolvedValue({ mappings: [] }),
  apiPost: jest.fn().mockResolvedValue({}),
  apiDelete: jest.fn(),
}));

describe('portMappings api', () => {
  it('builds device_id and project_id query params together', async () => {
    await fetchPortMappings({ deviceId: 'd1', projectId: 'p1' });
    expect(apiGet).toHaveBeenCalledWith('/api/port-mappings?device_id=d1&project_id=p1');
  });

  it('requests the bare path without params', async () => {
    await fetchPortMappings();
    expect(apiGet).toHaveBeenCalledWith('/api/port-mappings');
  });

  it('forwards project_id on create', async () => {
    await createPortMapping({
      deviceId: 'd1',
      targetHost: '127.0.0.1',
      targetPort: 3000,
      expiresInSeconds: 3600,
      projectId: 'p1',
    });
    expect(apiPost).toHaveBeenCalledWith(
      '/api/port-mappings',
      expect.objectContaining({ device_id: 'd1', project_id: 'p1' }),
      expect.anything(),
    );
  });
});
