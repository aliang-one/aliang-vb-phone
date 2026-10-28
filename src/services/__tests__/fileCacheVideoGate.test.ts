// 视频门控:mp4/mov/m4v 走探针拦截(reason:'video'),其余视频容器仍按
// binary 拦,文本照旧可预览,大文本仍 too_large。
import { extOf, isVideoByName, shouldBlockPreview } from '../fileCache';

describe('video gating in shouldBlockPreview', () => {
  it('探针白名单容器 → reason video', () => {
    expect(shouldBlockPreview('clip.mp4')).toEqual({ reason: 'video', sizeBytes: undefined });
    expect(shouldBlockPreview('clip.MOV', 123)).toEqual({ reason: 'video', sizeBytes: 123 });
    expect(shouldBlockPreview('clip.m4v')).toEqual({ reason: 'video', sizeBytes: undefined });
    expect(isVideoByName('a.M4V')).toBe(true);
  });

  it('非白名单视频容器仍按 binary 拦截(iOS AVPlayer 拒载)', () => {
    expect(shouldBlockPreview('clip.avi')?.reason).toBe('binary');
    expect(shouldBlockPreview('clip.mkv')?.reason).toBe('binary');
    expect(shouldBlockPreview('clip.webm')?.reason).toBe('binary');
  });

  it('文本照旧可预览;超 1MB 仍 too_large', () => {
    expect(shouldBlockPreview('readme.md')).toBeUndefined();
    expect(shouldBlockPreview('big.log', 1024 * 1024 + 1)).toEqual({
      reason: 'too_large',
      sizeBytes: 1024 * 1024 + 1,
    });
  });

  it('extOf 大小写不敏感、无扩展名返回空串', () => {
    expect(extOf('A.MP4')).toBe('mp4');
    expect(extOf('noext')).toBe('');
  });
});
