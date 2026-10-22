/**
 * 本地素材库（Task 15）：聊天输入框「最近选用的素材」的数据源。
 *
 * 设计取舍：
 * - **索引与文件分离**。索引是 AsyncStorage 里的一段 JSON，文件在
 *   `${DocumentDir}/attachments/<id>.<ext>`。AsyncStorage 只适合小对象，
 *   图片一律落盘，索引里只留路径。
 * - **索引坏了不能崩**。JSON.parse 失败、结构不是数组、单条缺字段，一律
 *   当作「这条不存在」丢弃，绝不抛给调用方——素材库是锦上添花，不该因为
 *   一次写坏的索引就让输入框打不开。
 * - **所有写操作串行**。add/remove/clear 都是「读索引 → 改 → 写索引」，
 *   并发执行会互相覆盖（同时拍两张照，后写的把先写的整份索引盖掉）。
 *   这里用一个 promise 链把所有写操作排队。
 * - **删文件失败不阻断索引更新**。索引是真相，文件是附件；文件删不掉只会
 *   留下一个孤儿文件（下次 clearAll 还会再试），但索引必须立刻反映用户的
 *   意图，否则列表里会出现点了删除还在的幽灵条目。
 * - **LRU 用 lastUsedAt 而不是 createdAt**。重发一张老照片不该让它仍是最旧
 *   的待淘汰项。createdAt 保持原始创建时间，排序键取 lastUsedAt ?? createdAt。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import ReactNativeBlobUtil from 'react-native-blob-util';

export type LocalAssetKind = 'photo' | 'drawing' | 'ascii';

export interface LocalAsset {
  id: string;
  kind: LocalAssetKind;
  createdAt: number;
  /** 图片类素材在库内的绝对路径；ascii 素材没有文件。 */
  localPath?: string;
  width?: number;
  height?: number;
  bytes?: number;
  /** ascii 素材的正文（图片类不带）。 */
  text?: string;
  cols?: number;
  rows?: number;
  /** 最近一次上传成功的 COS object key，命中则可跳过重传。 */
  objectKey?: string;
  uploadedAt?: number;
  /** LRU 排序键；缺省回落到 createdAt。 */
  lastUsedAt?: number;
}

export type AddAssetInput = {
  kind: LocalAssetKind;
  /** 图片类的源文件（相机/相册/view-shot 的临时路径）。 */
  sourcePath?: string;
  width?: number;
  height?: number;
  bytes?: number;
  text?: string;
  cols?: number;
  rows?: number;
};

export const ATTACHMENT_LIBRARY_KEY = 'aliang.attachmentLibrary.v1';
export const ATTACHMENT_LIBRARY_MAX = 50;

const ATTACHMENT_DIR = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/attachments`;

/** 素材库里只认这几种扩展名——与服务端 MIME 白名单一致，HEIC 一律转 JPEG。 */
const ALLOWED_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);

const KINDS: LocalAssetKind[] = ['photo', 'drawing', 'ascii'];

// --- 串行化 ---

let writeQueue: Promise<unknown> = Promise.resolve();

/**
 * 把写操作排进同一条链。前一个失败不影响后一个（catch 掉再继续），
 * 但调用方拿到的仍是自己那次的真实结果。
 */
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => undefined);
  return run;
}

// --- 索引读写 ---

function isLocalAsset(value: unknown): value is LocalAsset {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LocalAsset>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.kind === 'string' &&
    KINDS.includes(candidate.kind as LocalAssetKind) &&
    typeof candidate.createdAt === 'number' &&
    Number.isFinite(candidate.createdAt)
  );
}

/**
 * 读索引。任何异常（无值、坏 JSON、结构不对）都回落空数组——素材库丢了
 * 只是少几个快捷入口，不该连累聊天页。
 */
export async function readLibraryIndex(): Promise<LocalAsset[]> {
  try {
    const raw = await AsyncStorage.getItem(ATTACHMENT_LIBRARY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 单条坏数据只丢那一条，不整份作废。
    return parsed.filter(isLocalAsset);
  } catch {
    return [];
  }
}

async function writeLibraryIndex(assets: LocalAsset[]): Promise<void> {
  await AsyncStorage.setItem(ATTACHMENT_LIBRARY_KEY, JSON.stringify(assets));
}

// --- 文件操作 ---

function extOfPath(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot < 0 || dot === path.length - 1) return '';
  return path.slice(dot + 1).toLowerCase();
}

/** 图片素材的落盘扩展名：源文件不认识就按 jpg 存（相机/相册都会重编码成 JPEG）。 */
export function assetFileExt(asset: Pick<LocalAsset, 'kind' | 'localPath'>): string {
  if (asset.kind === 'ascii') return 'txt';
  const ext = asset.localPath ? extOfPath(asset.localPath) : '';
  return ALLOWED_IMAGE_EXTS.has(ext) ? ext : 'jpg';
}

export function assetFilePath(id: string, ext: string): string {
  return `${ATTACHMENT_DIR}/${id}.${ext}`;
}

/**
 * 本地绝对路径 → `<Image source={{uri}}>` 能吃的 file URI。
 * 索引里存的是裸路径（便于 blob-util 直接读写），但 RN 的 Image 在 iOS 上
 * 不认裸路径。空路径返回 undefined，让调用方走占位分支而不是渲染一个必然
 * 失败的空 source。
 */
export function localFileUri(path?: string): string | undefined {
  if (!path) return undefined;
  return path.startsWith('file://') ? path : `file://${path}`;
}

async function ensureAttachmentDir(): Promise<void> {
  const dir = ATTACHMENT_DIR;
  try {
    if (await ReactNativeBlobUtil.fs.exists(dir)) return;
  } catch {
    // exists 本身失败就继续走 mkdir，让真正的错误在 mkdir 处暴露。
  }
  try {
    await ReactNativeBlobUtil.fs.mkdir(dir);
  } catch (error) {
    // mkdir 的失败大多是「已存在」（并发两次 add 撞上），二次确认后吞掉；
    // 其余情况（无权限/磁盘满）必须抛——否则后面 cp 会以一个更难懂的错失败。
    if (await ReactNativeBlobUtil.fs.exists(dir).catch(() => false)) return;
    throw error;
  }
}

/** 删文件，永不抛。孤儿文件比删不掉的幽灵条目好得多。 */
async function deleteFileQuietly(path: string | undefined): Promise<void> {
  if (!path) return;
  try {
    if (await ReactNativeBlobUtil.fs.exists(path)) {
      await ReactNativeBlobUtil.fs.unlink(path);
    }
  } catch {
    // 见函数注释。
  }
}

// --- id ---

let idCounter = 0;

function newAssetId(now: number): string {
  idCounter = (idCounter + 1) % 100000;
  return `a${now.toString(36)}${idCounter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

// --- LRU ---

const lruKey = (asset: LocalAsset): number => asset.lastUsedAt ?? asset.createdAt;

/** 按最近使用倒序，截到上限，返回 { kept, evicted }。纯函数，便于测试。 */
export function applyLibraryCap(
  assets: LocalAsset[],
  max: number = ATTACHMENT_LIBRARY_MAX,
): { kept: LocalAsset[]; evicted: LocalAsset[] } {
  if (assets.length <= max) {
    return { kept: [...assets].sort((a, b) => lruKey(b) - lruKey(a)), evicted: [] };
  }
  const sorted = [...assets].sort((a, b) => lruKey(b) - lruKey(a));
  return { kept: sorted.slice(0, max), evicted: sorted.slice(max) };
}

// --- 对外 API ---

/**
 * 新增素材。图片类会把 sourcePath 复制进库目录（调用方的临时文件归调用方
 * 自己清理），ascii 只存正文。
 *
 * 返回入库后的记录；sourcePath 缺失或复制失败时抛错——静默入库一个路径
 * 指向已删除临时文件的条目，比当场失败难查得多。
 */
export function addAsset(input: AddAssetInput): Promise<LocalAsset> {
  return serialize(async () => {
    const now = Date.now();
    const id = newAssetId(now);

    let localPath: string | undefined;
    let bytes = input.bytes;

    if (input.kind !== 'ascii') {
      if (!input.sourcePath) {
        throw new Error('attachment source file is required');
      }
      await ensureAttachmentDir();
      const ext = ALLOWED_IMAGE_EXTS.has(extOfPath(input.sourcePath))
        ? extOfPath(input.sourcePath)
        : 'jpg';
      localPath = assetFilePath(id, ext);
      await ReactNativeBlobUtil.fs.cp(input.sourcePath, localPath);
      if (bytes === undefined) {
        try {
          const stat = await ReactNativeBlobUtil.fs.stat(localPath);
          bytes = Number(stat.size);
        } catch {
          // 统计失败不影响入库，bytes 留空。
        }
      }
    }

    const asset: LocalAsset = {
      id,
      kind: input.kind,
      createdAt: now,
      lastUsedAt: now,
      localPath,
      width: input.width,
      height: input.height,
      bytes,
      text: input.text,
      cols: input.cols,
      rows: input.rows,
    };

    const existing = await readLibraryIndex();
    const { kept, evicted } = applyLibraryCap([asset, ...existing]);
    await writeLibraryIndex(kept);
    // 索引写成功之后才删被淘汰的文件：反过来的话，一旦写索引失败，
    // 用户就永久失去了那几张素材（索引里还引用着已删除的路径）。
    for (const stale of evicted) {
      await deleteFileQuietly(stale.localPath);
    }
    return asset;
  });
}

/** 删除一条素材（索引先落盘，文件尽力删）。 */
export function removeAsset(id: string): Promise<void> {
  return serialize(async () => {
    const existing = await readLibraryIndex();
    const target = existing.find(asset => asset.id === id);
    if (!target) return;
    await writeLibraryIndex(existing.filter(asset => asset.id !== id));
    await deleteFileQuietly(target.localPath);
  });
}

/** 清空素材库。索引立刻清空，文件逐个尽力删。 */
export function clearLibrary(): Promise<void> {
  return serialize(async () => {
    const existing = await readLibraryIndex();
    await writeLibraryIndex([]);
    for (const asset of existing) {
      await deleteFileQuietly(asset.localPath);
    }
  });
}

/**
 * 标记一次「使用」（重发/重新选中），维持 LRU。找不到 id 时静默返回——
 * 素材可能刚在另一个入口被删掉。
 */
export function touchAsset(id: string): Promise<void> {
  return serialize(async () => {
    const existing = await readLibraryIndex();
    const index = existing.findIndex(asset => asset.id === id);
    if (index < 0) return;
    const next = [...existing];
    next[index] = { ...next[index], lastUsedAt: Date.now() };
    await writeLibraryIndex(next);
  });
}

/** 上传成功后回填 object key，避免重发时重复上传同一张图。 */
export function markAssetUploaded(
  id: string,
  objectKey: string,
): Promise<void> {
  return serialize(async () => {
    const existing = await readLibraryIndex();
    const index = existing.findIndex(asset => asset.id === id);
    if (index < 0) return;
    const next = [...existing];
    next[index] = {
      ...next[index],
      objectKey,
      uploadedAt: Date.now(),
    };
    await writeLibraryIndex(next);
  });
}

/** 测试辅助：清掉模块级串行队列（避免上一个用例的失败链影响下一个）。 */
export function resetAttachmentLibraryQueueForTest(): void {
  writeQueue = Promise.resolve();
  idCounter = 0;
}
