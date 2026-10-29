/**
 * ai.run.notice 的文案映射（跨端统一 P4-4）。
 *
 * agent 在续聊降级时发的信息性帧（回合照常继续）：resume_missing = 绑定的
 * 原生 CLI 会话不存在（空起）；history_restore_failed = journal 历史读回
 * 失败（空会话继续）。未知 code 返回 null——调用方整条丢弃（前向兼容：
 * agent 以后加新 code，旧 App 不弹野文案）。
 */

export type AiRunNoticeCode = 'resume_missing' | 'history_restore_failed';

export interface AiRunNoticeCopy {
  code: AiRunNoticeCode;
  /** i18n key（vibecoding 命名空间 session.notice.*）。 */
  textKey: string;
  /** agent 附带的原始 detail（英文诊断串），作为尾注拼在正文后。 */
  detail?: string;
}

const NOTICE_TEXT_KEYS: Record<AiRunNoticeCode, string> = {
  resume_missing: 'session.notice.resumeMissing',
  history_restore_failed: 'session.notice.historyRestoreFailed',
};

export function mapAiRunNotice(
  code: string,
  detail?: string,
): AiRunNoticeCopy | null {
  if (
    code !== 'resume_missing' &&
    code !== 'history_restore_failed'
  ) {
    return null;
  }
  const trimmedDetail = detail?.trim();
  return {
    code,
    textKey: NOTICE_TEXT_KEYS[code],
    detail: trimmedDetail ? trimmedDetail : undefined,
  };
}

/** 正文 + detail 尾注（「 · detail」）。detail 缺省/纯空白时原样返回正文。 */
export function aiRunNoticeText(base: string, detail?: string): string {
  const trimmed = detail?.trim();
  return trimmed ? `${base} · ${trimmed}` : base;
}
