// Task 17 (TDD red): COS presigned GET → phone system save.
// Contract under test:
//   1. Android: DownloadManager route — config({ addAndroidDownloads: {
//      useDownloadManager, title, description, mime, mediaScannable,
//      notification } }) + .fetch('GET', url); Share sheet never involved.
//   2. iOS: explicit-path download — config({ path: CacheDir + '/' +
//      filename }) + .fetch('GET', url). The tmp file is named after the
//      source file so the share sheet AND "Save to Files" keep the original
//      filename (fileCache would land a random tmp name). No fileCache /
//      appendExt (path already carries the full filename). Chinese/space
//      filenames pass through verbatim; path separators are neutralized.
//      Share.open({ url: 'file://' + target, type, subject,
//      failOnCancel:false }) → fs.unlink(target) after the sheet settles.
//   3. iOS user dismissal (failOnCancel:false — Share.open resolves with
//      dismissedAction) is NOT an error; the tmp file is still cleaned up.
//   4. A real Share.open rejection propagates to the caller, and the tmp
//      file cleanup still runs.
//   5. Missing mime falls back to 'application/octet-stream'.
// Progress: v1 deliberately registers no `.progress()` — the download leg
// uses indeterminate copy in the sheet (see the plan's onProgress amendment).
import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import Share from 'react-native-share';
import { saveDownloadedFile } from '../fileDownloadSave';

// The factories below must be self-contained (every jest.fn created inside
// them): babel-jest hoists jest.mock above the imports, so the factories run
// before any module-level const could initialize. The stable mock instances
// ride on the mocked default exports via a `__mocks` bag.
jest.mock('react-native-blob-util', () => {
  const CACHE_DIR = '/tmp/rnbu/cache';
  const fetchMock = jest.fn(() => Promise.resolve(undefined));
  const configMock = jest.fn(() => ({ fetch: fetchMock }));
  const unlinkMock = jest.fn(() => Promise.resolve(undefined));
  return {
    __esModule: true,
    default: {
      config: configMock,
      fs: { unlink: unlinkMock, dirs: { CacheDir: CACHE_DIR } },
      __mocks: { fetchMock, configMock, unlinkMock, CACHE_DIR },
    },
  };
});

jest.mock('react-native-share', () => ({
  __esModule: true,
  default: {
    open: jest.fn(() => Promise.resolve({ success: true })),
  },
}));

interface RnbuMocks {
  fetchMock: jest.Mock;
  configMock: jest.Mock;
  unlinkMock: jest.Mock;
  CACHE_DIR: string;
}

const { fetchMock, configMock, unlinkMock, CACHE_DIR } = (
  ReactNativeBlobUtil as unknown as { __mocks: RnbuMocks }
).__mocks;
const shareOpenMock = Share.open as jest.Mock;

const ORIGINAL_OS = Platform.OS;

describe('saveDownloadedFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Platform as { OS: string }).OS = ORIGINAL_OS;
  });

  afterAll(() => {
    (Platform as { OS: string }).OS = ORIGINAL_OS;
  });

  it('android: routes through DownloadManager config with a plain GET fetch (no Share sheet, no unlink)', async () => {
    (Platform as { OS: string }).OS = 'android';

    await saveDownloadedFile({
      url: 'https://cos.example.com/report.zip?sign=abc',
      filename: 'report.zip',
      mime: 'application/zip',
    });

    expect(configMock).toHaveBeenCalledWith({
      addAndroidDownloads: {
        useDownloadManager: true,
        title: 'report.zip',
        description: 'report.zip',
        mime: 'application/zip',
        mediaScannable: true,
        notification: true,
      },
    });
    expect(fetchMock).toHaveBeenCalledWith('GET', 'https://cos.example.com/report.zip?sign=abc');
    expect(shareOpenMock).not.toHaveBeenCalled();
    // DownloadManager owns the destination file — nothing to unlink.
    expect(unlinkMock).not.toHaveBeenCalled();
  });

  it('ios: downloads to explicit CacheDir/<filename> path (no appendExt), Share.open on file:// of the same path, then unlink', async () => {
    (Platform as { OS: string }).OS = 'ios';

    await saveDownloadedFile({
      url: 'https://cos.example.com/shot.png?sign=abc',
      filename: 'shot.png',
      mime: 'image/png',
    });

    const target = `${CACHE_DIR}/shot.png`;
    // Exact-shape assertion: path carries the full filename, and the legacy
    // fileCache/appendExt knobs are gone.
    expect(configMock).toHaveBeenCalledWith({ path: target });
    expect(configMock.mock.calls[0][0]).not.toHaveProperty('appendExt');
    expect(fetchMock).toHaveBeenCalledWith('GET', 'https://cos.example.com/shot.png?sign=abc');
    expect(shareOpenMock).toHaveBeenCalledWith({
      url: `file://${target}`,
      type: 'image/png',
      subject: 'shot.png',
      failOnCancel: false,
    });
    expect(unlinkMock).toHaveBeenCalledWith(target);
    // Cleanup only after the share sheet settles.
    expect(unlinkMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      shareOpenMock.mock.invocationCallOrder[0],
    );
  });

  it('ios: Chinese/space filenames ride the explicit path verbatim (share + save keep the source name)', async () => {
    (Platform as { OS: string }).OS = 'ios';

    await saveDownloadedFile({
      url: 'https://cos.example.com/%E6%8A%A5%E5%91%8A.pdf?sign=abc',
      filename: '我的 报告 v2.pdf',
      mime: 'application/pdf',
    });

    const target = `${CACHE_DIR}/我的 报告 v2.pdf`;
    expect(configMock).toHaveBeenCalledWith({ path: target });
    expect(configMock.mock.calls[0][0]).not.toHaveProperty('appendExt');
    expect(fetchMock).toHaveBeenCalledWith(
      'GET',
      'https://cos.example.com/%E6%8A%A5%E5%91%8A.pdf?sign=abc',
    );
    expect(shareOpenMock).toHaveBeenCalledWith({
      url: `file://${target}`,
      type: 'application/pdf',
      subject: '我的 报告 v2.pdf',
      failOnCancel: false,
    });
    expect(unlinkMock).toHaveBeenCalledWith(target);
  });

  it('ios: extension-less filename still lands on the explicit named path', async () => {
    (Platform as { OS: string }).OS = 'ios';

    await saveDownloadedFile({
      url: 'https://cos.example.com/LICENSE?sign=abc',
      filename: 'LICENSE',
    });

    expect(configMock).toHaveBeenCalledWith({ path: `${CACHE_DIR}/LICENSE` });
    // mime fallback rides along to the share sheet type.
    expect(shareOpenMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'application/octet-stream' }),
    );
  });

  it('ios: path separators in the filename are neutralized before joining CacheDir', async () => {
    (Platform as { OS: string }).OS = 'ios';

    await saveDownloadedFile({
      url: 'https://cos.example.com/blob?sign=abc',
      filename: '../weird/name.txt',
    });

    // Defense in depth: upstream sanitizes, but a separator would escape
    // CacheDir — it must be flattened into the filename instead.
    expect(configMock).toHaveBeenCalledWith({ path: `${CACHE_DIR}/.._weird_name.txt` });
    expect(unlinkMock).toHaveBeenCalledWith(`${CACHE_DIR}/.._weird_name.txt`);
  });

  it('ios: user dismissing the share sheet (failOnCancel:false → Share.open resolves) is not an error, tmp file still cleaned', async () => {
    (Platform as { OS: string }).OS = 'ios';
    shareOpenMock.mockResolvedValueOnce({ dismissedAction: true, success: false });

    await expect(
      saveDownloadedFile({
        url: 'https://cos.example.com/shot.png?sign=abc',
        filename: 'shot.png',
        mime: 'image/png',
      }),
    ).resolves.toBeUndefined();

    expect(unlinkMock).toHaveBeenCalledWith(`${CACHE_DIR}/shot.png`);
  });

  it('ios: real Share.open failure propagates after the tmp file cleanup ran', async () => {
    (Platform as { OS: string }).OS = 'ios';
    shareOpenMock.mockRejectedValueOnce(new Error('share unavailable'));

    await expect(
      saveDownloadedFile({
        url: 'https://cos.example.com/shot.png?sign=abc',
        filename: 'shot.png',
        mime: 'image/png',
      }),
    ).rejects.toThrow('share unavailable');

    expect(unlinkMock).toHaveBeenCalledWith(`${CACHE_DIR}/shot.png`);
  });

  it('falls back to application/octet-stream when mime is missing (android config)', async () => {
    (Platform as { OS: string }).OS = 'android';

    await saveDownloadedFile({
      url: 'https://cos.example.com/blob.bin?sign=abc',
      filename: 'blob.bin',
    });

    expect(configMock).toHaveBeenCalledWith(
      expect.objectContaining({
        addAndroidDownloads: expect.objectContaining({
          mime: 'application/octet-stream',
        }),
      }),
    );
  });
});
