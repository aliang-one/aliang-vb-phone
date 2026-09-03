// Shared port-mapping helpers (device + project create forms).
import { ApiResponseError } from '../api/client';

export const isAllowedTargetHost = (input: string) => {
  const host = input.trim().toLowerCase();
  if (host === 'localhost' || host === '::1') return true;
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part))) {
    return false;
  }
  const octets = parts.map(Number);
  if (octets.some(octet => octet < 0 || octet > 255)) return false;
  if (octets[0] === 127 || octets[0] === 10) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  return octets[0] === 192 && octets[1] === 168;
};

export const parsePort = (input: string) => {
  if (!/^\d+$/.test(input.trim())) return null;
  const port = Number(input);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
};

// Expiry presets shared by the device screen and the project section. Labels
// live in the devices namespace (portMappings.expiry1h/8h/24h/7d).
export const EXPIRY_OPTIONS = [
  { seconds: 3_600, labelKey: 'portMappings.expiry1h' },
  { seconds: 28_800, labelKey: 'portMappings.expiry8h' },
  { seconds: 86_400, labelKey: 'portMappings.expiry24h' },
  { seconds: 604_800, labelKey: 'portMappings.expiry7d' },
] as const;

export const mappingErrorKey = (error: unknown, fallbackKey: string) => {
  if (
    error instanceof ApiResponseError &&
    [
      'tunnel_service_unavailable',
      'tunnel_gateway_unavailable',
      'tunnel_gateway_error',
    ].includes(error.code ?? '')
  ) {
    return 'portMappings.serviceUnavailable';
  }
  return fallbackKey;
};
