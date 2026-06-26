import { accountPost } from './accountClient';

/**
 * 手机扫码登录(对接 official-website 的 OAuth device-code 流程)。
 *
 * 桌面 agent 调 /auth/scan/init 拿到 dc_(device_code,自己轮询)+ sc_(scan_code,
 * 即二维码内容)。手机扫到 sc_ 后:scan→confirm,桌面 agent 轮询 status 命中
 * authorized 即登录(拿到与密码登录等价的 st_ + refresh),并自动把设备注册到
 * AliangPhoneServer 绑定到该用户。手机随后刷新设备列表即可看到。
 *
 * 手机用自己在 aliang.one 的 access_token(accountClient 自动带 Bearer)调用,
 * official-website 的扫码端点接受该 token(本地反查 als_sub2api_auth_tokens)。
 */

const SCAN_CODE_PREFIX = 'sc_';

export interface ScanLoginResult {
  status: string;
}

/**
 * 从扫码原始内容里提取 scan-login 的 sc_ 扫码。
 * 接受裸 sc_ 串,也容忍 ?code=sc_... / ?scan_code=sc_... 的 URL 形式。
 * 其它内容(dc_ 设备码、PAIR- 配对码、vibecoding:// 设备绑定、垃圾串)一律拒绝。
 */
export function extractScanCode(rawValue: string): string | undefined {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith(SCAN_CODE_PREFIX)) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    const code =
      url.searchParams.get('code') ?? url.searchParams.get('scan_code');
    if (code && code.startsWith(SCAN_CODE_PREFIX)) {
      return code;
    }
  } catch {
    // 不是 URL,忽略。
  }
  return undefined;
}

/** App 侧:扫码 → pending→scanned,绑定手机用户。 */
export const scanLoginScan = (code: string) =>
  accountPost<ScanLoginResult>('/auth/scan/scan', { code });

/** App 侧:确认登录 → mint st_,scanned→authorized。 */
export const scanLoginConfirm = (code: string) =>
  accountPost<ScanLoginResult>('/auth/scan/confirm', { code });

/** App 侧:拒绝登录。 */
export const scanLoginDeny = (code: string) =>
  accountPost<ScanLoginResult>('/auth/scan/deny', { code });
