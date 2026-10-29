/**
 * transcriptCache — AsyncStorage 持久化会话 transcript(修复「进对话空白」)。
 *
 * 装机版的消息只活在内存 zustand vibeRuns 里:App 重启 / 后台 >30min 空闲降级
 * (demoteIdleSessions) / 50-run LRU 驱逐 / WS 重连快照缺位,任何一条都会把
 * transcript 清空,重进会话只能等单次 cache-first GET——服务器高载窗口里那次
 * GET 一失败,用户看到的就是空白对话(RCA 2026-10-29 症状一)。
 *
 * 本模块给 transcript 加一层**纯只读回退**缓存:
 *  - 写穿:订阅 store,run.transcript 数组身份变化且非空时,按会话去抖落盘
 *    (最新 TRANSCRIPT_CACHE_MAX_MESSAGES 条)。空 transcript 永不写——降级/
 *    驱逐产生的 [] 不能把缓存抹掉,缓存必须活得比内存久。
 *  - 水合:进会话屏时内存 transcript 为空则从缓存读出注入渲染。缓存**不是
 *    权威详情**:hydrateRunTranscriptFromCache 不碰 detailState/detailFromPage,
 *    computeHasDetail 的「真实详情页加载」语义不被污染,auto-load/catch-up 照
 *    常发起并用服务器数据按既有 merge 语义覆盖。
 *  - 容量:每会话最新 200 条;LRU 索引最多 TRANSCRIPT_CACHE_MAX_SESSIONS 个
 *    会话,超出删最旧会话的整包数据。
 *
 * AsyncStorage 即可胜任:单会话 ≤200 条文本消息,几百 KB 量级,且零新增原生
 * 依赖(不动 iOS pod / Android 原生链)。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AgentMessage } from '../data/platformModels';

export const TRANSCRIPT_CACHE_KEY_PREFIX = 'vibe:transcript:';
export const TRANSCRIPT_CACHE_INDEX_KEY = 'vibe:transcript:index';
/** 每会话最多持久化最新 N 条(内存热窗是 500,磁盘取更小的对话回看集)。 */
export const TRANSCRIPT_CACHE_MAX_MESSAGES = 200;
/** 最多持久化 N 个会话(LRU,超出删最旧)。 */
export const TRANSCRIPT_CACHE_MAX_SESSIONS = 20;
/** 同一会话的写穿去抖窗口。 */
export const TRANSCRIPT_CACHE_WRITE_DEBOUNCE_MS = 2000;

const transcriptCacheKey = (sessionId: string) =>
  `${TRANSCRIPT_CACHE_KEY_PREFIX}${sessionId}`;

interface CachedTranscriptEnvelope {
  v: 1;
  sessionId: string;
  savedAt: string;
  messages: AgentMessage[];
}

const isCacheableMessage = (value: unknown): value is AgentMessage => {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    (m.role === 'user' || m.role === 'assistant' || m.role === 'system') &&
    typeof m.content === 'string'
  );
};

const tail = <T>(list: T[], limit: number): T[] =>
  list.length <= limit ? list : list.slice(list.length - limit);

/**
 * 读取一个会话的持久化 transcript。损坏/缺失/校验失败一律返回 null 并顺手
 * 删掉坏数据——缓存永远不能成为新的故障面。
 */
export async function readCachedTranscript(
  sessionId: string,
): Promise<AgentMessage[] | null> {
  if (!sessionId) return null;
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(transcriptCacheKey(sessionId));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('shape');
    const envelope = parsed as Partial<CachedTranscriptEnvelope>;
    if (envelope.v !== 1 || !Array.isArray(envelope.messages)) {
      throw new Error('shape');
    }
    const messages = envelope.messages.filter(isCacheableMessage);
    return messages.length > 0 ? messages : null;
  } catch {
    void AsyncStorage.removeItem(transcriptCacheKey(sessionId)).catch(
      () => {},
    );
    return null;
  }
}

async function readLruIndex(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(TRANSCRIPT_CACHE_INDEX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
  } catch {
    return [];
  }
}

/**
 * 写穿一个会话的最新 transcript(只保留最新 N 条)。空消息列表是显式 no-op:
 * 降级/驱逐清空内存不是「会话没有历史」,绝不能反过来清掉磁盘备份。
 */
export async function writeCachedTranscript(
  sessionId: string,
  messages: AgentMessage[],
): Promise<void> {
  if (!sessionId || messages.length === 0) return;
  const keep = messages.filter(isCacheableMessage);
  if (keep.length === 0) return;
  const envelope: CachedTranscriptEnvelope = {
    v: 1,
    sessionId,
    savedAt: new Date().toISOString(),
    messages: tail(keep, TRANSCRIPT_CACHE_MAX_MESSAGES),
  };
  const recency = (await readLruIndex()).filter(id => id !== sessionId);
  recency.push(sessionId);
  // 保存裁剪后的索引——驱逐的 id 必须同时离开索引和磁盘,否则索引会无限
  // 膨胀(测试实锤:只删 key 不裁索引,重写刷新 recency 后索引涨到 21)。
  const kept = recency.slice(
    Math.max(0, recency.length - TRANSCRIPT_CACHE_MAX_SESSIONS),
  );
  const evicted = recency.slice(0, Math.max(0, recency.length - TRANSCRIPT_CACHE_MAX_SESSIONS));
  await AsyncStorage.setItem(
    transcriptCacheKey(sessionId),
    JSON.stringify(envelope),
  );
  await AsyncStorage.setItem(TRANSCRIPT_CACHE_INDEX_KEY, JSON.stringify(kept));
  await Promise.all(
    evicted.map(id =>
      AsyncStorage.removeItem(transcriptCacheKey(id)).catch(() => {}),
    ),
  );
}

/**
 * 把写穿挂到 store 上(controlCenterStore 创建后调用一次)。订阅层比对
 * transcript 数组身份——internals 的所有合并路径都对未变的 run 保持对象身份,
 * 无关会话的流式 delta 不会触发任何写。去抖触发时重新读 getState() 取最新值,
 * 避免把去抖窗口开始时的中间态写进磁盘。返回 detach(测试用)。
 */
export function attachTranscriptCache<
  S extends { vibeRuns: Array<{ id: string; transcript: AgentMessage[] }> },
>(
  store: {
    getState: () => S;
    subscribe: (
      listener: (state: S, prevState: S) => void,
    ) => () => void;
  },
  options?: { debounceMs?: number },
): () => void {
  const debounceMs = options?.debounceMs ?? TRANSCRIPT_CACHE_WRITE_DEBOUNCE_MS;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const detach = () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };

  store.subscribe((state, prevState) => {
    const runs = state.vibeRuns;
    if (!Array.isArray(runs)) return;
    const prevRuns = Array.isArray(prevState?.vibeRuns) ? prevState.vibeRuns : [];
    const prevById = new Map(
      prevRuns.map((run: { id: string; transcript: AgentMessage[] }) => [
        run.id,
        run,
      ]),
    );
    for (const run of runs) {
      if (!run?.id) continue;
      if (!Array.isArray(run.transcript) || run.transcript.length === 0) continue;
      if (run.transcript === prevById.get(run.id)?.transcript) continue;
      if (timers.has(run.id)) continue;
      timers.set(
        run.id,
        setTimeout(() => {
          timers.delete(run.id);
          const latest = store
            .getState()
            .vibeRuns.find(item => item.id === run.id);
          if (!latest || latest.transcript.length === 0) return;
          void writeCachedTranscript(run.id, latest.transcript).catch(() => {});
        }, debounceMs),
      );
    }
  });

  return detach;
}
