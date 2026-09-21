import { commandGenErrorText } from '../../src/utils/commandGenErrorText';
import { ApiResponseError } from '../../src/api/client';

const t = (key: string) => key;

describe('commandGenErrorText', () => {
  it('maps known llm_* codes to localized keys', () => {
    expect(commandGenErrorText(new ApiResponseError('gateway timeout', 504, 'llm_timeout'), t)).toBe(
      'voiceBash.error.llmTimeout',
    );
  });

  it('passes through an Error message verbatim', () => {
    expect(commandGenErrorText(new Error('boom'), t)).toBe('boom');
  });

  it('falls back for non-Error values', () => {
    expect(commandGenErrorText('nope', t)).toBe('voiceBash.error.generateFallback');
  });

  it('keeps the raw message for unknown llm_* codes', () => {
    expect(
      commandGenErrorText(new ApiResponseError('upstream broke oddly', 502, 'llm_some_new_code'), t),
    ).toBe('upstream broke oddly');
  });
});
