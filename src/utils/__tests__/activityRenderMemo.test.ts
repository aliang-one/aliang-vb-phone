import type { StructuredActivityEvent } from '../../data/platformModels';
import {
  activityEventRenderSignature,
  relevantActivityDetailsEqual,
  THINKING_RENDER_BUCKET_CHARS,
} from '../activityRenderMemo';

const thinking = (chars: number, active = true): StructuredActivityEvent => ({
  kind: 'thinking',
  eventId: 'think-1',
  messageId: 'message-1',
  active,
  chars,
});

describe('activity render memoization', () => {
  it('coalesces thinking character updates within one render bucket', () => {
    expect(activityEventRenderSignature(thinking(1))).toBe(
      activityEventRenderSignature(thinking(THINKING_RENDER_BUCKET_CHARS - 1)),
    );
    expect(
      activityEventRenderSignature(thinking(THINKING_RENDER_BUCKET_CHARS)),
    ).not.toBe(
      activityEventRenderSignature(thinking(THINKING_RENDER_BUCKET_CHARS - 1)),
    );
    expect(activityEventRenderSignature(thinking(1, false))).not.toBe(
      activityEventRenderSignature(thinking(1, true)),
    );
  });

  it('ignores cache entries owned by another activity block', () => {
    const event = thinking(12);
    const shared = { text: 'mine' };
    expect(
      relevantActivityDetailsEqual(
        [event],
        { 'think-1': shared },
        { 'think-1': shared, 'command-2': { text: 'other' } },
      ),
    ).toBe(true);
    expect(
      relevantActivityDetailsEqual(
        [event],
        { 'think-1': shared },
        { 'think-1': { text: 'changed' } },
      ),
    ).toBe(false);
  });
});
