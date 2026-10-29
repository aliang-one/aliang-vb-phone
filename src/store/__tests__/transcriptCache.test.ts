/**
 * transcriptCache 单测:持久化读写 / 200 条截断 / 20 会话 LRU 驱逐(连带删
 * key)/ 写穿去抖 / 损坏容错 / 空 transcript 永不清缓存。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AgentMessage } from '../../data/platformModels';
import {
  TRANSCRIPT_CACHE_INDEX_KEY,
  TRANSCRIPT_CACHE_KEY_PREFIX,
  TRANSCRIPT_CACHE_MAX_MESSAGES,
  TRANSCRIPT_CACHE_MAX_SESSIONS,
  TRANSCRIPT_CACHE_WRITE_DEBOUNCE_MS,
  attachTranscriptCache,
  readCachedTranscript,
  writeCachedTranscript,
} from '../transcriptCache';

const msg = (id: string): AgentMessage => ({
  id,
  role: 'user',
  content: `content ${id}`,
  timestamp: '2026-01-01T00:00:00Z',
});

const cachedKey = (sessionId: string) =>
  `${TRANSCRIPT_CACHE_KEY_PREFIX}${sessionId}`;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('writeCachedTranscript / readCachedTranscript', () => {
  test('写入后可原样读回', async () => {
    const messages = [msg('m1'), msg('m2'), msg('m3')];
    await writeCachedTranscript('s1', messages);
    await expect(readCachedTranscript('s1')).resolves.toEqual(messages);
  });

  test('超过 200 条只保留最新 200 条', async () => {
    const messages = Array.from({ length: TRANSCRIPT_CACHE_MAX_MESSAGES + 50 }, (_, i) =>
      msg(`m${i}`),
    );
    await writeCachedTranscript('s1', messages);
    const read = await readCachedTranscript('s1');
    expect(read).toHaveLength(TRANSCRIPT_CACHE_MAX_MESSAGES);
    expect(read?.[0]?.id).toBe(`m50`);
    expect(read?.[TRANSCRIPT_CACHE_MAX_MESSAGES - 1]?.id).toBe(
      `m${TRANSCRIPT_CACHE_MAX_MESSAGES + 49}`,
    );
  });

  test('空 transcript 不写(降级/驱逐产生的 [] 不能抹掉磁盘备份)', async () => {
    await writeCachedTranscript('s1', [msg('m1')]);
    await writeCachedTranscript('s1', []);
    await expect(readCachedTranscript('s1')).resolves.toEqual([msg('m1')]);
    await writeCachedTranscript('s2', []);
    await expect(readCachedTranscript('s2')).resolves.toBeNull();
  });

  test('非法形状的消息被过滤;全非法则视为无数据', async () => {
    await writeCachedTranscript('s1', [
      msg('m1'),
      { id: 42, role: 'nope' } as unknown as AgentMessage,
      null as unknown as AgentMessage,
    ]);
    await expect(readCachedTranscript('s1')).resolves.toEqual([msg('m1')]);
    await writeCachedTranscript('s2', [
      'garbage' as unknown as AgentMessage,
    ]);
    await expect(readCachedTranscript('s2')).resolves.toBeNull();
  });

  test('损坏的 JSON 返回 null 并删掉坏数据', async () => {
    await AsyncStorage.setItem(cachedKey('s1'), '{not json');
    await expect(readCachedTranscript('s1')).resolves.toBeNull();
    await expect(AsyncStorage.getItem(cachedKey('s1'))).resolves.toBeNull();
  });

  test('信封形状错误(v 错 / messages 非数组)返回 null', async () => {
    await AsyncStorage.setItem(
      cachedKey('s1'),
      JSON.stringify({ v: 2, messages: 'nope' }),
    );
    await expect(readCachedTranscript('s1')).resolves.toBeNull();
    await AsyncStorage.setItem(
      cachedKey('s2'),
      JSON.stringify({ v: 1, messages: { nope: true } }),
    );
    await expect(readCachedTranscript('s2')).resolves.toBeNull();
  });
});

describe('LRU 索引(最多 20 个会话)', () => {
  test('超过容量删最旧会话的整包数据', async () => {
    for (let i = 0; i < TRANSCRIPT_CACHE_MAX_SESSIONS + 1; i++) {
      await writeCachedTranscript(`s${i}`, [msg(`m${i}`)]);
    }
    const index = JSON.parse(
      (await AsyncStorage.getItem(TRANSCRIPT_CACHE_INDEX_KEY)) ?? '[]',
    ) as string[];
    expect(index).toHaveLength(TRANSCRIPT_CACHE_MAX_SESSIONS);
    expect(index).not.toContain('s0');
    await expect(readCachedTranscript('s0')).resolves.toBeNull();
    await expect(readCachedTranscript(`s${TRANSCRIPT_CACHE_MAX_SESSIONS}`)).resolves.toEqual(
      [msg(`m${TRANSCRIPT_CACHE_MAX_SESSIONS}`)],
    );
  });

  test('重写刷新 recency:旧会话被续写后不再是最旧', async () => {
    for (let i = 0; i < TRANSCRIPT_CACHE_MAX_SESSIONS; i++) {
      await writeCachedTranscript(`s${i}`, [msg(`m${i}`)]);
    }
    // s0 最旧,但被续写一次 → s1 变成最旧、被驱逐。
    await writeCachedTranscript('s0', [msg('fresh')]);
    await writeCachedTranscript('s-new', [msg('new')]);
    const index = JSON.parse(
      (await AsyncStorage.getItem(TRANSCRIPT_CACHE_INDEX_KEY)) ?? '[]',
    ) as string[];
    expect(index).toHaveLength(TRANSCRIPT_CACHE_MAX_SESSIONS);
    expect(index).not.toContain('s1');
    expect(index).toContain('s0');
    await expect(readCachedTranscript('s1')).resolves.toBeNull();
    await expect(readCachedTranscript('s0')).resolves.toEqual([msg('fresh')]);
  });
});

describe('attachTranscriptCache(写穿订阅)', () => {
  interface FakeState {
    vibeRuns: Array<{ id: string; transcript: AgentMessage[] }>;
  }

  const makeStore = () => {
    let state: FakeState = { vibeRuns: [] };
    const listeners: Array<(s: FakeState, p: FakeState) => void> = [];
    return {
      emit(next: FakeState) {
        const prev = state;
        state = next;
        for (const l of [...listeners]) l(state, prev);
      },
      store: {
        getState: () => state,
        subscribe: (l: (s: FakeState, p: FakeState) => void) => {
          listeners.push(l);
          return () => {
            const i = listeners.indexOf(l);
            if (i >= 0) listeners.splice(i, 1);
          };
        },
      } as const,
    };
  };

  test('transcript 变化 → 去抖后写穿最新值', async () => {
    jest.useFakeTimers();
    try {
      const fake = makeStore();
      attachTranscriptCache(fake.store);
      fake.emit({ vibeRuns: [{ id: 's1', transcript: [msg('a')] }] });
      fake.emit({
        vibeRuns: [{ id: 's1', transcript: [msg('a'), msg('b')] }],
      });
      await jest.advanceTimersByTimeAsync(TRANSCRIPT_CACHE_WRITE_DEBOUNCE_MS);
      await expect(readCachedTranscript('s1')).resolves.toEqual([
        msg('a'),
        msg('b'),
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  test('首次出现即写穿一次;身份未变不重写;空 transcript 不写', async () => {
    jest.useFakeTimers();
    try {
      const unchanged = { id: 'keep', transcript: [msg('k')] };
      const fake = makeStore();
      attachTranscriptCache(fake.store);
      fake.emit({ vibeRuns: [unchanged] });
      // 同一对象身份再发一次状态 → 不重复调度,去抖后只写这一份。
      fake.emit({
        vibeRuns: [unchanged, { id: 'demoted', transcript: [] }],
      });
      await jest.advanceTimersByTimeAsync(TRANSCRIPT_CACHE_WRITE_DEBOUNCE_MS + 500);
      await expect(readCachedTranscript('keep')).resolves.toEqual([msg('k')]);
      await expect(readCachedTranscript('demoted')).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test('同一会话去抖窗口内只写一次;detach 清掉在途定时器', async () => {
    jest.useFakeTimers();
    try {
      const fake = makeStore();
      const detach = attachTranscriptCache(fake.store);
      fake.emit({ vibeRuns: [{ id: 's1', transcript: [msg('a')] }] });
      detach();
      await jest.advanceTimersByTimeAsync(TRANSCRIPT_CACHE_WRITE_DEBOUNCE_MS + 500);
      await expect(readCachedTranscript('s1')).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
