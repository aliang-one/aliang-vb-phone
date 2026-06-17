/**
 * 把「桌面 Agent 不可达」类错误统一翻译成人话。
 *
 * 服务端所有依赖 Agent 的接口都过 `getOnlineAgentOrThrow`（见
 * AliangPhoneServer/server/src/index.ts），Agent 不在线就抛 `409 device_offline`。
 * 客户端 `apiFetch` 把它包成 `ApiResponseError(code='device_offline')`，但只有
 * 401/403（登录失效）被集中处理，`device_offline` 需要各页面自行处理——这里给一个
 * 共享的翻译入口，避免每个页面各写一套、口径不一。
 *
 * 命中返回人话消息；返回 null 表示该错误不属于「Agent 不可达」家族，调用方应回退到
 * 自己的通用错误展示（例如 FileBrowser 的 project_path_missing 等文件类错误）。
 */
export interface DeviceErrorMessage {
  title: string;
  detail: string;
  /** true 表示这是 Agent 离线/超时类错误（可重试，非数据问题）。 */
  offline: boolean;
}

const matchesCode = (
  code: string | undefined,
  message: string,
  value: string,
): boolean => Boolean(code === value || (message && message.includes(value)));

/**
 * 识别 device_offline / agent_request_timeout 等 Agent 不可达错误。
 * 命中返回人话消息；否则返回 null（交给调用方通用处理）。
 *
 * 同时接受「已知设备离线」的哨兵：传入 `new Error('device_offline')` 即可拿到
 * 离线提示，便于在发起注定失败的请求前就用上同一套文案。
 */
export const describeDeviceError = (
  error: unknown,
): DeviceErrorMessage | null => {
  const err = error as { code?: string; message?: string } | null;
  const code = err?.code;
  const message =
    error instanceof Error ? error.message : String(err?.message ?? error ?? '');

  if (matchesCode(code, message, 'device_offline')) {
    return {
      title: '桌面 Agent 未连接',
      detail:
        '电脑端 Agent 当前不在线。请确认 Agent 正在运行并已连接到同一台服务，然后重试。',
      offline: true,
    };
  }
  if (matchesCode(code, message, 'agent_request_timeout')) {
    return {
      title: 'Agent 响应超时',
      detail:
        '桌面 Agent 未能及时响应，请稍后重试，或确认 Agent 没有被其他任务占用。',
      offline: true,
    };
  }
  return null;
};
