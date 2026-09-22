// 文案守卫(spec 2026-09-22 §4):aiSuggest 命名空间不得再出现「麦克风」/
// mic——图标已是 logo,提示词里的「麦克风」是残留误导。匹配规则:CJK
// 「麦克风」按子串;en 的 mic 大小写不敏感 + 词边界(\bmic\b,不误伤
// dynamic/atomic 一类词)。只扫 aiSuggest,不波及 voiceBash 等合法使用处。
import zh from '../../../i18n/locales/terminal/zh.json';
import en from '../../../i18n/locales/terminal/en.json';

const valuesOf = (ns: Record<string, unknown>): string[] =>
  Object.values(ns).flatMap(v =>
    typeof v === 'string'
      ? [v]
      : v !== null && typeof v === 'object'
        ? valuesOf(v as Record<string, unknown>)
        : [],
  );

describe('terminal aiSuggest 文案守卫:不提麦克风', () => {
  it.each([
    ['zh', zh.aiSuggest],
    ['en', en.aiSuggest],
  ])('%s 命名空间不含「麦克风」', (_locale, ns) => {
    for (const value of valuesOf(ns as Record<string, unknown>)) {
      expect(value.includes('麦克风')).toBe(false);
    }
  });

  it('en 命名空间不含 mic/microphone 一词', () => {
    for (const value of valuesOf(en.aiSuggest as Record<string, unknown>)) {
      expect(/\bmic\b|microphone/i.test(value)).toBe(false);
    }
  });

  it('emptyHint 描述新交互(轻点输入 / 长按说话)', () => {
    expect(zh.aiSuggest.emptyHint).toBe('轻点输入命令，长按说出命令');
    expect(en.aiSuggest.emptyHint).toBe('Tap to type a command — hold to speak it');
  });
});
