import en from '../src/i18n/locales/vibecoding/en.json';
import zh from '../src/i18n/locales/vibecoding/zh.json';

describe('tuiSharedNotice i18n resources', () => {
  it.each([
    ['en', en],
    ['zh', zh],
  ])('%s locale carries non-empty notice + dismiss copy', (_loc, res) => {
    const session = (res as unknown as { session: Record<string, string> })
      .session;
    expect(typeof session.tuiSharedNotice).toBe('string');
    expect(session.tuiSharedNotice.length).toBeGreaterThan(10);
    expect(typeof session.tuiSharedNoticeDismiss).toBe('string');
    expect(session.tuiSharedNoticeDismiss.length).toBeGreaterThan(0);
  });

  it('zh copy states auto-sync AND the busy-skip truth (no deferred-until-idle promise)', () => {
    const session = (zh as unknown as { session: Record<string, string> }).session;
    expect(session.tuiSharedNotice).toContain('自动同步');
    expect(session.tuiSharedNotice).toContain('不补发');
    expect(session.tuiSharedNotice).not.toContain('延迟到空闲');
  });

  it('en copy matches the same contract', () => {
    const session = (en as unknown as { session: Record<string, string> }).session;
    expect(session.tuiSharedNotice).toContain('automatically synced');
    expect(session.tuiSharedNotice).toContain('skipped');
    expect(session.tuiSharedNotice).not.toMatch(/will (be )?retried|retry when|later when idle|deferred until/i);
  });
});
