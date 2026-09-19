import {
  summarizeMessage,
  deriveScrubberStops,
  deriveTurnScrubberStops,
  pickStopAtFraction,
  railFractionAt,
  sampleRailIndices,
  markPositionForStop,
  tickScale,
} from '../src/utils/conversationScrubber';
import { buildDisplayTranscript } from '../src/utils/agentTranscript';
import { buildConversationTurns } from '../src/utils/conversationTurns';
import type { AgentMessage } from '../src/data/platformModels';

const message = (
  id: string,
  role: AgentMessage['role'],
  content: string,
): AgentMessage => ({
  id,
  role,
  content,
  timestamp: `10:0${id}`,
});

describe('conversationScrubber', () => {
  describe('summarizeMessage', () => {
    it('extracts plain text from a simple user prompt', () => {
      const [user] = buildDisplayTranscript([
        message('1', 'user', 'Fix the login bug.'),
      ]);
      expect(summarizeMessage(user)).toBe('Fix the login bug.');
    });

    it('collapses newlines and extra whitespace into single spaces', () => {
      const [user] = buildDisplayTranscript([
        message(
          '1',
          'user',
          'Step one\n\nStep two\n   with   extra   gaps',
        ),
      ]);
      expect(summarizeMessage(user)).toBe('Step one Step two with extra gaps');
    });

    it('truncates long content and appends an ellipsis', () => {
      const long = 'A'.repeat(200);
      const [user] = buildDisplayTranscript([
        message('1', 'user', long),
      ]);
      const summary = summarizeMessage(user, 40);
      expect(summary.length).toBe(41); // 40 chars + ellipsis
      expect(summary.endsWith('…')).toBe(true);
    });

    it('keeps visible prose and callout titles but skips folded blocks', () => {
      const [assistant] = buildDisplayTranscript([
        message(
          '2',
          'assistant',
          'Here is my plan.\n<thinking>secret reasoning that is long</thinking>\n<command-message>Running tests now</command-message>',
        ),
      ]);
      const summary = summarizeMessage(assistant);
      expect(summary).toContain('Here is my plan.');
      expect(summary).toContain('Command message');
      expect(summary).not.toContain('secret reasoning');
    });

    it('includes code block content in the preview', () => {
      const [assistant] = buildDisplayTranscript([
        message(
          '2',
          'assistant',
          'Patch:\n```ts\nconst answer = 42;\n```\nDone.',
        ),
      ]);
      expect(summarizeMessage(assistant)).toContain('const answer = 42;');
    });

    it('returns an empty string for a message with no visible text', () => {
      const [assistant] = buildDisplayTranscript([
        message('2', 'assistant', '<thinking>only hidden</thinking>'),
      ]);
      expect(summarizeMessage(assistant)).toBe('');
    });

    it('shows the folded label instead of hidden content when a long log precedes the question', () => {
      // 粘贴长报错日志再提问(vibecoding 最高频形态):>900 字符且含 [ERROR]/
      // Traceback 的段落被 autoFoldMarkdownBlocks 折叠成块级 folded——气泡里
      // 只显示 label chip,preview 也必须如此,绝不能把隐藏全文倒进 120 字窗口。
      const log = Array.from(
        { length: 12 },
        (_, i) =>
          `[ERROR] frame #${i} traceback at handler (src/x.ts:${i}) — some long diagnostic line padding padding`,
      ).join('\n');
      const [user] = buildDisplayTranscript([
        message('1', 'user', `${log}\n\n帮我看看这个报错是怎么回事`),
      ]);

      const summary = summarizeMessage(user);
      expect(summary).toContain('帮我看看这个报错是怎么回事');
      expect(summary).toContain('Log output');
      expect(summary).not.toContain('[ERROR]');
    });
  });

  describe('deriveScrubberStops', () => {
    it('returns only user turns, each with a truncated preview', () => {
      const transcript = buildDisplayTranscript([
        message('1', 'user', 'First prompt'),
        message('2', 'assistant', 'First answer'),
        message('3', 'user', 'Second prompt'),
        message('4', 'assistant', 'Second answer'),
      ]);
      const stops = deriveScrubberStops(transcript);
      expect(stops.map(stop => stop.role)).toEqual(['user', 'user']);
      expect(stops.map(stop => stop.preview)).toEqual([
        'First prompt',
        'Second prompt',
      ]);
    });

    it('falls back to all messages when there are no user turns', () => {
      // Note: buildDisplayTranscript merges consecutive same-role messages, so
      // an assistant-only history collapses to a single display message — the
      // fallback must still surface it (rather than returning nothing).
      const transcript = buildDisplayTranscript([
        message('1', 'assistant', 'Hello there'),
      ]);
      const stops = deriveScrubberStops(transcript);
      expect(stops).toHaveLength(1);
      expect(stops[0].role).toBe('assistant');
      expect(stops[0].preview).toBe('Hello there');
    });

    it('returns an empty list for an empty transcript', () => {
      expect(deriveScrubberStops([])).toEqual([]);
    });

    it('carries the timestamp through to each stop', () => {
      const transcript = buildDisplayTranscript([
        message('1', 'user', 'Prompt one'),
        message('2', 'assistant', 'Answer'),
        message('3', 'user', 'Prompt two'),
      ]);
      const stops = deriveScrubberStops(transcript);
      expect(stops.map(stop => stop.timestamp)).toEqual(['10:01', '10:03']);
    });
  });

  describe('deriveTurnScrubberStops', () => {
    it('counts one user prompt plus many tool messages as one stop', () => {
      const turns = buildConversationTurns(
        buildDisplayTranscript([
          message('1', 'user', 'Run the merge.'),
          message('2', 'assistant', 'Checking status.'),
          message('3', 'system', '<tool_use>git status</tool_use>'),
          message('4', 'system', '<tool_result>clean</tool_result>'),
          message('5', 'assistant', 'Done.'),
        ]),
      );

      const stops = deriveTurnScrubberStops(turns);

      expect(stops).toHaveLength(1);
      expect(stops[0]).toMatchObject({
        id: turns[0].id,
        role: 'user',
        preview: 'Run the merge.',
      });
    });
  });

  describe('pickStopAtFraction', () => {
    const stops = deriveScrubberStops(
      buildDisplayTranscript([
        message('1', 'user', 'A'),
        message('2', 'assistant', 'a'),
        message('3', 'user', 'B'),
        message('4', 'assistant', 'b'),
        message('5', 'user', 'C'),
      ]),
    );

    it('returns the first stop at fraction 0', () => {
      expect(pickStopAtFraction(stops, 0)?.preview).toBe('A');
    });

    it('returns the last stop at fraction 1', () => {
      expect(pickStopAtFraction(stops, 1)?.preview).toBe('C');
    });

    it('returns the middle stop at fraction 0.5', () => {
      expect(pickStopAtFraction(stops, 0.5)?.preview).toBe('B');
    });

    it('clamps fractions below 0 and above 1', () => {
      expect(pickStopAtFraction(stops, -0.5)?.preview).toBe('A');
      expect(pickStopAtFraction(stops, 2)?.preview).toBe('C');
    });

    it('returns undefined for an empty stop list', () => {
      expect(pickStopAtFraction([], 0.5)).toBeUndefined();
    });
  });

  describe('railFractionAt', () => {
    const measured = { pageY: 172, height: 210, pageYMeasured: true };

    it('decodes moveY against measured rail geometry, clamped to [0,1]', () => {
      expect(railFractionAt(172, measured)).toBe(0);
      expect(railFractionAt(277, measured)).toBeCloseTo(0.5);
      expect(railFractionAt(382, measured)).toBe(1);
      expect(railFractionAt(-50, measured)).toBe(0);
      expect(railFractionAt(9999, measured)).toBe(1);
    });

    it('returns null while pageY has not been measured (first-gesture poison state)', () => {
      // railGeom 以 {pageY:0,height:0} 起步:onLayout 先把 height 灌成 ~210,
      // 而 pageY 仍停在 0。该半初始化态下 moveY/height 对 rail 上任意触点都
      // ≥1,旧实现会 clamp 成 1 → 无论手指在哪,loupe/提交都钉在最新提问。
      // 未测量几何必须拒绝解码,而不是给出一个看似合法的错误分数。
      expect(
        railFractionAt(400, { pageY: 0, height: 210, pageYMeasured: false }),
      ).toBeNull();
    });

    it('returns null when the rail has no height yet', () => {
      expect(
        railFractionAt(300, { pageY: 0, height: 0, pageYMeasured: false }),
      ).toBeNull();
      expect(
        railFractionAt(300, { pageY: 172, height: 0, pageYMeasured: true }),
      ).toBeNull();
    });
  });

  describe('sampleRailIndices', () => {
    it('returns every index when the list fits within maxMarks', () => {
      expect(sampleRailIndices(5, 16)).toEqual([0, 1, 2, 3, 4]);
      expect(sampleRailIndices(16, 16)).toHaveLength(16);
    });

    it('samples a uniform grid when the list exceeds maxMarks', () => {
      const sampled = sampleRailIndices(100, 16);
      expect(sampled).toHaveLength(16);
      expect(sampled[0]).toBe(0);
      expect(sampled[sampled.length - 1]).toBe(99);
      // 与既有 layer 内联公式逐点一致(round(i*(n-1)/(slots-1)), slots=maxMarks)
      expect(sampled).toContain(33); // round(5*99/15)
      expect(sampled).toContain(46); // round(7*99/15)
      expect(sampled).toContain(92); // round(14*99/15)=round(92.4)
      for (let k = 1; k < sampled.length; k += 1) {
        expect(sampled[k]).toBeGreaterThan(sampled[k - 1]);
      }
    });

    it('pins the active index into the sampled set (replacing one grid slot)', () => {
      const sampled = sampleRailIndices(100, 16, 30);
      expect(sampled).toHaveLength(16);
      expect(sampled).toContain(30);
      expect(sampled[0]).toBe(0);
      expect(sampled[sampled.length - 1]).toBe(99);
      // 网格缩为 15 槽: round(i*99/14)
      expect(sampled).toContain(50); // round(7*99/14)=round(49.5)=50
      for (let k = 1; k < sampled.length; k += 1) {
        expect(sampled[k]).toBeGreaterThan(sampled[k - 1]);
      }
    });

    it('returns an empty list for an empty conversation', () => {
      expect(sampleRailIndices(0, 16)).toEqual([]);
    });
  });

  describe('markPositionForStop', () => {
    // 4 个 mark, 分别代表 turn 0/10/20/30(即 markStopIndices=[0,10,20,30])
    const marks = [0, 10, 20, 30];

    it('lands exactly on a mark when the stop IS a sampled mark', () => {
      expect(markPositionForStop(marks, 0)).toBe(0);
      expect(markPositionForStop(marks, 10)).toBe(1);
      expect(markPositionForStop(marks, 20)).toBe(2);
      expect(markPositionForStop(marks, 30)).toBe(3);
    });

    it('interpolates between bracketing marks for unsampled stops', () => {
      expect(markPositionForStop(marks, 15)).toBeCloseTo(1.5);
      expect(markPositionForStop(marks, 12)).toBeCloseTo(1.2);
      expect(markPositionForStop(marks, 27)).toBeCloseTo(2.7);
    });

    it('clamps to the rail ends for stops beyond the sampled range', () => {
      expect(markPositionForStop(marks, -5)).toBe(0);
      expect(markPositionForStop(marks, 40)).toBe(3);
    });

    it('degenerate mark lists resolve to 0', () => {
      expect(markPositionForStop([], 5)).toBe(0);
      expect(markPositionForStop([7], 3)).toBe(0);
      expect(markPositionForStop([7], 9)).toBe(0);
    });

    it('keeps the bulge on the mark the loupe names (sampling consistency)', () => {
      // 全量 100 turn、16 采样 mark:对每个被采样的 stop, bulge 必须正落其 mark 上
      const stops = sampleRailIndices(100, 16, 30);
      stops.forEach((turnIndex, markIndex) => {
        expect(markPositionForStop(stops, turnIndex)).toBeCloseTo(markIndex, 6);
      });
    });
  });

  describe('tickScale', () => {
    // Defaults mirror the ConversationScrubber rail: 7px inactive ticks, 16px at
    // the active stop, radius of 3 stops on each side gets the fisheye bulge.
    it('returns the peak size at the active stop (distance 0)', () => {
      const peak = tickScale(0);
      expect(peak.height).toBeCloseTo(16);
      expect(peak.opacity).toBeCloseTo(1);
    });

    it('returns the base size at and beyond the radius', () => {
      const atRadius = tickScale(3);
      const beyondRadius = tickScale(10);
      expect(atRadius.height).toBeCloseTo(7);
      expect(atRadius.opacity).toBeCloseTo(0.45);
      expect(beyondRadius.height).toBeCloseTo(7);
      expect(beyondRadius.opacity).toBeCloseTo(0.45);
    });

    it('shrinks the tick smoothly between the active stop and the radius', () => {
      const mid = tickScale(1);
      // t = 1 - 1/3 = 2/3 → height 7 + (2/3)*9 = 13, opacity 0.45 + (2/3)*0.55
      expect(mid.height).toBeCloseTo(13, 5);
      expect(mid.opacity).toBeCloseTo(0.45 + (2 / 3) * 0.55, 5);
      expect(mid.height).toBeGreaterThan(7);
      expect(mid.height).toBeLessThan(16);
    });

    it('is symmetric for negative distances', () => {
      expect(tickScale(-2).height).toBeCloseTo(tickScale(2).height);
      expect(tickScale(-2).opacity).toBeCloseTo(tickScale(2).opacity);
    });

    it('decreases monotonically as the distance from active grows', () => {
      const zero = tickScale(0).height;
      const one = tickScale(1).height;
      const two = tickScale(2).height;
      const three = tickScale(3).height;
      expect(zero).toBeGreaterThan(one);
      expect(one).toBeGreaterThan(two);
      expect(two).toBeGreaterThan(three);
    });

    it('with radius 0 magnifies only the active stop itself', () => {
      expect(tickScale(0, { radius: 0 }).height).toBeCloseTo(16);
      expect(tickScale(1, { radius: 0 }).height).toBeCloseTo(7);
      expect(tickScale(1, { radius: 0 }).opacity).toBeCloseTo(0.45);
    });

    it('honors custom base/peak sizes', () => {
      const peak = tickScale(0, { baseHeight: 4, peakHeight: 24, radius: 2 });
      const base = tickScale(2, { baseHeight: 4, peakHeight: 24, radius: 2 });
      expect(peak.height).toBeCloseTo(24);
      expect(base.height).toBeCloseTo(4);
    });

    // Width fisheye: the focused tick also widens (not just grows tall), so the
    // located position reads as a little pill that pops out of the rail.
    it('widens to the peak width at the active stop (distance 0)', () => {
      expect(tickScale(0).width).toBeCloseTo(8);
    });

    it('is at the base width at and beyond the radius', () => {
      expect(tickScale(3).width).toBeCloseTo(4);
      expect(tickScale(10).width).toBeCloseTo(4);
    });

    it('widens smoothly between the active stop and the radius', () => {
      const mid = tickScale(1);
      // t = 2/3 → width 4 + (2/3)*(8-4) = 4 + 2.67 ≈ 6.67
      expect(mid.width).toBeGreaterThan(4);
      expect(mid.width).toBeLessThan(8);
      expect(mid.width).toBeCloseTo(4 + (2 / 3) * 4, 5);
    });

    it('honors custom base/peak widths', () => {
      const peak = tickScale(0, { baseWidth: 3, peakWidth: 9, radius: 2 });
      const base = tickScale(2, { baseWidth: 3, peakWidth: 9, radius: 2 });
      expect(peak.width).toBeCloseTo(9);
      expect(base.width).toBeCloseTo(3);
    });
  });
});
