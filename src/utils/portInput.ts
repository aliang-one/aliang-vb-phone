// Shared port-mapping input validation (device + project create forms).
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
