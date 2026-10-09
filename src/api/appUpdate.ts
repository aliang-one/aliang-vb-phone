/**
 * 官网「检查更新」端点封装(aliang-official-website,与主 server 完全独立)。
 *
 * 端点:GET /api/public/downloads/check?platform=&version=&software=
 * 免鉴权、扁平 JSON(website backend download_handlers.go handlePublicVersionCheck)。
 * 直连 www.aliang.one(Next 同源代理)——不经过主 server:主 server 挂了也
 * 必须能拦强制升级。
 *
 * ⚠️ 必须显式带 software 参数:agent 客户端省略该参数只靠 platform 过滤,
 * phone 若也建 platform=android/ios 行,同平台跨软件会互相抢 latest。
 */
import { apiGet, ApiResponseError } from './client';
import { ALIANG_ACCOUNT_BASE_URL } from '../config/accountService';
import { normalizeAppVersion } from '../utils/appUpdateSemver';

export const APP_UPDATE_SOFTWARE_NAME = 'aliang-vibe-phone';

export type AppUpdatePlatform = 'ios' | 'android';

export interface UpdateCheckResult {
  /** 服务端最新版本(已归一为 v 前缀形态) */
  latestVersion: string;
  downloadUrl: string;
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

/**
 * 查一次更新。返回 null = 无可判定信息(website 未配置该软件行 404 / 版本
 * 格式非法),调用方一律按"不提示"处理,绝不当错误抛。
 */
export async function fetchUpdateCheck(
  platform: AppUpdatePlatform,
  clientVersion: string,
): Promise<UpdateCheckResult | null> {
  const version = normalizeAppVersion(clientVersion);
  if (!version) return null;
  const query =
    `?platform=${encodeURIComponent(platform)}` +
    `&version=${encodeURIComponent(version)}` +
    `&software=${encodeURIComponent(APP_UPDATE_SOFTWARE_NAME)}`;
  let payload: WebsiteCheckPayload;
  try {
    payload = await apiGet<WebsiteCheckPayload>(
      `/api/public/downloads/check${query}`,
      { baseUrl: ALIANG_ACCOUNT_BASE_URL, timeoutMs: 15_000 },
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
    downloadUrl: typeof payload.download_url === 'string' ? payload.download_url : '',
    changelog: typeof payload.changelog === 'string' ? payload.changelog : '',
    serverForceFlag: payload.force_update === true,
  };
}
