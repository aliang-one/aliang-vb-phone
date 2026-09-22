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
});
