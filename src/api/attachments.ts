/**
 * 素材上传的三个 REST 端点（server `modules/ai/attachments/routes.ts`）。
 *
 * 图片走「直传 COS」：先在这里拿一张 15 分钟有效的 PUT 预签名 URL，由
 * react-native-blob-util 直接把文件 PUT 上去，再回来 complete。图片字节
 * **永远不经过 JSON**——全局 `express.json({limit:'1mb'})` 会当场拒绝。
 *
 * ASCII 是文本通道：create 时正文随请求体提交，服务端直接置 ready，没有
 * put_url，也不需要 complete。
 */
import { apiPost } from './client';
import type { LocalAssetKind } from '../services/attachmentLibrary';

/**
 * 一条素材在「消息」上的 wire 形态（server `AiAttachmentMeta`）。
 *
 * 与 create 的响应不同：这里**没有** `put_url`/`status`——它描述的是已经
 * 物化完成、挂在某条消息上的素材。图片类靠 `object_key` 换签名 URL；
 * ASCII 类把正文放在 `text` 里，读消息时不需要再请求 COS。
 */
export interface AiAttachmentMeta {
  asset_id: string;
  kind: LocalAssetKind;
  name: string;
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  object_key?: string;
  text?: string;
}

/**
 * 会话级素材能力位（server `attachmentCapability()`）。
 *
 * `enabled:false` = 服务端没配 COS，上传链路走不通——手机必须据此隐藏
 * 「+」入口，而不是让用户点进去再失败。列表快照不带这个字段，所以消费方
 * 要把 `undefined` 当作「未知」而不是「不支持」。
 */
export interface AttachmentCapability {
  enabled: boolean;
  max_bytes: number;
  max_per_message: number;
  max_text_chars: number;
}

export interface CreateAttachmentResponse {
  asset_id: string;
  kind: LocalAssetKind;
  name: string;
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  status: 'pending' | 'ready';
  /** 仅图片类返回；ASCII 已 ready，没有这一项。 */
  put_url?: string;
  object_key?: string;
  expires_in?: number;
}

export interface CreateAttachmentInput {
  kind: LocalAssetKind;
  name: string;
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  /** ASCII 正文（服务端上限 32K 字符）。 */
  text?: string;
}

export function createAttachment(
  sessionId: string,
  input: CreateAttachmentInput,
): Promise<CreateAttachmentResponse> {
  return apiPost<CreateAttachmentResponse>(
    `/api/ai/sessions/${sessionId}/attachments`,
    input,
  );
}

export function completeAttachment(
  sessionId: string,
  assetId: string,
): Promise<{ asset_id: string; status: string }> {
  return apiPost(`/api/ai/sessions/${sessionId}/attachments/${assetId}/complete`);
}

export interface SignedAttachmentUrl {
  url: string;
  expires_at: string;
}

export interface SignAttachmentsResponse {
  urls: Record<string, SignedAttachmentUrl>;
  expires_in: number;
}

/**
 * 批量换 GET 预签名 URL（一次最多 50 个）。未知/他人/ASCII 的 id 会被服务端
 * 静默跳过——所以调用方必须容忍 `urls` 里缺 key，不能假设「发了几个就回来几个」。
 */
export function signAttachments(
  assetIds: string[],
): Promise<SignAttachmentsResponse> {
  return apiPost<SignAttachmentsResponse>('/api/ai/attachments/sign', {
    asset_ids: assetIds,
  });
}
