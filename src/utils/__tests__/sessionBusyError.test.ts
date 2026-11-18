import { classifySessionBusyError, sendFailureText, sessionBusyErrorText } from '../sessionBusyError';
import { ApiTimeoutError, ApiResponseError } from '../../api/client';

const t = (key: string) => key;

const withCode = (message: string, code: string) =>
  Object.assign(new Error(message), { code });

describe('classifySessionBusyError', () => {
  it('服务端 409 claim 失败:code=ai_session_busy 优先 → session_busy', () => {
    const error = withCode('ai_session_busy', 'ai_session_busy');
    expect(classifySessionBusyError(error)).toBe('session_busy');
  });

  it('agent TUI 预检:code=tui_busy 优先 → tui_busy', () => {
    const error = withCode(
      'TUI session is running an active turn in its terminal; retry after it finishes',
      'tui_busy',
    );
    expect(classifySessionBusyError(error)).toBe('tui_busy');
  });

  it('无 code 时按 message 关键字兜底:服务端把 code 直接当 error 文本下发', () => {
    expect(classifySessionBusyError(new Error('ai_session_busy'))).toBe('session_busy');
  });

  it('无 code 时按 message 关键字兜底:agent ai.error 英文原文', () => {
    expect(
      classifySessionBusyError(
        new Error(
          'TUI session is running an active turn in its terminal; retry after it finishes',
        ),
      ),
    ).toBe('tui_busy');
  });

  it('客户端本地 guard 文案(is still running)归为 session_busy', () => {
    expect(
      classifySessionBusyError(
        new Error('Claude Code is still running. Stop it before sending another message.'),
      ),
    ).toBe('session_busy');
  });

  it('非忙类错误(超时/网络/未知)返回 null', () => {
    expect(classifySessionBusyError(new Error('Timed out after 8000ms'))).toBeNull();
    expect(
      classifySessionBusyError(new Error('Platform connection is required')),
    ).toBeNull();
    expect(classifySessionBusyError(undefined)).toBeNull();
  });

  it('code 与 message 冲突时 code 优先(tui_busy 胜过 busy 文本)', () => {
    const error = withCode('ai_session_busy', 'tui_busy');
    expect(classifySessionBusyError(error)).toBe('tui_busy');
  });
});

describe('sessionBusyErrorText', () => {
  it('session_busy → session.error.sessionBusy', () => {
    expect(sessionBusyErrorText(withCode('ai_session_busy', 'ai_session_busy'), t)).toBe(
      'session.error.sessionBusy',
    );
  });

  it('tui_busy → session.error.sessionBusyTui', () => {
    expect(
      sessionBusyErrorText(
        new Error('TUI session is running an active turn in its terminal'),
        t,
      ),
    ).toBe('session.error.sessionBusyTui');
  });

  it('非忙类错误返回 null(调用方走既有文案)', () => {
    expect(sessionBusyErrorText(new Error('Timed out after 8000ms'), t)).toBeNull();
  });
});

describe('i18n 资源(vibecoding:session.error.*)', () => {
  const en = require('../../i18n/locales/vibecoding/en.json');
  const zh = require('../../i18n/locales/vibecoding/zh.json');

  it('zh+en 都提供 sessionBusy / sessionBusyTui,且非空', () => {
    for (const locale of [en, zh]) {
      expect(typeof locale.session.error.sessionBusy).toBe('string');
      expect(locale.session.error.sessionBusy.length).toBeGreaterThan(0);
      expect(typeof locale.session.error.sessionBusyTui).toBe('string');
      expect(locale.session.error.sessionBusyTui.length).toBeGreaterThan(0);
    }
  });
});

describe('空闲会话插话（steer 被拒）', () => {
  it('code=ai_session_not_running → session_not_running', () => {
    const error = withCode('ai_session_not_running', 'ai_session_not_running');
    expect(classifySessionBusyError(error)).toBe('session_not_running');
  });

  it('无 code 时按 message 关键字兜底', () => {
    expect(classifySessionBusyError(new Error('ai_session_not_running'))).toBe(
      'session_not_running',
    );
    expect(
      classifySessionBusyError(
        withCode('ai_session_not_running', 'ai_session_not_running'),
      ),
    ).toBe('session_not_running');
  });

  it('不被 "still running"（session_busy 家族）误吞', () => {
    // 顺序敏感：not_running 检测必须先于 busy 关键字兜底。
    expect(classifySessionBusyError(new Error('ai_session_not_running'))).not.toBe(
      'session_busy',
    );
  });

  it('sessionBusyErrorText 映射到友好文案 key', () => {
    expect(
      sessionBusyErrorText(
        withCode('ai_session_not_running', 'ai_session_not_running'),
        t,
      ),
    ).toBe('session.error.steerNotRunning');
  });
});

describe('sendFailureText', () => {
  const tp = (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key;

  it('120s 超时 → sendTimeout 带 seconds', () => {
    expect(sendFailureText(new ApiTimeoutError(120000), tp)).toBe(
      `session.error.sendTimeout:${JSON.stringify({ seconds: 120 })}`,
    );
  });

  it('服务端 409 device_offline → sendDeviceOffline', () => {
    const err = new ApiResponseError('device_offline', 409, 'device_offline');
    expect(sendFailureText(err, tp)).toBe('session.error.sendDeviceOffline');
  });

  it('403 ai_control_disabled → sendAiControlDisabled(403 不误判为登录过期)', () => {
    const err = new ApiResponseError('ai_control_disabled', 403, 'ai_control_disabled');
    expect(sendFailureText(err, tp)).toBe('session.error.sendAiControlDisabled');
  });

  it('401 → sendUnauthorized', () => {
    const err = new ApiResponseError('unauthorized', 401, 'unauthorized');
    expect(sendFailureText(err, tp)).toBe('session.error.sendUnauthorized');
  });

  it('403 无细分码 → sendUnauthorized', () => {
    const err = new ApiResponseError('forbidden', 403);
    expect(sendFailureText(err, tp)).toBe('session.error.sendUnauthorized');
  });

  it('未知 code → sendFailed 带原始 code', () => {
    const err = new ApiResponseError('weird_thing', 400, 'weird_thing');
    expect(sendFailureText(err, tp)).toBe(
      `session.error.sendFailed:${JSON.stringify({ detail: 'weird_thing' })}`,
    );
  });

  it('网络层失败(fetch TypeError)→ sendNetwork', () => {
    expect(sendFailureText(new TypeError('Network request failed'), tp)).toBe(
      'session.error.sendNetwork',
    );
  });

  it('非 Error 值 → sendFailed 兜底', () => {
    expect(sendFailureText('boom', tp)).toBe(
      `session.error.sendFailed:${JSON.stringify({ detail: 'boom' })}`,
    );
  });
});
