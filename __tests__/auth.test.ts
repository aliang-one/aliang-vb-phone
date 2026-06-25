// Unit tests for the refresh-token extraction in src/api/auth.
//
// Regression guard: refreshSessionTokens MUST surface the new access_token from
// the /api/auth/refresh response. An earlier version returned only the
// refresh_token and silently dropped the access_token, so refresh always looked
// successful while the retry kept using the dead token — the phone got stuck on
// the main screen after a 24h access-token expiry. These tests lock the
// contract: both tokens are extracted (envelope or root), and a missing
// access_token is a hard failure, never a silent drop.
jest.mock('../src/api/accountClient', () => ({
  accountGet: jest.fn(),
  accountPost: jest.fn(),
}));

import { accountPost } from '../src/api/accountClient';
import { refreshSessionTokens } from '../src/api/auth';

const accountPostMock = accountPost as jest.MockedFunction<
  typeof accountPost
>;

describe('refreshSessionTokens', () => {
  beforeEach(() => {
    accountPostMock.mockReset();
  });

  it('extracts access_token + refresh_token from the data envelope', async () => {
    accountPostMock.mockResolvedValue({
      code: 0,
      data: {
        access_token: 'at-new',
        refresh_token: 'rt-new',
        token_type: 'Bearer',
        expires_in: 86386,
      },
      message: 'success',
    });

    const result = await refreshSessionTokens('rt-old');

    expect(accountPostMock).toHaveBeenCalledWith(
      '/api/auth/refresh',
      { refresh_token: 'rt-old' },
      { skipRefreshRetry: true },
    );
    expect(result).toEqual({ token: 'at-new', refreshToken: 'rt-new' });
  });

  it('reads tokens at the root when there is no data envelope', async () => {
    accountPostMock.mockResolvedValue({
      access_token: 'at-root',
      refresh_token: 'rt-root',
    });

    const result = await refreshSessionTokens('rt-old');

    expect(result).toEqual({ token: 'at-root', refreshToken: 'rt-root' });
  });

  it('throws when access_token is missing (must not silently drop it)', async () => {
    accountPostMock.mockResolvedValue({
      data: { refresh_token: 'rt-new' },
    });

    await expect(refreshSessionTokens('rt-old')).rejects.toThrow(/access_token/);
  });

  it('throws when refresh_token is missing', async () => {
    accountPostMock.mockResolvedValue({
      data: { access_token: 'at-new' },
    });

    await expect(refreshSessionTokens('rt-old')).rejects.toThrow(/refresh_token/);
  });
});
