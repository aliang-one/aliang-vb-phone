import type { AiAttachmentMeta } from '../../../api/attachments';
import { buildTurnRetryPayload } from '../turnRetry';

// 2026-11-10 vm129 事故定案:回合失败(turn failed)后的「重试」只重发了
// 文字——handleRetryTurn 用 appendAgentMessage(id, content, 'text') 硬编码
// 三参,原消息的 attachments 从未读取/传递,带图消息重试后图丢失(agent 端
// journal 行63 无附件,agent 只能如实回答「没收到图片」)。对照:失败气泡
// 重试(aiSessionSlice retryFailedMessage)是带 failed.attachments 的先例。
// 本组测试钉死:回合重试载荷必须携带原消息附件。

const meta = (assetId: string): AiAttachmentMeta => ({
  asset_id: assetId,
  kind: 'photo',
  name: `${assetId}.jpg`,
  mime: 'image/jpeg',
  bytes: 454728,
  object_key: `chat-assets/${assetId}.jpg`,
});

describe('buildTurnRetryPayload(回合重试载荷:附件必须随行)', () => {
  it('带图消息:文字与附件一并返回(vm129 事故回归锚)', () => {
    const payload = buildTurnRetryPayload({
      content: '图片中的时间显示,现在是几点?',
      attachments: [meta('msg__0pWe91zlTBZ')],
    });
    expect(payload).not.toBeNull();
    expect(payload?.content).toBe('图片中的时间显示,现在是几点?');
    expect(payload?.attachments).toEqual([meta('msg__0pWe91zlTBZ')]);
  });

  it('纯文字消息:attachments 透传为空数组,行为与旧实现一致', () => {
    const payload = buildTurnRetryPayload({ content: '算了', attachments: undefined });
    expect(payload).toEqual({ content: '算了', attachments: [] });
  });

  it('content 首尾空白修剪;附件原样保留', () => {
    const payload = buildTurnRetryPayload({
      content: '  问一下  ',
      attachments: [meta('a1'), meta('a2')],
    });
    expect(payload?.content).toBe('问一下');
    expect(payload?.attachments).toHaveLength(2);
  });

  it('消息缺失:返回 null(无可重试)', () => {
    expect(buildTurnRetryPayload(undefined)).toBeNull();
  });

  it('纯空白且无附件:返回 null(与旧 content 守卫同语义)', () => {
    expect(buildTurnRetryPayload({ content: '   ', attachments: [] })).toBeNull();
    expect(buildTurnRetryPayload({ content: '', attachments: undefined })).toBeNull();
  });

  it('transcript 消息形状(content-only,无 attachments 键):文字照常可重试', () => {
    const payload = buildTurnRetryPayload({ content: '跑一个长任务' });
    expect(payload).toEqual({ content: '跑一个长任务', attachments: [] });
  });
});
