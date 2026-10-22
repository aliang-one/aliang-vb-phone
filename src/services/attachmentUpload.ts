/**
 * 拍照 / 相册选图 / 上传（Task 16）。
 *
 * 三条硬约束：
 * - **`includeExtra:false`**：不带回 EXIF。带 EXIF 就等于把拍摄地 GPS 坐标
 *   一起送到服务器和模型侧——用户只是想发张图。
 * - **`maxWidth/maxHeight = 1568`**：Claude 标准档的长边上限，超过会被
 *   provider 侧二次缩放。这里在采集端就缩到 1568，省一次重编码，也避开
 *   agent 那条 7.5MiB 原始字节闸门。
 * - **mime 从扩展名推导，不信 picker**。picker 的 `type` 在不同机型/相册
 *   来源上会给出 `image/heic`、`image/*` 甚至空串；服务端白名单只认
 *   jpeg/png/gif/webp，猜错就是 415。
 */
import { Platform } from 'react-native';
import {
  launchCamera,
  launchImageLibrary,
  type Asset,
  type ImagePickerResponse,
} from 'react-native-image-picker';
import ReactNativeBlobUtil from 'react-native-blob-util';
import {
  completeAttachment,
  createAttachment,
  type CreateAttachmentResponse,
} from '../api/attachments';
import {
  addAsset,
  markAssetUploaded,
  type LocalAsset,
} from './attachmentLibrary';

/** Claude 标准档长边上限。 */
export const TARGET_LONG_EDGE = 1568;
export const JPEG_QUALITY = 0.8;

/** 单次从相册最多选几张（服务端 ATTACHMENT_MAX_PER_MESSAGE = 8）。 */
export const MAX_PICK_PER_ROUND = 8;

/** 服务端只收这四种。 */
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

const COMMON_OPTIONS = {
  mediaType: 'photo' as const,
  maxWidth: TARGET_LONG_EDGE,
  maxHeight: TARGET_LONG_EDGE,
  quality: JPEG_QUALITY as 0.8,
  // 不带 EXIF（含 GPS）——见文件头。
  includeExtra: false,
};

/** 去掉 `file://` 前缀，blob-util 只认裸路径。 */
export function toLocalPath(uri: string): string {
  return uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
}

/**
 * 由文件名/路径推导 mime。扩展名不在白名单时回落 `image/jpeg`——相机与
 * 相册在 iOS 上会强制重编码成 JPEG，而 Android 的 HEIC 也在 picker 层被
 * 转码；真出现认不出的扩展名，按 jpeg 送比按原样送更可能成功。
 */
export function mimeFromName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'image/jpeg';
}

/** 上传时用的文件名：保证扩展名与 mime 一致。 */
export function uploadNameFor(asset: LocalAsset): string {
  const base = asset.localPath ? asset.localPath.split('/').pop() : undefined;
  const fallback = `attachment-${asset.id}.jpg`;
  const name = base && base.length > 0 ? base : fallback;
  return name.replace(/[^\w.\-]/g, '_');
}

interface PickedFile {
  path: string;
  name: string;
  width?: number;
  height?: number;
  bytes?: number;
}

/**
 * 把 picker 的响应收敛成「可入库的文件列表」。
 * 用户取消返回 []（不是错误）；真失败（权限/相机不可用）抛错，让调用方
 * 能区分「用户不想发」和「发不了」。
 */
export function normalizePickerResponse(
  response: ImagePickerResponse,
): PickedFile[] {
  if (response.didCancel) return [];
  if (response.errorCode) {
    throw new Error(
      response.errorMessage ?? `image picker failed: ${response.errorCode}`,
    );
  }
  const assets: Asset[] = response.assets ?? [];
  const out: PickedFile[] = [];
  for (const asset of assets) {
    if (!asset.uri) continue;
    const path = toLocalPath(asset.uri);
    const name =
      asset.fileName ?? path.split('/').pop() ?? `photo-${Date.now()}.jpg`;
    out.push({
      path,
      name,
      width: asset.width,
      height: asset.height,
      bytes: asset.fileSize,
    });
  }
  return out;
}

async function importPicked(files: PickedFile[]): Promise<LocalAsset[]> {
  const added: LocalAsset[] = [];
  for (const file of files) {
    added.push(
      await addAsset({
        kind: 'photo',
        sourcePath: file.path,
        width: file.width,
        height: file.height,
        bytes: file.bytes,
      }),
    );
  }
  return added;
}

/**
 * 拍照。Android 需要 CAMERA 运行时权限（由调用方在打开菜单前申请），
 * 这里只管采集。用户取消 → 空数组。
 */
export async function pickFromCamera(): Promise<LocalAsset[]> {
  const response = await launchCamera({
    ...COMMON_OPTIONS,
    // 不写回系统相册：用户只是想发给 AI，不该在相册里多出一张。
    saveToPhotos: false,
  });
  return importPicked(normalizePickerResponse(response));
}

/**
 * 从相册选图，支持多选（`selectionLimit: 0` = 不限制，本地再截到 8 张）。
 */
export async function pickFromLibrary(): Promise<LocalAsset[]> {
  const response = await launchImageLibrary({
    ...COMMON_OPTIONS,
    selectionLimit: 0,
  });
  const files = normalizePickerResponse(response);
  return importPicked(files.slice(0, MAX_PICK_PER_ROUND));
}

export interface UploadProgress {
  (ratio: number): void;
}

/**
 * 一次上传/创建的结果。
 *
 * `assetId` 才是**发送消息**时要带的东西：服务端 `materializeAttachments`
 * 只信 `asset_id`，其余元数据（名称/MIME/字节数）一律按服务端记录重建。
 * `objectKey` 仅供素材库回填（排障对得上 COS 日志），不参与发送。
 */
export interface UploadedAttachment {
  assetId: string;
  objectKey?: string;
}

/** UTF-8 字节数（ASCII 素材没有本地文件，bytes 只能从正文算）。 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

/**
 * ASCII 素材：走文本通道，create 时正文随请求体提交，服务端直接置 ready，
 * 没有 PUT / complete 环节。返回的 `asset_id` 用于随后发送消息时引用。
 */
export async function createAsciiAttachment(
  sessionId: string,
  asset: LocalAsset,
): Promise<UploadedAttachment> {
  const text = asset.text ?? '';
  if (!text.trim()) {
    throw new Error('ascii asset has no text');
  }
  const created: CreateAttachmentResponse = await createAttachment(sessionId, {
    kind: 'ascii',
    name: `ascii-${asset.id}.txt`,
    mime: 'text/plain',
    bytes: utf8ByteLength(text),
    text,
  });
  return { assetId: created.asset_id };
}

/**
 * 上传一张图片素材，返回服务端 asset id（发送消息用）与 object key（素材库
 * 回填用）。
 *
 * 失败一律抛：**不写 uploadedAt**——没传成功却记成已上传，重发时会拿一个
 * 服务端不存在的 key 去签名，用户看到的是「图片已过期」。
 */
export async function uploadAsset(
  sessionId: string,
  asset: LocalAsset,
  onProgress?: UploadProgress,
): Promise<UploadedAttachment> {
  if (asset.kind === 'ascii') {
    throw new Error('ascii assets go through createAsciiAttachment');
  }
  if (!asset.localPath) {
    throw new Error('image asset has no local file');
  }
  const name = uploadNameFor(asset);
  const mime = mimeFromName(name);

  const created: CreateAttachmentResponse = await createAttachment(sessionId, {
    kind: asset.kind,
    name,
    mime,
    bytes: asset.bytes ?? 0,
    width: asset.width,
    height: asset.height,
  });

  if (created.status === 'ready') {
    // 服务端直判 ready 的情形：没有 PUT 环节。
    return { assetId: created.asset_id, objectKey: created.object_key };
  }
  if (!created.put_url) {
    throw new Error('server did not return an upload url');
  }

  const task = ReactNativeBlobUtil.fetch(
    'PUT',
    created.put_url,
    { 'Content-Type': mime },
    ReactNativeBlobUtil.wrap(asset.localPath),
  );
  if (onProgress) {
    // 进度只用于 UI，不参与成败判定；ratio 夹在 [0,1] 内防止 total 未知时
    // 出现 Infinity/NaN 让进度条宽度变成 NaN。
    task.progress({ interval: 250 }, (received, total) => {
      const ratio = total > 0 ? Math.min(1, received / total) : 0;
      onProgress(ratio);
    });
  }
  const response = await task;
  const status = Number(response.info().status);
  if (status < 200 || status >= 300) {
    throw new Error(`attachment upload failed: http ${status}`);
  }

  await completeAttachment(sessionId, created.asset_id);
  if (created.object_key) {
    // 回填 objectKey：同一张图重发时排障能对上 COS 日志。写失败不影响本次
    // 发送（markAssetUploaded 对不存在的 id 静默），所以不包 try。
    await markAssetUploaded(asset.id, created.object_key);
  }
  onProgress?.(1);
  return { assetId: created.asset_id, objectKey: created.object_key };
}

/**
 * 上传一组素材，串行执行并汇报整体进度。
 *
 * 串行不是性能选择而是正确性选择：移动网络下并发 PUT 会互相抢带宽，
 * 每张都变慢，进度条也失去意义。整体进度 = 已完成张数 + 当前张的进度。
 */
export async function uploadAssets(
  sessionId: string,
  assets: LocalAsset[],
  onProgress?: UploadProgress,
): Promise<UploadedAttachment[]> {
  const uploaded: UploadedAttachment[] = [];
  for (let i = 0; i < assets.length; i += 1) {
    const result = await uploadAsset(sessionId, assets[i], ratio => {
      onProgress?.((i + ratio) / assets.length);
    });
    uploaded.push(result);
  }
  onProgress?.(1);
  return uploaded;
}

/** 当前平台是否需要运行时相机权限申请（iOS 由系统在 launchCamera 时弹）。 */
export const CAMERA_NEEDS_RUNTIME_PERMISSION = Platform.OS === 'android';
