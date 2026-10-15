/**
 * 官网「检查更新」端点封装(aliang-official-website,与主 server 完全独立)。
 *
 * 端点:GET /api/public/downloads/check?platform=&version=&software=
 * 免鉴权、扁平 JSON(website backend download_handlers.go handlePublicVersionCheck)。
 * ⚠️ 必须走 accountClient(它会真正消费 options.baseUrl)——client.ts 的
 * apiFetch 不解构 baseUrl,会把请求打到主平台服务器(404 被"未配置"防御
 * 吞掉,整条链路无声失效,2026-10-09 对抗审计实录)。
 *
 * ⚠️ 必须显式带 software 参数:agent 客户端省略该参数只靠 platform 过滤,
 * phone 若也建 platform=android/ios 行,同平台跨软件会互相抢 latest。
 */
import { accountGet } from './accountClient';
import { ApiResponseError } from './client';
import { ALIANG_ACCOUNT_BASE_URL } from '../config/accountService';
import { normalizeAppVersion } from '../utils/appUpdateSemver';

export const APP_UPDATE_SOFTWARE_NAME = 'aliang-vibe-phone';

export type AppUpdatePlatform = 'ios' | 'android';

export interface UpdateCheckResult {
  /** 服务端最新版本(已归一为 v 前缀形态) */
  latestVersion: string;
  /** 已过白名单的下载地址(不合规则为空串,UI 回退落地页) */
  downloadUrl: string;
  /** 已消毒截断的更新说明 */
  changelog: string;
  /** 服务端最新行的 force_update 标志(是否强制由本地复算,见 appUpdateSemver) */
  serverForceFlag: boolean;
}

interface WebsiteCheckPayload {
  software_name?: string;
  platform?: string;
  current_version?: string;
  latest_version?: string;
  download_url?: string;
  file_type?: string;
  force_update?: boolean;
  needs_update?: boolean;
  changelog?: string;
}

const CHANGELOG_MAX_LENGTH = 8_192;
const DOWNLOAD_URL_MAX_LENGTH = 2_048;

/**
 * 下载地址白名单:仅放行 https + 自有域(*.aliang.one / aliang.one)与系统
 * 商店 scheme。强制更新门是一个不可关闭的全屏按钮——域被劫持/配置错乱时,
 * 不能让它变成指哪打哪的钓鱼入口;不合规则回退空串(UI 用兜底落地页)。
 *
 * 商店 scheme 收紧(2026-10-15 审计):itms-services 是「任意 manifest URL」
 * 的企业 OTA 通道——只看前缀放行等于让强制更新门可以指向任意 plist 安装
 * 包,整条移除(iOS 走 App Store,itms-apps 只放行官方商店主机);market://
 * 只放行 Play 商店的 details?id= 形态。
 */
export function sanitizeDownloadUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > DOWNLOAD_URL_MAX_LENGTH) return '';
  const ownHttps = /^https:\/\/([\w-]+\.)*aliang\.one(:\d+)?(\/|$)/i.test(trimmed);
  const appStore = /^itms-apps:\/\/(itunes\.apple\.com|apps\.apple\.com)(\/|$)/i.test(
    trimmed,
  );
  const playStore = /^market:\/\/details\?id=/i.test(trimmed);
  return ownHttps || appStore || playStore ? trimmed : '';
}

/**
 * 更新说明消毒:剥离控制字符与 BiDi 覆写/定向符(U+202A-E/2066-9;LRM/RLM
 * U+200E/F 与 U+061C 不改视觉顺序但可携带隐藏指令,一并剥离;DEL/C1 控制段),
 * 截断到 8KB——MB 级文本在"不可关闭的全屏门"里渲染会把 JS 线程打满。
 * (2026-10-15 审计补全字符类。)
 */
export function sanitizeChangelog(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const cleaned = raw.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/g,
    '',
  );
  if (cleaned.length <= CHANGELOG_MAX_LENGTH) return cleaned;
  return `${cleaned.slice(0, CHANGELOG_MAX_LENGTH)}…`;
}

/** 布尔宽松归一:序列化失误把 true 写成 "true" 时,宁可认强(方向安全)。 */
function lenientBool(value: unknown): boolean {
  return value === true || value === 'true';
}

/**
 * 查一次更新。返回 null = 无可判定信息(website 未配置该软件行 404 / 版本
 * 格式非法),调用方一律按"不提示"处理,绝不当错误抛。
 *
 * signal:调用方硬死线用——到点中止底层 fetch,不留悬挂请求累积
 * (accountClient 的超时只包住 fetch() 响应头,响应体阶段靠这里取消)。
 */
export async function fetchUpdateCheck(
  platform: AppUpdatePlatform,
  clientVersion: string,
  signal?: AbortSignal,
): Promise<UpdateCheckResult | null> {
  const version = normalizeAppVersion(clientVersion);
  if (!version) return null;
  const query =
    `?platform=${encodeURIComponent(platform)}` +
    `&version=${encodeURIComponent(version)}` +
    `&software=${encodeURIComponent(APP_UPDATE_SOFTWARE_NAME)}`;
  let payload: WebsiteCheckPayload;
  try {
    payload = await accountGet<WebsiteCheckPayload>(
      `/api/public/downloads/check${query}`,
      {
        baseUrl: ALIANG_ACCOUNT_BASE_URL,
        signal,
        // 这是公开免鉴权端点,不是会话基础设施:绝不参与 accountFetch 的
        // refresh/重试/notifySessionInvalidated 链——website 侧意外 401 时,
        // 否则一次「检查更新」能把用户从主平台登出(2026-10-15 审计)。
        skipRefreshRetry: true,
      },
    );
  } catch (error) {
    // 404 = 该 platform+software 无任何行:官网还没配置本 app,静默当无更新。
    if (error instanceof ApiResponseError && error.status === 404) return null;
    throw error;
  }
  const latestVersion = normalizeAppVersion(payload?.latest_version);
  if (!latestVersion) return null;
  return {
    latestVersion,
    downloadUrl: sanitizeDownloadUrl(payload?.download_url),
    changelog: sanitizeChangelog(payload?.changelog),
    serverForceFlag: lenientBool(payload?.force_update),
  };
}
