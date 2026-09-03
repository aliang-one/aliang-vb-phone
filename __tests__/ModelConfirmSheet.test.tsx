import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeContext } from '../src/theme/ThemeContext';
import { utilityMinimalist } from '../src/theme/themes/utilityMinimalist';

const mockUserDefault: Record<string, unknown> = { provider: null, model: null, effort: null };
jest.mock('../src/hooks/useModelOptions', () => ({
  useModelOptions: () => ({ providerCatalog: [], userDefault: mockUserDefault, refresh: jest.fn() }),
}));

import { ModelConfirmSheet } from '../src/components/vibecoding/ModelConfirmSheet';

const Providers: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ThemeContext.Provider value={{ theme: utilityMinimalist, mode: 'light', setMode: jest.fn(), isDark: false }}>
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, right: 0, bottom: 0, left: 0 } }}>
      {children}
    </SafeAreaProvider>
  </ThemeContext.Provider>
);

const wrap = async (ui: React.ReactElement) => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <Providers>{ui}</Providers>,
    );
    await Promise.resolve();
  });
  return renderer!;
};
const touchByTestID = (root: ReactTestRenderer.ReactTestInstance, testID: string) =>
  root.findAllByType(TouchableOpacity).find(c => c.props?.testID === testID);
const byTestID = (root: ReactTestRenderer.ReactTestInstance, testID: string) =>
  root.findAll(node => typeof node === 'object' && node.props?.testID === testID)[0];
const tap = (root: ReactTestRenderer.ReactTestRenderer, testID: string) => {
  const btn = touchByTestID(root.root, testID);
  act(() => { btn?.props?.onPress?.(); });
};
const allText = (root: ReactTestRenderer.ReactTestRenderer): string =>
  root.root.findAllByType(Text).map(t => {
    const c = t.props.children;
    return Array.isArray(c) ? c.join('') : String(c ?? '');
  }).join(' ');

const baseProps = {
  open: true,
  onClose: jest.fn(),
  provider: 'codex' as const,
  manualModel: '',
  manualEffort: '',
  onConfirm: jest.fn(),
  onGoToMeSettings: jest.fn(),
};

describe('ModelConfirmSheet', () => {
  beforeEach(() => {
    Object.keys(mockUserDefault).forEach(k => delete mockUserDefault[k]);
    Object.assign(mockUserDefault, { provider: null, model: null, effort: null });
  });

  it('Me 有默认:展示解析值+「Me 页默认」来源,按钮组=确认/返回修改', async () => {
    Object.assign(mockUserDefault, { provider: 'codex', model: 'gpt-5.4', effort: 'high' });
    const root = await wrap(<ModelConfirmSheet {...baseProps} />);
    expect(allText(root)).toContain('gpt-5.4');
    expect(allText(root)).toContain('Me 页默认');
    expect(allText(root)).toContain('high');
    expect(touchByTestID(root.root, 'sheet-btn-confirm')).toBeTruthy();
    expect(touchByTestID(root.root, 'sheet-btn-back')).toBeTruthy();
    expect(touchByTestID(root.root, 'sheet-btn-go-me')).toBeUndefined();
  });

  it('Me 空:展示「provider 内置默认/CLI 默认」+引导提示,按钮组=去设置/仍用默认', async () => {
    const root = await wrap(<ModelConfirmSheet {...baseProps} />);
    expect(allText(root)).toContain('provider 内置默认');
    expect(allText(root)).toContain('可在 Me 页配置');
    expect(touchByTestID(root.root, 'sheet-btn-go-me')).toBeTruthy();
    expect(touchByTestID(root.root, 'sheet-btn-start-anyway')).toBeTruthy();
    expect(touchByTestID(root.root, 'sheet-btn-confirm')).toBeUndefined();
  });

  it('跨 provider:Me 默认不适用,标 CLI 默认且出现引导', async () => {
    Object.assign(mockUserDefault, { provider: 'claude_code', model: 'glm-5.2', effort: 'high' });
    const root = await wrap(<ModelConfirmSheet {...baseProps} />);
    expect(allText(root)).not.toContain('glm-5.2');
    expect(allText(root)).toContain('CLI 默认');
    expect(touchByTestID(root.root, 'sheet-btn-go-me')).toBeTruthy();
  });

  it('手动指定字段标「本次选择」,未指定字段按 Me/CLI 解析', async () => {
    Object.assign(mockUserDefault, { provider: 'codex', model: 'gpt-5.4', effort: 'high' });
    const root = await wrap(<ModelConfirmSheet {...baseProps} manualModel="gpt-5.5" />);
    expect(allText(root)).toContain('gpt-5.5');
    expect(allText(root)).toContain('本次选择');
    expect(allText(root)).toContain('high');
  });

  it('回调:确认/仍用默认→onConfirm;返回修改→onClose;去设置→onGoToMeSettings', async () => {
    const onClose = jest.fn();
    const onConfirm = jest.fn();
    const onGoToMeSettings = jest.fn();
    const meEmpty = await wrap(
      <ModelConfirmSheet {...baseProps} onClose={onClose} onConfirm={onConfirm} onGoToMeSettings={onGoToMeSettings} />,
    );
    tap(meEmpty, 'sheet-btn-start-anyway');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    tap(meEmpty, 'sheet-btn-go-me');
    expect(onGoToMeSettings).toHaveBeenCalledTimes(1);

    Object.assign(mockUserDefault, { provider: 'codex', model: 'gpt-5.4', effort: 'high' });
    const meSet = await wrap(
      <ModelConfirmSheet {...baseProps} onClose={onClose} onConfirm={onConfirm} onGoToMeSettings={onGoToMeSettings} />,
    );
    tap(meSet, 'sheet-btn-confirm');
    expect(onConfirm).toHaveBeenCalledTimes(2);
    tap(meSet, 'sheet-btn-back');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('open=false 不渲染内容', async () => {
    const root = await wrap(<ModelConfirmSheet {...baseProps} open={false} />);
    expect(allText(root)).not.toContain('确认模型配置');
  });

  it('关闭转场:open true→false 后内容立即收起(visible 门控)', async () => {
    Object.assign(mockUserDefault, { provider: 'codex', model: 'gpt-5.4', effort: 'high' });
    const root = await wrap(<ModelConfirmSheet {...baseProps} />);
    expect(byTestID(root.root, 'sheet-model-value')).toBeTruthy();
    expect(byTestID(root.root, 'sheet-btn-confirm')).toBeTruthy();
    act(() => {
      root.update(
        <Providers>
          <ModelConfirmSheet {...baseProps} open={false} />
        </Providers>,
      );
    });
    // BottomSheet 外壳(标题等)在关闭动画期间仍挂载,但 body 内容随 open 立即收起
    expect(byTestID(root.root, 'sheet-model-value')).toBeUndefined();
    expect(byTestID(root.root, 'sheet-effort-value')).toBeUndefined();
    expect(byTestID(root.root, 'sheet-btn-confirm')).toBeUndefined();
  });
});
