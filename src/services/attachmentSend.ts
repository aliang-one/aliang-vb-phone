/**
 * 发送一条「带素材」的用户消息（Task 18）。
 *
 * 顺序是硬约束，别调换：
 *   1. 先把本轮素材物化到服务端（图片 create→PUT→complete，ASCII create）；
 *   2. 再把正文（ASCII 并入代码块）和 asset_id 列表交给发送函数；
 *   3. **只有发送成功**才回调 `onSent` —— 失败时 chips 原样留在输入框上方，
 *      用户重试不用重新挑图。
 *
 * 这段逻辑放在 service 而不是屏幕里，是因为 VibeCodingSessionScreen 太大
 * 没法整屏渲染测试，而「先上传后发送、成功才清空」恰恰是最容易写反的契约。
 */
import type { AiAttachmentMeta } from '../api/attachments';
import {
  createAsciiAttachment,
  mimeFromName,
  uploadAsset,
  uploadNameFor,
  utf8ByteLength,
} from './attachmentUpload';
import type { LocalAsset } from './attachmentLibrary';
import { registerLocalAssetPath } from './attachmentSignCache';

/**
 * 把本轮素材物化到服务端，产出可随消息发送的元数据。
 *
 * 服务端 `materializeAttachments` 只信 `asset_id`，其余字段按自己的记录重建；
 * 这里填全名称/MIME/字节数只是为了满足 wire schema 的必填项。图片走
 * create→PUT→complete；ASCII 走文本通道，create 即 ready。
 */
export async function buildAttachmentMetas(
  sessionId: string,
  assets: LocalAsset[],
): Promise<AiAttachmentMeta[]> {
  const metas: AiAttachmentMeta[] = [];
  for (const asset of assets) {
    if (asset.kind === 'ascii') {
      const text = asset.text ?? '';
      const { assetId } = await createAsciiAttachment(sessionId, asset);
      metas.push({
        asset_id: assetId,
        kind: 'ascii',
        name: `ascii-${asset.id}.txt`,
        mime: 'text/plain',
        bytes: utf8ByteLength(text),
        text,
      });
      continue;
    }
    const { assetId } = await uploadAsset(sessionId, asset);
    // 原文件还在磁盘上：气泡直接读本地，不为一屏自己的图发签名请求。
    registerLocalAssetPath(assetId, asset.localPath);
    const name = uploadNameFor(asset);
    metas.push({
      asset_id: assetId,
      kind: asset.kind,
      name,
      mime: mimeFromName(name),
      bytes: asset.bytes ?? 0,
      ...(asset.width !== undefined ? { width: asset.width } : {}),
      ...(asset.height !== undefined ? { height: asset.height } : {}),
    });
  }
  return metas;
}

/**
 * 纯素材消息（没打一个字）的兜底正文。服务端正文 `min(1)`，空正文发不出去，
 * 所以发送前必须替用户说一句。同类素材用各自的措辞；混选时用泛称，避免
 * 「请看这张手绘图」却附了张照片。
 */
export function defaultAttachmentCaption(
  assets: LocalAsset[],
  t: (key: string) => string,
): string {
  const kinds = new Set(assets.map(asset => asset.kind));
  if (kinds.size > 1) return t('attachments.defaultPrompt');
  if (kinds.has('ascii')) return t('ascii.defaultPrompt');
  if (kinds.has('photo')) return t('attachments.defaultPhotoPrompt');
  return t('drawing.defaultPrompt');
}

/**
 * ASCII 同时以代码块并入正文：服务端会把 ASCII 物化成文本附件，但模型侧
 * 走文本通道最稳——正文里看得见，字符不会被任何渲染层吃掉。超过服务端
 * 正文上限时不再追加（附件本身仍会发送）。
 */
export function withAsciiBlocks(content: string, assets: LocalAsset[]): string {
  let next = content;
  for (const asset of assets) {
    if (asset.kind !== 'ascii') continue;
    const text = asset.text?.trim();
    if (!text) continue;
    const block = `\n\n\`\`\`\n${text}\n\`\`\``;
    if (next.length + block.length > 60_000) break;
    next += block;
  }
  return next;
}

export interface SendUserMessageWithAssetsParams {
  sessionId: string;
  content: string;
  assets: LocalAsset[];
  /** 实际发送：content 已并入 ASCII 代码块，attachments 是服务端已物化的元数据。 */
  send: (content: string, attachments: AiAttachmentMeta[]) => Promise<void>;
  /** 物化阶段失败（此时消息还没发出）。屏幕用它弹一次错误提示。 */
  onUploadError?: (error: unknown) => void;
  /** 发送成功后才回调：屏幕用它清 chips 并把素材记入「最近使用」。 */
  onSent?: (sentAssets: LocalAsset[]) => void;
}

export async function sendUserMessageWithAssets({
  sessionId,
  content,
  assets,
  send,
  onUploadError,
  onSent,
}: SendUserMessageWithAssetsParams): Promise<void> {
  let attachments: AiAttachmentMeta[] = [];
  if (assets.length > 0) {
    try {
      attachments = await buildAttachmentMetas(sessionId, assets);
    } catch (error) {
      onUploadError?.(error);
      throw error;
    }
  }
  await send(withAsciiBlocks(content, assets), attachments);
  if (assets.length > 0) {
    onSent?.(assets);
  }
}
