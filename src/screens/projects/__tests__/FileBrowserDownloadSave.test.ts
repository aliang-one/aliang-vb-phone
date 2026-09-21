// Task 18: the phase gate + re-entrancy latch behind the FileBrowserScreen
// ready→save wiring. The full effect (markSaving → saveDownloadedFile →
// markDone/complete + toast) needs the live store and platform save service,
// so the screen itself stays untested (全量基线+类型为闸); the once-only
// contract lives in this pure predicate and is pinned here:
//   - only phase 'ready' with BOTH requestId and url can auto-save;
//   - the same requestId never auto-saves twice (strict-mode double effect);
//   - a different requestId (retry = new POST = new id) auto-saves again.
import { resolveAutoSaveTarget } from '../FileBrowserScreen';
import type {
  ActiveDownload,
  FileDownloadPhase,
} from '../../../store/types';

// The screen module graph reaches the native blob-util/share modules (via the
// Task 17 save service); jest.setup.js stubs them passthrough, which is all
// this test needs — it never invokes the save path.

const makeActive = (
  overrides?: Partial<ActiveDownload>,
): ActiveDownload => ({
  projectId: 'proj-1',
  requestId: 'req-1',
  path: '/work/docs/notes.md',
  filename: 'notes.md',
  totalBytes: 2048,
  uploadedBytes: 2048,
  url: 'https://cos.example.com/signed-get',
  ...overrides,
});

describe('resolveAutoSaveTarget', () => {
  it('returns the save target for a ready record with requestId and url', () => {
    expect(resolveAutoSaveTarget('ready', makeActive(), null)).toEqual({
      projectId: 'proj-1',
      requestId: 'req-1',
      filename: 'notes.md',
      url: 'https://cos.example.com/signed-get',
    });
  });

  it.each(
    ['idle', 'requesting', 'uploading', 'saving', 'done', 'failed', 'cancelled'].map(
      phase => [phase],
    ),
  )('returns null for phase %s', phase => {
    expect(
      resolveAutoSaveTarget(phase as FileDownloadPhase, makeActive(), null),
    ).toBeNull();
  });

  it('returns null without an active record', () => {
    expect(resolveAutoSaveTarget('ready', null, null)).toBeNull();
  });

  it('returns null when the ready push has no url yet (nothing to fetch)', () => {
    expect(
      resolveAutoSaveTarget('ready', makeActive({ url: undefined }), null),
    ).toBeNull();
  });

  it("returns null while the start POST is still in flight (requestId '')", () => {
    expect(
      resolveAutoSaveTarget('ready', makeActive({ requestId: '' }), null),
    ).toBeNull();
  });

  it('returns null for a requestId the latch already handled (strict-mode double run)', () => {
    expect(resolveAutoSaveTarget('ready', makeActive(), 'req-1')).toBeNull();
  });

  it('returns a target for a NEW requestId after a previous one was handled (retry)', () => {
    expect(resolveAutoSaveTarget('ready', makeActive(), 'req-old')).toEqual({
      projectId: 'proj-1',
      requestId: 'req-1',
      filename: 'notes.md',
      url: 'https://cos.example.com/signed-get',
    });
  });
});
