import { extractScanCode } from '../src/api/scanLogin';

describe('extractScanCode', () => {
  it('accepts a bare sc_ scan code', () => {
    expect(extractScanCode('sc_abcdef1234')).toBe('sc_abcdef1234');
  });

  it('trims surrounding whitespace', () => {
    expect(extractScanCode('  sc_abcdef1234\n')).toBe('sc_abcdef1234');
  });

  it('extracts sc_ from a ?code= URL form', () => {
    expect(
      extractScanCode('https://www.aliang.one/scan?code=sc_abcdef1234'),
    ).toBe('sc_abcdef1234');
  });

  it('extracts sc_ from a ?scan_code= URL form', () => {
    expect(
      extractScanCode('https://x/qr?scan_code=sc_zzz'),
    ).toBe('sc_zzz');
  });

  it('rejects a dc_ device code (only the PC polls with that)', () => {
    expect(extractScanCode('dc_abcdef1234')).toBeUndefined();
  });

  it('rejects a legacy PAIR- pairing code', () => {
    expect(extractScanCode('PAIR-DESK-8841')).toBeUndefined();
  });

  it('rejects a vibecoding:// device-bind payload', () => {
    expect(
      extractScanCode('vibecoding://bind?name=Mac&pairingCode=PAIR-1234'),
    ).toBeUndefined();
  });

  it('rejects empty / non-sc_ garbage', () => {
    expect(extractScanCode('')).toBeUndefined();
    expect(extractScanCode('hello world')).toBeUndefined();
    expect(extractScanCode('https://example.com/')).toBeUndefined();
  });
});
