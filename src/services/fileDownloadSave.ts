// COS → phone system save (Task 17). Android hands the presigned GET to the
// system DownloadManager (no storage permission needed, system notification,
// lands in Downloads); iOS has no shared Downloads folder, so the file is
// cached to tmp and offered through the system share sheet (the user picks
// "Save to Files"). The tmp file is removed once the sheet settles.
//
// v1 deliberately registers no `.progress()` on the fetch: the sheet shows
// indeterminate copy for the local save phase (upload leg owns the progress
// bar). See the plan's onProgress amendment.
import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import Share from 'react-native-share';

export interface SaveDownloadOptions {
  /** COS presigned GET url (from the server's ready push). */
  url: string;
  filename: string;
  /** Falls back to application/octet-stream — DownloadManager/Share fall back to extension sniffing anyway. */
  mime?: string;
}

const FALLBACK_MIME = 'application/octet-stream';

export async function saveDownloadedFile({
  url,
  filename,
  mime,
}: SaveDownloadOptions): Promise<void> {
  const mimeOrFallback = mime ?? FALLBACK_MIME;
  if (Platform.OS === 'android') {
    await ReactNativeBlobUtil.config({
      addAndroidDownloads: {
        useDownloadManager: true,
        title: filename,
        description: filename,
        mime: mimeOrFallback,
        mediaScannable: true,
        notification: true,
      },
    }).fetch('GET', url);
    return;
  }
  const res = await ReactNativeBlobUtil.config({
    fileCache: true,
    appendExt: filename.includes('.') ? filename.split('.').pop() : undefined,
  }).fetch('GET', url);
  const path = res.path();
  try {
    // failOnCancel:false — the user closing the share sheet resolves (dismissedAction)
    // instead of rejecting; only real failures throw.
    await Share.open({
      url: `file://${path}`,
      type: mimeOrFallback,
      subject: filename,
      failOnCancel: false,
    });
  } finally {
    await ReactNativeBlobUtil.fs.unlink(path).catch(() => {});
  }
}
