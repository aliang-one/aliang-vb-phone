// LAN 直连下载(P1-3②手机半)——候选解析 + 能力闸。
//
// 服务端契约(AliangPhoneServer feat/phone-lan-candidates,fileDownload
// status GET):download+ready 时响应携带 direct_candidates[0],形状与
// transfer.receive 的 lan_direct 同构并多一个 transfer_id(手机拨号 hello
// 需要——transfer 帧族里 agent 从 receive 帧拿到该 id,手机面没有这个
// 上下文,必须随候选显式下发):
//   { type:'lan_direct', addr:'192.168.1.10:45678', token, transfer_id,
//     expires_at, fingerprint }
// 安全面与 transfer 腿完全同构:token 是服务端签发的单用途短时凭据
// (≤30s,只经 status GET 拉取态下发,绝不进 WS 事件与缓存),fingerprint
// 是源设备 ssh_ingress…… 不——是源设备协商现签证书的 sha256;拨号侧必须
// 指纹钉扎(InsecureSkipVerify+手动比对),宁拒不同。
//
// ⚠️ 拨号腿本文件刻意不实现:RN 侧没有任何 TLS socket 能力(全仓无
// tcp/tls 原生依赖,2026-11-17 侦察定谳)。两条落地路线待拍板+真机验证:
//   a) react-native-tcp-socket 的 TLS connect(legacy 模块,Bridgeless 下
//      有 NativeEventEmitter 噪声先例,patch-package 通道已备);
//      指纹钉扎能力需读其源码另行确认,未证实前不得接线。
//   b) 自写 Nitro TLS 拨号模块(仓库已验证的新架构路径是 NitroModules)。
// 在任一路线落地并通过真机 smoke(本地网络权限弹窗 + 同 WiFi 传输)之前,
// lanDirectDialAvailable() 恒 false —— 本模块的全部行为 = 解析 + 放行
// 判定,真实下载恒走既有 COS blob-util 路径(现链路零改动)。

export interface LanDirectCandidate {
  type: string;
  addr: string;
  token: string;
  transfer_id: string;
  expires_at: string;
  fingerprint: string;
}

/** status 响应里的候选面(服务端 download+ready 才携带,其余缺省)。 */
export interface FileDownloadLanStatus {
  state?: string;
  mode?: string;
  direct_candidates?: unknown;
}

const FINGERPRINT_HEX = /^[0-9a-f]{64}$/;

/** 从 status 响应提取第一个合法 lan_direct 候选;无/畸形 → null(纯 COS)。
 * 校验面与 Go 侧 parseAgentLanDirectCandidates 对齐:addr 限 IPv4 字面量
 * +端口、token 非空 ≤128、指纹恒 64 hex、transfer_id 非空。 */
export function parseLanCandidate(status: FileDownloadLanStatus | null | undefined): LanDirectCandidate | null {
  const raw = status?.direct_candidates;
  if (!Array.isArray(raw)) return null;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    if (entry.type !== 'lan_direct') continue;
    const addr = typeof entry.addr === 'string' ? entry.addr : '';
    const token = typeof entry.token === 'string' ? entry.token : '';
    const transferId = typeof entry.transfer_id === 'string' ? entry.transfer_id : '';
    const fingerprint = typeof entry.fingerprint === 'string' ? entry.fingerprint : '';
    const expiresAt = typeof entry.expires_at === 'string' ? entry.expires_at : '';
    if (!addr || !token || token.length > 128 || !transferId) continue;
    const colon = addr.lastIndexOf(':');
    if (colon <= 0) continue;
    const host = addr.slice(0, colon);
    const port = addr.slice(colon + 1);
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || !/^\d{1,5}$/.test(port)) continue;
    if (!FINGERPRINT_HEX.test(fingerprint.toLowerCase())) continue;
    return {
      type: 'lan_direct',
      addr,
      token,
      transfer_id: transferId,
      expires_at: expiresAt,
      fingerprint: fingerprint.toLowerCase(),
    };
  }
  return null;
}

/** 拨号腿能力闸:原生 TLS socket 模块未接入前恒 false(见文件头路线拍板)。
 * 接线后此处改为探测原生模块注入(try NativeModules 判空)。 */
export function lanDirectDialAvailable(): boolean {
  return false;
}

/** 放行判定:ready 态 + 候选合法 + 拨号腿可用。任一不满足 = 走 COS
 * (blob-util 既有路径,零改动)。 */
export function shouldAttemptLanDirect(status: FileDownloadLanStatus | null | undefined): boolean {
  if (!status || status.state !== 'ready') return false;
  if (!lanDirectDialAvailable()) return false;
  return parseLanCandidate(status) !== null;
}
