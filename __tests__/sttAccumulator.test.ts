import { appendFinalTranscript, buildLiveCaption } from '../src/utils/sttAccumulator';

describe('sttAccumulator', () => {
  it('appends finalized sentences to the running transcript', () => {
    expect(appendFinalTranscript('', '你好。')).toBe('你好。');
    expect(appendFinalTranscript('你好。', '世界。')).toBe('你好。世界。');
  });

  it('ignores empty / whitespace-only finals', () => {
    expect(appendFinalTranscript('你好。', '   ')).toBe('你好。');
    expect(appendFinalTranscript('你好。', '')).toBe('你好。');
  });

  it('trims trailing whitespace on a final before appending', () => {
    expect(appendFinalTranscript('', '  你好。  ')).toBe('你好。');
  });

  it('builds the live caption from transcript + current partial', () => {
    expect(buildLiveCaption('你好。', '世界')).toBe('你好。世界');
    expect(buildLiveCaption('', '世界')).toBe('世界');
    expect(buildLiveCaption('你好。', '')).toBe('你好。');
  });
});
