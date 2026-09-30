// Unit tests for deleteAccount in src/api/auth.
//
// Apple 5.1.1(v): in-app account deletion must hit the server with the
// password in the request body so the backend can verify the caller. A wrong
// password surfaces as a 401 ApiResponseError — the session store relies on
// the rethrow to keep the local session intact.
jest.mock('../src/api/accountClient', () => ({
  accountGet: jest.fn(),
  accountPost: jest.fn(),
  accountDelete: jest.fn(),
}));

import { accountDelete } from '../src/api/accountClient';
import { deleteAccount } from '../src/api/auth';

const accountDeleteMock = accountDelete as jest.MockedFunction<
  typeof accountDelete
>;

describe('deleteAccount', () => {
  beforeEach(() => {
    accountDeleteMock.mockReset();
  });

  it('issues DELETE /api/auth/account with the password in the JSON body, targeting the Go backend directly', async () => {
    accountDeleteMock.mockResolvedValue(undefined);

    await deleteAccount('hunter2');

    expect(accountDeleteMock).toHaveBeenCalledTimes(1);
    expect(accountDeleteMock).toHaveBeenCalledWith(
      '/api/auth/account',
      { password: 'hunter2' },
      { baseUrl: 'https://backend.aliang.one' },
    );
  });

  it('propagates failures (401 wrong password / network) to the caller', async () => {
    accountDeleteMock.mockRejectedValue(
      new Error('DELETE /api/auth/account failed with HTTP 401'),
    );

    await expect(deleteAccount('wrong')).rejects.toThrow(/HTTP 401/);
  });
});
