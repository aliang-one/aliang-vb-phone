import type { AiAttachmentMeta } from '../../api/attachments';

/**
 * turnRetry — 回合失败「重试」的载荷构建(纯函数,导出供单测)。
 *
 * 2026-11-10 vm129 事故:带图消息送达后 run 失败(上游并发限流),用户点
 * 「重试」,屏幕层的 handleRetryTurn 只带了 content——原消息 attachments
 * 从未读取,图在重试跳丢失,agent 只能回答「没收到图片」。本 helper 把
 * 「从 transcript 消息取重试载荷」的口径钉死:**附件必须随行**。
 *
 * 对照先例:失败气泡重试(store retryFailedMessage)是带 failed.attachments
 * 的——两条重试路自此同口径。附件是 server 确认过的 AiAttachmentMeta
 * (asset_id/object_key 齐备,COS 对象仍在),原样回传即可复用,无需重传。
 */

export interface TurnRetryPayload {
  content: string;
  attachments: AiAttachmentMeta[];
}

/** transcript 用户消息的重试相关字段(只读鸭子类型,避免拉全量类型依赖)。 */
export interface TurnRetrySourceMessage {
  content?: string;
  attachments?: AiAttachmentMeta[];
}

/**
 * 从 transcript 的 agent 消息构建回合重试载荷。
 *
 * - content 首尾修剪(store appendAgentMessage 对空 content 静默忽略,此处
 *   同口径拦截);
 * - attachments 原样透传(可为空数组——纯文字消息行为不变);
 * - 无消息/纯空白且无附件 → null(无可重试,调用方静默返回,与旧守卫同语义)。
 */
export function buildTurnRetryPayload(
  agentMessage?: TurnRetrySourceMessage,
): TurnRetryPayload | null {
  if (!agentMessage) return null;
  const content = (agentMessage.content ?? '').trim();
  const attachments = Array.isArray(agentMessage.attachments)
    ? agentMessage.attachments
    : [];
  if (!content) return null;
  return { content, attachments };
}
