import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';
import { ChangeReviewView, changeBadgeLetter, deriveDiffView } from '../src/components/projects/ChangeReviewView';
import type { DiffLine } from '../src/data/platformModels';
import type { SessionFileChange } from '../src/utils/diff/sessionChanges';

const wrap = (ui: React.ReactElement) =>
  ReactTestRenderer.create(
    <ThemeContext.Provider
      value={{ theme: utilityMinimalist, mode: 'light', setMode: jest.fn(), isDark: false }}
    >
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, right: 0, bottom: 0, left: 0 },
        }}
      >
        {ui}
      </SafeAreaProvider>
    </ThemeContext.Provider>,
  );

const collectStrings = (root: ReactTestRenderer.ReactTestInstance): string =>
  root.findAllByType(Text).map(t => String(t.props.children ?? '')).join('|');

const findByTestID = (
  root: ReactTestRenderer.ReactTestInstance,
  testID: string,
): ReactTestRenderer.ReactTestInstance =>
  root.findAll(node => typeof node === 'object' && node.props.testID === testID)[0];

const mkChange = (o: Partial<SessionFileChange>): SessionFileChange => ({
  path: 'src/a.ts',
  changeKind: 'edit',
  added: 3,
  removed: 2,
  eventId: 'e1',
  messageId: 'm1',
  itemId: 'i1',
  ...o,
});

describe('ChangeReviewView', () => {
  it('就绪态：渲染文件名 / ±计数 / pager 位置 / diff 内容', () => {
    const changes: SessionFileChange[] = [mkChange({})];
    const diffLines: DiffLine[] = [
      { type: 'context', content: 'unchanged' },
      { type: 'add', content: 'new line' },
      { type: 'remove', content: 'old line' },
    ];
    let r: ReactTestRenderer.ReactTestRenderer | undefined;
    act(() => {
      r = wrap(
        <ChangeReviewView
          changes={changes}
          index={0}
          diffLines={diffLines}
          diffState="ready"
          truncated={false}
          onPrev={jest.fn()}
          onNext={jest.fn()}
          onRetry={jest.fn()}
        />,
      );
    });
    const text = collectStrings(r!.root);
    expect(text).toContain('a.ts');
    expect(text).toContain('+3');
    expect(text).toContain('-2');
    expect(text).toContain('1/1');
    expect(text).toContain('new line');
    expect(text).toContain('old line');
  });

  it('空列表：渲染空态文案', () => {
    let r: ReactTestRenderer.ReactTestRenderer | undefined;
    act(() => {
      r = wrap(
        <ChangeReviewView
          changes={[]}
          index={0}
          diffLines={[]}
          diffState="idle"
          truncated={false}
          onPrev={jest.fn()}
          onNext={jest.fn()}
          onRetry={jest.fn()}
        />,
      );
    });
    expect(collectStrings(r!.root)).toContain('没有未提交的改动');
  });

  it('loading 态显示加载中', () => {
    let r: ReactTestRenderer.ReactTestRenderer | undefined;
    act(() => {
      r = wrap(
        <ChangeReviewView
          changes={[mkChange({})]}
          index={0}
          diffLines={[]}
          diffState="loading"
          truncated={false}
          onPrev={jest.fn()}
          onNext={jest.fn()}
          onRetry={jest.fn()}
        />,
      );
    });
    expect(collectStrings(r!.root)).toContain('加载中');
  });

  it('empty 态（无 diff）显示占位', () => {
    let r: ReactTestRenderer.ReactTestRenderer | undefined;
    act(() => {
      r = wrap(
        <ChangeReviewView
          changes={[mkChange({})]}
          index={0}
          diffLines={[]}
          diffState="empty"
          truncated={false}
          onPrev={jest.fn()}
          onNext={jest.fn()}
          onRetry={jest.fn()}
        />,
      );
    });
    expect(collectStrings(r!.root)).toContain('无 diff');
  });

  it('error 态显示失败文案，重试按钮调用 onRetry', () => {
    const onRetry = jest.fn();
    let r: ReactTestRenderer.ReactTestRenderer | undefined;
    act(() => {
      r = wrap(
        <ChangeReviewView
          changes={[mkChange({})]}
          index={0}
          diffLines={[]}
          diffState="error"
          truncated={false}
          onPrev={jest.fn()}
          onNext={jest.fn()}
          onRetry={onRetry}
        />,
      );
    });
    expect(collectStrings(r!.root)).toContain('加载 diff 失败');
    act(() => {
      findByTestID(r!.root, 'cr-retry').props.onPress();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('截断时显示截断提示', () => {
    let r: ReactTestRenderer.ReactTestRenderer | undefined;
    act(() => {
      r = wrap(
        <ChangeReviewView
          changes={[mkChange({})]}
          index={0}
          diffLines={[{ type: 'add', content: 'x' }]}
          diffState="ready"
          truncated
          onPrev={jest.fn()}
          onNext={jest.fn()}
          onRetry={jest.fn()}
        />,
      );
    });
    expect(collectStrings(r!.root)).toContain('diff 已截断');
  });

  it('翻页：下一个按钮调用 onNext；首项时上一个禁用、末项时下一个禁用', () => {
    const changes: SessionFileChange[] = [
      mkChange({ path: 'a.ts', eventId: 'e1' }),
      mkChange({ path: 'b.ts', eventId: 'e2' }),
    ];
    const onPrev = jest.fn();
    const onNext = jest.fn();
    let r: ReactTestRenderer.ReactTestRenderer | undefined;
    act(() => {
      r = wrap(
        <ChangeReviewView
          changes={changes}
          index={0}
          diffLines={[]}
          diffState="empty"
          truncated={false}
          onPrev={onPrev}
          onNext={onNext}
          onRetry={jest.fn()}
        />,
      );
    });
    // index 0：下一个可点、上一个禁用
    expect(findByTestID(r!.root, 'cr-prev').props.disabled).toBe(true);
    expect(findByTestID(r!.root, 'cr-next').props.disabled).toBe(false);
    act(() => {
      findByTestID(r!.root, 'cr-next').props.onPress();
    });
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});

describe('changeBadgeLetter', () => {
  it('create→A / edit→M / delete→D / renamed→R', () => {
    expect(changeBadgeLetter(mkChange({ changeKind: 'create' }))).toBe('A');
    expect(changeBadgeLetter(mkChange({ changeKind: 'edit' }))).toBe('M');
    expect(changeBadgeLetter(mkChange({ changeKind: 'delete' }))).toBe('D');
    expect(changeBadgeLetter(mkChange({ changeKind: 'edit', renamedFrom: 'old.ts' }))).toBe('R');
  });
});

describe('deriveDiffView', () => {
  it('无 text → empty 态、空行', () => {
    expect(deriveDiffView({ text: undefined, truncated: false })).toEqual({
      lines: [],
      state: 'empty',
      truncated: false,
    });
  });
  it('有 text → ready 态、解析后的行、truncated 透传', () => {
    const out = deriveDiffView({ text: '@@ -1 +1 @@\n+a', truncated: true });
    expect(out.state).toBe('ready');
    expect(out.truncated).toBe(true);
    expect(out.lines).toEqual([{ type: 'add', content: 'a' }]);
  });
});
