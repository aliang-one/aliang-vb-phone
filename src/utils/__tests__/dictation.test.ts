import {
  IDLE_DICTATION,
  applyDictationLive,
  commitDictationText,
  replaceSegment,
  resolveDictationAnchor,
  revertDictation,
  type DictationSession,
} from '../dictation';

describe('replaceSegment', () => {
  it('光标在中间：插入并保留前后文', () => {
    expect(replaceSegment('hello world', 5, 0, ' beautiful')).toBe('hello beautiful world');
  });
  it('光标在末尾：纯追加', () => {
    expect(replaceSegment('hello', 5, 0, ' world')).toBe('hello world');
  });
  it('空 input：直接成为新文本', () => {
    expect(replaceSegment('', 0, 0, 'hi')).toBe('hi');
  });
  it('片段收缩：识别改口变短时正确替换旧片段', () => {
    // "继续帮我" (segLen=4) 改口成 "继续" (incoming=2)
    expect(replaceSegment('继续帮我，然后', 0, 4, '继续')).toBe('继续，然后');
  });
  it('incoming 为空串：片段被清掉（partial 中间态）', () => {
    expect(replaceSegment('AB文案CD', 2, 2, '')).toBe('ABCD');
  });
});

describe('resolveDictationAnchor', () => {
  it('从未聚焦（null selection）：追加到末尾，不取 0', () => {
    expect(resolveDictationAnchor(null, 7)).toEqual({ cursor: 7, segLen: 0 });
  });
  it('空选区：在光标处插入', () => {
    expect(resolveDictationAnchor({ start: 3, end: 3 }, 10)).toEqual({ cursor: 3, segLen: 0 });
  });
  it('非空选区：segLen = 选区长度（首次更新即替换选区）', () => {
    expect(resolveDictationAnchor({ start: 2, end: 5 }, 10)).toEqual({ cursor: 2, segLen: 3 });
  });
});

describe('applyDictationLive（在途片段滑动替换）', () => {
  const base: DictationSession = { active: true, cursor: 0, segLen: 0 };
  it('首次更新：插入 live 并回报新 segLen', () => {
    expect(applyDictationLive(base, '前文', '你好')).toEqual({ input: '你好前文', segLen: 2 });
  });
  it('连续更新：新 live 替换上一段在途片段', () => {
    const s: DictationSession = { active: true, cursor: 0, segLen: 2 };
    expect(applyDictationLive(s, '你好前文', '你好，世界')).toEqual({ input: '你好，世界前文', segLen: 5 });
  });
  it('inactive 时恒等返回（finishWith 尾随空更新不得抹掉已定稿文本）', () => {
    // 真实时序：finishWith 置 liveCaption='' 并同步触发 onComplete（清 active），
    // 随后 effect 才跑 → 此时 session.active=false，必须原样返回。
    const s: DictationSession = { active: false, cursor: 0, segLen: 5 };
    expect(applyDictationLive(s, '已定稿文本', '')).toEqual({ input: '已定稿文本', segLen: 5 });
  });
  it('幂等：同一 live 重复应用不重复插入', () => {
    const s1: DictationSession = { active: true, cursor: 0, segLen: 0 };
    const r1 = applyDictationLive(s1, '', '重复');
    const s2: DictationSession = { active: true, cursor: 0, segLen: r1.segLen };
    expect(applyDictationLive(s2, r1.input, '重复')).toEqual({ input: '重复', segLen: 2 });
  });
});

describe('commitDictationText / revertDictation', () => {
  const session: DictationSession = { active: true, cursor: 2, segLen: 3 };
  it('commit：用权威 final 全文替换在途段并回报落点光标', () => {
    // 在途段显示 "你好呀"(3)，服务端归一化后 full_text = "你好，呀。"
    expect(commitDictationText(session, 'AB你好呀CD', '你好，呀。')).toEqual({
      input: 'AB你好，呀。CD',
      cursor: 2 + '你好，呀。'.length,
    });
  });
  it('revert：清掉在途段还原原文', () => {
    expect(revertDictation(session, 'AB你好呀CD')).toBe('ABCD');
  });
  it('IDLE_DICTATION：哨兵会话（Task 6 复位用）', () => {
    expect(IDLE_DICTATION).toEqual({ active: false, cursor: 0, segLen: 0 });
  });
});
