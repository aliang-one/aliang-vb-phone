// 视频头探针:容器魔数判定 + utf8 降级容错 + 探针缓存/失败降级。
import {
  clearVideoProbes,
  peekVideoVerdict,
  probeProjectVideo,
  sniffVideoContainer,
} from '../videoProbe';

const bytes = (...parts: Array<number | string>): Uint8Array => {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'string') for (const ch of p) out.push(ch.charCodeAt(0));
    else out.push(p);
  }
  return new Uint8Array(out);
};

describe('sniffVideoContainer', () => {
  it('mp4:box 长度 + ftyp + isom 品牌', () => {
    expect(sniffVideoContainer(bytes(0x00, 0x00, 0x00, 0x18, 'ftypisom'))).toEqual({ kind: 'mp4' });
  });

  it('mov:qt   品牌', () => {
    expect(sniffVideoContainer(bytes(0x00, 0x00, 0x00, 0x20, 'ftypqt  '))).toEqual({ kind: 'mov' });
  });

  it('EBML + matroska DocType → mkv', () => {
    expect(sniffVideoContainer(bytes(0x1a, 0x45, 0xdf, 0xa3, 'matroska'))).toEqual({ kind: 'mkv' });
  });

  it('EBML + webm DocType → webm', () => {
    expect(sniffVideoContainer(bytes(0x1a, 0x45, 0xdf, 0xa3, 'webm'))).toEqual({ kind: 'webm' });
  });

  it('RIFF + AVI ', () => {
    expect(sniffVideoContainer(bytes('RIFF', 0x00, 'AVI '))).toEqual({ kind: 'avi' });
  });

  it('文本内容(伪装成 mp4 的假视频)→ not_video', () => {
    expect(sniffVideoContainer(bytes('hello world, definitely not a video file'))).toEqual({
      kind: 'not_video',
    });
  });

  it('过短无特征字节 → not_video', () => {
    expect(sniffVideoContainer(bytes('GIF8'))).toEqual({ kind: 'not_video' });
    expect(sniffVideoContainer(new Uint8Array([0x00, 0x01, 0x02]))).toEqual({ kind: 'not_video' });
  });

  it('utf8 降级:高位字节被替换后 ftyp 偏移漂移,ASCII 骨架搜索兜底', () => {
    // box 长度高位(0x80×5)被 utf8 有损解码替换,ftyp 从偏移 5 开始
    const degraded = bytes(0xff, 0xff, 0xff, 0xff, 0xff, 'ftypisom');
    expect(sniffVideoContainer(degraded)).toEqual({ kind: 'mp4' });
  });

  it('utf8 降级:EBML 签名被破坏时靠 matroska DocType 兜底', () => {
    // 0xdf 0xa3 在 utf8 解码侧合为一个码位,decodeContent 置 0xff → 签名失真
    const degraded = bytes(0x1a, 0x45, 0xff, 0xff, 'matroska');
    expect(sniffVideoContainer(degraded)).toEqual({ kind: 'mkv' });
  });
});

const base64Of = (b: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < b.length; i += 1) s += String.fromCharCode(b[i]);
  return globalThis.btoa(s);
};

const mp4Head = bytes(0x00, 0x00, 0x00, 0x18, 'ftypisom', 0x00, 0x00, 0x00, 0x08, 'free');

describe('probeProjectVideo', () => {
  beforeEach(() => {
    clearVideoProbes();
  });

  it('base64 快照 → 判真并写入缓存(第二次调用不再发请求)', async () => {
    const load = jest.fn().mockResolvedValue({
      content: base64Of(mp4Head),
      encoding: 'base64',
      truncated: false,
    });
    const transport = { loadProjectFileContent: load };

    await expect(probeProjectVideo('p1', 'a.mp4', transport)).resolves.toEqual({ kind: 'mp4' });
    await expect(probeProjectVideo('p1', 'a.mp4', transport)).resolves.toEqual({ kind: 'mp4' });
    expect(load).toHaveBeenCalledTimes(1);
    expect(peekVideoVerdict('p1', 'a.mp4')).toEqual({ kind: 'mp4' });
  });

  it('内核忽略 encoding 时 utf8 快照照样判真(字节 1:1 保留)', async () => {
    let text = '';
    for (const b of mp4Head) text += String.fromCharCode(b);
    const transport = {
      loadProjectFileContent: jest.fn().mockResolvedValue({
        content: text,
        encoding: 'utf8',
        truncated: true,
      }),
    };
    await expect(probeProjectVideo('p1', 'a.mp4', transport)).resolves.toEqual({ kind: 'mp4' });
  });

  it('假视频 → not_video;探针请求失败 → unknown 降级', async () => {
    const fakeTransport = {
      loadProjectFileContent: jest.fn().mockResolvedValue({
        content: base64Of(bytes('plain text masquerading as mp4')),
        encoding: 'base64',
      }),
    };
    await expect(probeProjectVideo('p1', 'fake.mp4', fakeTransport)).resolves.toEqual({
      kind: 'not_video',
    });

    const brokenTransport = {
      loadProjectFileContent: jest.fn().mockRejectedValue(new Error('rpc timeout')),
    };
    await expect(probeProjectVideo('p1', 'net.mp4', brokenTransport)).resolves.toEqual({
      kind: 'unknown',
    });
  });
});
