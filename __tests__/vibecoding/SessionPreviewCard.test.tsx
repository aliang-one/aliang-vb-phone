/**
 * SessionPreviewCard — presentational session preview card + public tunnel
 * mapping UI (14-task plan T13).
 *
 * Spec decisions under test:
 * - mapped:            public badge + publicUrl + copy/open/revoke actions
 * - failed/unavailable: neutral notice line (mappingError appended), agent
 *                      shortUrl row unaffected, no red
 * - revoked:           grey chip, ALL action buttons removed (already-copied
 *                      links may resolve until gateway expiry — that's the
 *                      user's copy, not ours); convergence is via the
 *                      server-authoritative preview.updated broadcast (T12),
 *                      so this card never does optimistic local flips
 * - no mapping fields: exactly the legacy card (shortUrl row only)
 *
 * Mocking notes: Clipboard comes from @react-native-clipboard/clipboard which
 * jest.setup.js already replaces with jest.fn's. Alert/Linking are spied on
 * the real react-native module — deliberately NOT jest.mock('react-native'),
 * because replacing Modal under the TurboModule registry crashes the suite.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Alert, Linking, Text, TouchableOpacity } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { ThemeContext } from '../../src/theme/ThemeContext';
import { utilityMinimalist } from '../../src/theme/themes/utilityMinimalist';
import { SessionPreviewCard } from '../../src/screens/vibecoding/SessionPreviewCard';
import type { PreviewLink } from '../../src/data/platformModels';

// jest.setup.js pins i18n to zh, so assertions use the zh resources.
const COPY = '复制';
const COPIED = '已复制';
const OPEN = '打开';
const REVOKE = '撤销';
const PUBLIC_BADGE = '公网';
const REVOKED_CHIP = '已撤销';
const FAILED_LINE = '公网映射未能建立';
const REVOKE_TITLE = '撤销公网映射？';
const REVOKE_BODY = '撤销后该公网地址立即失效。';

const basePreview: PreviewLink = {
  id: 'pv-1',
  sessionId: 'sess-1',
  port: 3000,
  shortUrl: 'http://192.168.1.10:443',
  targetUrl: 'http://localhost:443',
  expiresIn: '2h',
  access: 'team',
};

const mappedPreview: PreviewLink = {
  ...basePreview,
  publicUrl: 'https://pv-1.example.dev',
  portMappingId: 'pm-1',
  mappingStatus: 'mapped',
};

const renderers: ReactTestRenderer.ReactTestRenderer[] = [];

const wrap = async (ui: React.ReactElement) => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <ThemeContext.Provider
        value={{
          theme: utilityMinimalist,
          mode: 'light',
          setMode: jest.fn(),
          isDark: false,
        }}>
        {ui}
      </ThemeContext.Provider>,
    );
    await Promise.resolve();
  });
  renderers.push(renderer!);
  return renderer!;
};

const renderCard = (
  preview: PreviewLink,
  handlers: { onNavigate?: () => void; onRevoke?: () => Promise<void> } = {},
) =>
  wrap(
    <SessionPreviewCard
      preview={preview}
      onNavigate={handlers.onNavigate ?? jest.fn()}
      onRevoke={handlers.onRevoke ?? jest.fn(() => Promise.resolve())}
    />,
  );

/** Concatenate every Text node's children into one string. */
const allText = (root: ReactTestRenderer.ReactTestInstance): string =>
  root
    .findAllByType(Text)
    .map(node => {
      const children = node.props.children;
      return Array.isArray(children) ? children.join('') : String(children ?? '');
    })
    .join('\n');

/** TouchableOpacity elements whose testID matches (whole tree). Plain
 *  findAll also matches host children carrying the same testID, which would
 *  inflate counts beyond 1 per logical button. */
const byTestID = (root: ReactTestRenderer.ReactTestInstance, testID: string) =>
  root.findAllByType(TouchableOpacity).filter(el => el.props?.testID === testID);

const tap = async (
  root: ReactTestRenderer.ReactTestInstance,
  testID: string,
) => {
  const btn = byTestID(root, testID)[0];
  await act(async () => {
    btn?.props?.onPress?.();
  });
};

/** Exact-match a standalone Text child (avoids substring collisions like 公网 vs 公网映射…). */
const exactTextCount = (root: ReactTestRenderer.ReactTestInstance, value: string) =>
  root.findAllByType(Text).filter(node => node.props.children === value).length;

describe('SessionPreviewCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  });

  afterEach(() => {
    // unmount inside act: it drives updateContainer, so the act-env check
    // would otherwise warn; it also runs effect cleanup (clears copy timer).
    renderers.splice(0).forEach(renderer => act(() => renderer.unmount()));
    jest.restoreAllMocks();
  });

  it('mapped: renders legacy rows plus public badge, publicUrl and all three actions', async () => {
    const renderer = await renderCard(mappedPreview);
    const text = allText(renderer!.root);

    // Legacy card content is fully preserved.
    expect(text).toContain('Preview ready');
    expect(text).toContain('3000');
    expect(text).toContain('http://192.168.1.10:443');
    expect(text).toContain('TEAM / expires in 2h');

    // Public mapping surface.
    expect(exactTextCount(renderer!.root, PUBLIC_BADGE)).toBe(1);
    expect(text).toContain('https://pv-1.example.dev');

    expect(byTestID(renderer!.root, 'preview-copy-public')).toHaveLength(1);
    expect(byTestID(renderer!.root, 'preview-open-public')).toHaveLength(1);
    expect(byTestID(renderer!.root, 'preview-revoke')).toHaveLength(1);
  });

  it('copy: writes publicUrl to the clipboard and flips the label to "copied"', async () => {
    const renderer = await renderCard(mappedPreview);
    await tap(renderer!.root, 'preview-copy-public');

    expect(Clipboard.setString).toHaveBeenCalledWith('https://pv-1.example.dev');
    // Exact match: '复制' is a substring of '已复制'.
    expect(exactTextCount(renderer!.root, COPIED)).toBe(1);
    expect(exactTextCount(renderer!.root, COPY)).toBe(0);
  });

  it('open: hands publicUrl to Linking.openURL', async () => {
    const renderer = await renderCard(mappedPreview);
    await tap(renderer!.root, 'preview-open-public');

    expect(Linking.openURL).toHaveBeenCalledWith('https://pv-1.example.dev');
  });

  it('revoke: confirms via Alert and calls onRevoke from the destructive button', async () => {
    const onRevoke = jest.fn(() => Promise.resolve());
    const renderer = await renderCard(mappedPreview, { onRevoke });
    await tap(renderer!.root, 'preview-revoke');

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const [title, body, buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(title).toBe(REVOKE_TITLE);
    expect(body).toBe(REVOKE_BODY);
    const destructive = buttons.find(
      (button: { style?: string }) => button.style === 'destructive',
    );
    expect(typeof destructive?.onPress).toBe('function');

    await act(async () => {
      destructive.onPress();
    });
    expect(onRevoke).toHaveBeenCalledTimes(1);
  });

  it('revoked: shows the revoked chip and removes every action button', async () => {
    const renderer = await renderCard({
      ...mappedPreview,
      mappingStatus: 'revoked',
    });

    expect(exactTextCount(renderer!.root, REVOKED_CHIP)).toBe(1);
    expect(byTestID(renderer!.root, 'preview-copy-public')).toHaveLength(0);
    expect(byTestID(renderer!.root, 'preview-open-public')).toHaveLength(0);
    expect(byTestID(renderer!.root, 'preview-revoke')).toHaveLength(0);
  });

  it('failed/unavailable: neutral notice line (mappingError appended), no actions, no badge', async () => {
    const failed = await renderCard({
      ...basePreview,
      mappingStatus: 'failed',
      mappingError: 'gateway 502',
    });
    let text = allText(failed!.root);
    expect(text).toContain(`${FAILED_LINE} · gateway 502`);
    expect(text).toContain('http://192.168.1.10:443');
    expect(byTestID(failed!.root, 'preview-copy-public')).toHaveLength(0);
    expect(byTestID(failed!.root, 'preview-open-public')).toHaveLength(0);
    expect(byTestID(failed!.root, 'preview-revoke')).toHaveLength(0);
    expect(exactTextCount(failed!.root, PUBLIC_BADGE)).toBe(0);

    const unavailable = await renderCard({
      ...basePreview,
      mappingStatus: 'unavailable',
    });
    text = allText(unavailable!.root);
    expect(text).toContain(FAILED_LINE);
    expect(text).not.toContain('·');
    expect(byTestID(unavailable!.root, 'preview-revoke')).toHaveLength(0);
  });

  it('no mapping fields: exactly the legacy card (no public elements, no notice)', async () => {
    const renderer = await renderCard(basePreview);
    const text = allText(renderer!.root);

    expect(text).toContain('http://192.168.1.10:443');
    expect(text).toContain('TEAM / expires in 2h');
    expect(exactTextCount(renderer!.root, PUBLIC_BADGE)).toBe(0);
    expect(exactTextCount(renderer!.root, REVOKED_CHIP)).toBe(0);
    expect(exactTextCount(renderer!.root, FAILED_LINE)).toBe(0);
    expect(byTestID(renderer!.root, 'preview-copy-public')).toHaveLength(0);
    expect(byTestID(renderer!.root, 'preview-open-public')).toHaveLength(0);
    expect(byTestID(renderer!.root, 'preview-revoke')).toHaveLength(0);
  });
});
