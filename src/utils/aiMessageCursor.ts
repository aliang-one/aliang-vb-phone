/**
 * 客户端自编码 AI 消息分页游标。
 *
 * 背景(trimTranscript 分页失效修复):「加载更早」原来只认服务端下发的
 * transcriptPage.nextBeforeCursor。trim/快照合并之后,这个 cursor 可能指向
 * 本地早已不存在的消息,甚至本地已经加载过的区域——用它翻页要么重翻已加载
 * 页(id-union 去重后表现为"点了没反应"),要么浪费一轮往返。
 *
 * 而服务端 before 游标的格式是公开且稳定的(base64url(JSON({id, timestamp})),
 * decode 只强制非空 id —— 见 server/src/modules/ai/cursor.ts,自 2026-06-21
 * 未变),after 路由甚至直接接受裸消息 id。客户端永远知道自己的窗口边界
 * (transcript[0]),自编码一条与服务端字节兼容的游标是最可靠的定位:
 * 「取比本地最老一条更早的消息」。服务端下发的 cursor 退化为参考值。
 *
 * 必须带 timestamp:agent 转发路径(server sessionDetail.ts)会把 cursor 拆成
 * before_message_id + before_timestamp 发给 agent 侧,缺 timestamp 会走
 * undefined 转发,imported/CC 会话的 agent 侧历史定位依赖它。
 */

export interface AiCursorSourceMessage {
  id: string;
  timestamp?: string;
}

/** base64url(JSON({id, timestamp})) — 与 server encodeAiMessageCursor 字节兼容。 */
export function encodeClientAiMessageCursor(
  message: AiCursorSourceMessage | undefined,
): string | undefined {
  if (!message?.id) return undefined;
  const payload: { id: string; timestamp?: string } = { id: message.id };
  if (message.timestamp) payload.timestamp = message.timestamp;
  // btoa 产出标准 base64;Node 的 base64url 序列化无 padding 且用 -_ 字母表,
  // 这里手工转换保持字节一致(服务端 Buffer.toString('base64url'))。
  const base64 = globalThis.btoa(JSON.stringify(payload));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
