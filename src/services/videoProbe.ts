import { platformTransport } from './platformTransport';

// 视频头探针:点开「扩展名是视频」的文件时,只读头部 64KB 判定它是不是
// 真的视频容器——假视频(改后缀的文本/二进制)在这里被拦下,不再发起
// COS 全量上传的下载链,双向带宽都省掉。判真才放行下载/后续播放。
const PROBE_BYTES = 64 * 1024;

export type VideoContainerKind = 'mp4' | 'mov' | 'avi' | 'mkv' | 'webm';
export type VideoProbeVerdict =
  | { kind: VideoContainerKind }
  | { kind: 'not_video' }
  // 请求失败(RPC 超时/agent 离线)——降级放行,不因探针故障挡住下载
  | { kind: 'unknown' };

export interface VideoProbeTransport {
  loadProjectFileContent(
    projectId: string,
    path: string,
    opts?: { maxBytes?: number; encoding?: 'utf8' | 'base64' },
  ): Promise<{ content: string; encoding?: string; truncated?: boolean }>;
}

const asciiAt = (bytes: Uint8Array, offset: number, s: string): boolean => {
  if (offset < 0 || offset + s.length > bytes.length) return false;
  for (let i = 0; i < s.length; i += 1) {
    if (bytes[offset + i] !== s.charCodeAt(i)) return false;
  }
  return true;
};

/** utf8 有损降级时用:忽略 ≥0x80 的字节(已失真),只匹配 ASCII 骨架。 */
const asciiSearch = (bytes: Uint8Array, s: string, limit: number): number => {
  const end = Math.min(limit, bytes.length - s.length);
  for (let i = 0; i <= end; i += 1) {
    let hit = true;
    for (let j = 0; j < s.length; j += 1) {
      const b = bytes[i + j];
      if (b >= 0x80 || b !== s.charCodeAt(j)) {
        hit = false;
        break;
      }
    }
    if (hit) return i;
  }
  return -1;
};

/**
 * 纯函数:从文件头字节判容器。
 * - 内核支持 encoding=base64 时字节精确,走固定位偏移;
 * - 内核忽略 encoding(utf8 有损)时 NUL/高位字节可能被替换成 U+FFFD,
 *   偏移漂移——退化为前 48 字节的 ASCII 特征搜索(ftyp/RIFF 均纯 ASCII;
 *   EBML 签名 1A 45 DF A3 是合法 UTF-8 序列,往返无损)。
 */
export function sniffVideoContainer(bytes: Uint8Array): VideoProbeVerdict {
  // 真 mp4/mov/avi 的头至少 12 字节、EBML 至少 4 字节;再短必不是视频。
  if (bytes.length < 4) return { kind: 'not_video' };

  // EBML(mkv/webm):精确签名在前 4 字节;DocType 串区分,缺省按 mkv。
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    if (asciiSearch(bytes, 'webm', 64) >= 0) return { kind: 'webm' };
    return { kind: 'mkv' };
  }

  // ISO-BMFF(mp4/mov/m4v):box 长度(4B)+ 'ftyp' + brand(4B)。
  if (asciiAt(bytes, 4, 'ftyp')) {
    return asciiAt(bytes, 8, 'qt  ') ? { kind: 'mov' } : { kind: 'mp4' };
  }

  // RIFF/AVI:'RIFF'+长度+'AVI '。
  if (asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'AVI ')) {
    return { kind: 'avi' };
  }

  // utf8 降级兜底:偏移已不可信,ASCII 骨架搜索。
  const ftypAt = asciiSearch(bytes, 'ftyp', 48);
  if (ftypAt >= 0) {
    return asciiAt(bytes, ftypAt + 4, 'qt  ') ? { kind: 'mov' } : { kind: 'mp4' };
  }
  if (asciiSearch(bytes, 'RIFF', 4) === 0 && asciiSearch(bytes, 'AVI ', 32) >= 0) {
    return { kind: 'avi' };
  }
  if (asciiSearch(bytes, 'matroska', 64) >= 0) return { kind: 'mkv' };

  return { kind: 'not_video' };
}

const decodeContent = (content: string, encoding: string): Uint8Array => {
  if (encoding === 'base64') {
    const binary = globalThis.atob(content);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  // utf8 有损文本:只保留 <0x80 的码位(<0x80 的 charCode 即原字节;
  // 失真处 ≥0x80,交由 ASCII 特征搜索容错)。
  const out = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i += 1) {
    const c = content.charCodeAt(i);
    out[i] = c < 0x80 ? c : 0xff;
  }
  return out;
};

// 会话级缓存:path → verdict。列表刷新不重探(文件没变,结论不变);
// 上限 64 条,超出按插入序淘汰。
const verdictCache = new Map<string, VideoProbeVerdict>();
const VERDICT_CACHE_MAX = 64;
const cacheKey = (projectId: string, path: string) => `${projectId}:${path}`;

const rememberVerdict = (key: string, verdict: VideoProbeVerdict) => {
  verdictCache.set(key, verdict);
  while (verdictCache.size > VERDICT_CACHE_MAX) {
    const oldest = verdictCache.keys().next().value;
    if (oldest === undefined) break;
    verdictCache.delete(oldest);
  }
};

export const peekVideoVerdict = (projectId: string, path: string): VideoProbeVerdict | undefined =>
  verdictCache.get(cacheKey(projectId, path));

export const clearVideoProbes = (): void => {
  verdictCache.clear();
};

export async function probeProjectVideo(
  projectId: string,
  path: string,
  transport: VideoProbeTransport = platformTransport,
): Promise<VideoProbeVerdict> {
  const key = cacheKey(projectId, path);
  const cached = verdictCache.get(key);
  if (cached) return cached;
  try {
    const snapshot = await transport.loadProjectFileContent(projectId, path, {
      maxBytes: PROBE_BYTES,
      encoding: 'base64',
    });
    // 服务端/agent 对二进制会原样回 base64;若哪层降级成 utf8,解码器容错。
    const bytes = decodeContent(snapshot.content, snapshot.encoding ?? 'utf8');
    const verdict = sniffVideoContainer(bytes);
    rememberVerdict(key, verdict);
    return verdict;
  } catch {
    // 探针失败不挡下载:unknown 语义 = 「没验出来,交还用户决定」。
    return { kind: 'unknown' };
  }
}
