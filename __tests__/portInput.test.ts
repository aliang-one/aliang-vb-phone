import { isAllowedTargetHost, parsePort } from '../src/utils/portInput';

describe('isAllowedTargetHost', () => {
  it('accepts localhost and ::1', () => {
    expect(isAllowedTargetHost('localhost')).toBe(true);
    expect(isAllowedTargetHost('::1')).toBe(true);
  });

  it('accepts loopback and private ranges', () => {
    expect(isAllowedTargetHost('127.0.0.1')).toBe(true);
    expect(isAllowedTargetHost('10.0.0.5')).toBe(true);
    expect(isAllowedTargetHost('10.255.255.255')).toBe(true);
    expect(isAllowedTargetHost('172.16.0.1')).toBe(true);
    expect(isAllowedTargetHost('172.31.255.254')).toBe(true);
    expect(isAllowedTargetHost('192.168.1.10')).toBe(true);
    expect(isAllowedTargetHost('192.168.0.1')).toBe(true);
  });

  it('rejects public IPs', () => {
    expect(isAllowedTargetHost('8.8.8.8')).toBe(false);
    expect(isAllowedTargetHost('172.32.0.1')).toBe(false);
    expect(isAllowedTargetHost('172.15.0.1')).toBe(false);
    expect(isAllowedTargetHost('11.0.0.1')).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(isAllowedTargetHost('1.2.3')).toBe(false);
    expect(isAllowedTargetHost('1.2.3.4.5')).toBe(false);
    expect(isAllowedTargetHost('256.1.1.1')).toBe(false);
    expect(isAllowedTargetHost('1.2.3.a')).toBe(false);
    expect(isAllowedTargetHost('')).toBe(false);
  });

  it('trims and lowercases before checking', () => {
    expect(isAllowedTargetHost('  LOCALHOST  ')).toBe(true);
    expect(isAllowedTargetHost(' 192.168.1.2 ')).toBe(true);
  });
});

describe('parsePort', () => {
  it('accepts boundary ports', () => {
    expect(parsePort('1')).toBe(1);
    expect(parsePort('65535')).toBe(65535);
    expect(parsePort('3000')).toBe(3000);
  });

  it('rejects out-of-range and non-numeric values', () => {
    expect(parsePort('0')).toBeNull();
    expect(parsePort('65536')).toBeNull();
    expect(parsePort('abc')).toBeNull();
    expect(parsePort('')).toBeNull();
    expect(parsePort('12a')).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(parsePort(' 8080 ')).toBe(8080);
  });
});
