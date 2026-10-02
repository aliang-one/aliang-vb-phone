import { apiPost } from './client';

/**
 * 终端网页扫码配对(规格 2026-10-01-terminal-web-qr-pairing §5/§9)。
 *
 * 网页(terminal.aliang.one)WS register 后渲染二维码
 * `https://terminal.aliang.one/pair#pid=<pairingId>&s=<secret>`;手机扫到后
 * 用 extractTerminalWebPair 解析,确认(WebPairConfirmSheet)后调
 * approveTerminalWebPair 让 server 建立 Grant 并把 terminal 元信息推给网页。
 */

/** 二维码宿主(严格相等白名单,URL 已把 hostname 规范化为小写)。 */
export const TERMINAL_WEB_PAIR_HOST = 'terminal.aliang.one';

export interface TerminalWebPair {
  pairingId: string;
  secret: string;
}

/**
 * 从扫码原始内容里提取网页配对的 pid/s。
 *
 * 仅接受 hostname === TERMINAL_WEB_PAIR_HOST 的 URL(严格相等,子域/后缀
 * 仿冒一律拒绝;scheme 不限——容忍 http 测试页,生产是 https),hash 去掉
 * 前导 '#' 后须同时有非空 pid 与 s。其它内容(扫登录 sc_ 码、垃圾串)一律
 * undefined。
 */
export function extractTerminalWebPair(rawValue: string): TerminalWebPair | undefined {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.hostname !== TERMINAL_WEB_PAIR_HOST) {
    return undefined;
  }
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  const params = new URLSearchParams(hash);
  const pairingId = params.get('pid');
  const secret = params.get('s');
  if (!pairingId || !secret) {
    return undefined;
  }
  return { pairingId, secret };
}

export interface ApproveTerminalWebPairResult {
  ok: boolean;
}

/**
 * 手机侧:批准网页配对。apiPost 自动带手机 JWT 鉴权头。
 *
 * 消费方错误契约(确认弹窗按此给文案,server Task 6):
 * - 400 `validation_error`
 * - 401 未登录
 * - 404 `pairing_not_found` —— 二维码过期**或已被用过**(pending 一次性消费
 *   即删,没有 409"已被用"分支,勿按其实现)
 * - 403 `pairing_secret_mismatch` 或 `remote_terminal_disabled`
 * - 409 `pairing_disconnected`(网页已断开,提示刷新网页重扫)或
 *   `pairing_already_granted`(理论不可达,归通用 409 文案)
 * - 200 `{ok:true, terminal:{...}}`,其中 terminal.status 可能为
 *   'creating'(attach 回填的同步前缀,正常,勿当错误)
 */
export function approveTerminalWebPair(args: {
  pairingId: string;
  secret: string;
  terminalId: string;
}): Promise<ApproveTerminalWebPairResult> {
  return apiPost<ApproveTerminalWebPairResult>('/api/terminal-web/pair/approve', {
    pairing_id: args.pairingId,
    secret: args.secret,
    terminal_id: args.terminalId,
  });
}
