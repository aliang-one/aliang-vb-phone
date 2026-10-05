// 文案守卫(几何跟随设计 §3):跟随徽章 copy。断言 en/zh 双语 follow 三
// key(badge/sourceWeb/sourceDevice)都存在且为非空字符串;badge 必须携带
// source/cols/rows 三个插值占位(screen 的 tReplay('follow.badge', {...})
// 依赖它们),并钉住 zh 权威文案与 en 镜像,防漂移。结构仿
// aiSuggestCopy.test.ts 的 it.each 双语断言。
import zh from '../../../i18n/locales/terminal/zh.json';
import en from '../../../i18n/locales/terminal/en.json';

const FOLLOW_KEYS = ['badge', 'sourceWeb', 'sourceDevice'] as const;

const keyOf = (ns: unknown, key: string): unknown =>
  (ns as Record<string, unknown>)[key];

describe('terminal follow 跟随徽章文案', () => {
  it.each([
    ['zh', zh.follow],
    ['en', en.follow],
  ])(
    '%s: follow.badge/sourceWeb/sourceDevice 存在且为非空字符串',
    (_locale, ns) => {
      for (const key of FOLLOW_KEYS) {
        const value = keyOf(ns, key);
        expect(typeof value).toBe('string');
        expect((value as string).trim().length).toBeGreaterThan(0);
      }
    },
  );

  it('badge 携带 source/cols/rows 三个插值占位(双语)', () => {
    for (const ns of [zh.follow, en.follow]) {
      expect(ns.badge).toContain('{{source}}');
      expect(ns.badge).toContain('{{cols}}');
      expect(ns.badge).toContain('{{rows}}');
    }
  });

  it('zh 权威文案与 en 镜像不漂移', () => {
    expect(zh.follow.badge).toBe(
      '已跟随{{source}} {{cols}}×{{rows}} · 点击接管',
    );
    expect(zh.follow.sourceWeb).toBe('网页');
    expect(zh.follow.sourceDevice).toBe('其他设备');
    expect(en.follow.badge).toBe(
      'Following {{source}} {{cols}}×{{rows}} · tap to take over',
    );
    expect(en.follow.sourceWeb).toBe('web');
    expect(en.follow.sourceDevice).toBe('another device');
  });
});
