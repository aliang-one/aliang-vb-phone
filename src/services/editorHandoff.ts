/**
 * 编辑器页 → 会话页的交接（Task 21 / Task 23）。
 *
 * 手绘页与字符画页保存后 `goBack()`，会话页在 focus 时取走这条记录。不用
 * 导航参数传对象：React Navigation 要求参数可序列化（LocalAsset 里的路径
 * 倒是没问题，但把「一次性动作」塞进路由参数会让返回栈里的旧参数一直挂着，
 * 重进会话页可能被重复消费）。模块级单槽位语义最清楚——谁取走谁清空。
 *
 * 两个页面共用同一个槽位：同一时刻只可能有一个编辑器在保存返回，且会话页
 * 取走时会按 `asset.kind` 区分后续处理（ascii 走文本通道，图片走上传）。
 */
import type { LocalAsset } from './attachmentLibrary';

export interface EditorHandoff {
  /** 已写入素材库的素材：手绘 PNG 或字符画文本。 */
  asset: LocalAsset;
  /** true = 用户点的是「保存并发送」，会话页取走后立即走发送流程。 */
  autoSend: boolean;
}

let pending: EditorHandoff | null = null;

export function setEditorHandoff(handoff: EditorHandoff): void {
  pending = handoff;
}

export function takeEditorHandoff(): EditorHandoff | null {
  const current = pending;
  pending = null;
  return current;
}

/** 测试用：清空槽位，避免用例之间互相污染。 */
export function clearEditorHandoff(): void {
  pending = null;
}
