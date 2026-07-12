import type { TFunction } from 'i18next';
import { refreshFeedback } from '../refreshFeedback';

// A fake translator that mirrors the production key/interpolation contract:
// `common:refreshSuccess` → fixed string; `common:refreshFailed` → embeds error.
const fakeT = ((key: string, opts?: { error?: string }) => {
  if (key === 'common:refreshSuccess') return 'Refreshed';
  if (key === 'common:refreshFailed') return `Refresh failed: ${opts?.error ?? ''}`;
  return key;
}) as unknown as TFunction;

describe('refreshFeedback', () => {
  test('success outcome → success toast with success message', () => {
    const feedback = refreshFeedback({ ok: true }, fakeT);
    expect(feedback.type).toBe('success');
    expect(feedback.message).toBe('Refreshed');
  });

  test('failure outcome → error toast embedding the error reason', () => {
    const feedback = refreshFeedback(
      { ok: false, error: 'timed out after 8000ms' },
      fakeT,
    );
    expect(feedback.type).toBe('error');
    expect(feedback.message).toBe('Refresh failed: timed out after 8000ms');
  });
});
