import { classifySessionBusyError, sessionBusyErrorText } from '../sessionBusyError';

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
