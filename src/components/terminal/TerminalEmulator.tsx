import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/useTheme';
import { getTerminalHtml, getTerminalThemePalette } from './terminalHtml';
import { platformTransport } from '../../services/platformTransport';
import {
  requeuePendingTerminalOutput,
  registerTerminalOutputHandler,
  unregisterTerminalOutputHandler,
} from '../../services/terminalOutputRegistry';
import {
  createTerminalOutputBatcher,
  TERMINAL_OUTPUT_FLUSH_MS,
  type TerminalOutputBatcher,
} from '../../utils/terminalOutputBatcher';
import {
  consumeTerminalGeometryTakeover,
  markLocalTerminalResize,
} from '../../services/terminalGeometryFollow';
import { useControlCenterStore } from '../../store/controlCenterStore';

/** Geometry-follow descriptor (设计 §1/§2,与 store 的 `geometryFollow` 同构)。 */
export type TerminalFollowGeometry = {
  cols: number;
  rows: number;
  origin: 'web' | 'phone';
};

interface TerminalEmulatorProps {
  /** Server-side terminal session ID */
  sessionId: string;
  /** Whether terminal input is accepted. Output is still buffered/rendered. */
  enabled: boolean;
  /** Optional ref bridge for sending shortcut keys/commands into xterm.js. */
  terminalRef?: React.MutableRefObject<TerminalEmulatorHandle | null>;
  /** Request the native hidden keyboard proxy to focus when xterm is touched. */
  onFocusRequest?: () => void;
  /** Fires after xterm reports its first render from inside the WebView. */
  onRendered?: () => void;
  /** Fires when the WebView reports a terminal resource/runtime load failure. */
  onRenderError?: (message: string) => void;
  /**
   * Scrollback replay chunks for the session (the store's `replayChunks`,
   * fed by `terminal.replay` frames), in arrival order. Written into xterm
   * verbatim after the WebView is ready and BEFORE the live feed is wired, so
   * history renders exactly once and never interleaves with live output.
   *
   * Encoding contract: every chunk is display-ready text — the store decodes
   * base64 replay frames at ingest (see appendTerminalReplayChunk), so chunks
   * are injected verbatim with `encoding='text'`, mirroring the live path's
   * end-to-end fidelity.
   */
  replayChunks?: string[];
  /**
   * True once the final `terminal.replay` frame arrived — `replayChunks` are
   * complete to render. While false with buffered chunks, live wiring waits
   * (the agent starts the live stream only after the final frame, so nothing
   * can be lost by waiting).
   */
  replayReady?: boolean;
  /**
   * True while an attach replay stream has BEGUN but no frame has landed yet
   * (the store's `replayPending`). The handoff waits on it too: before the
   * first frame `replayChunks` is still empty, so chunks-based waiting alone
   * would wire the live feed during the attach window and the late history
   * would be appended on top of live output (Bug D ②).
   */
  replayPending?: boolean;
  /**
   * Status carried by the final replay frame. `'exited'` renders the
   * "session ended · history below" banner above the emulator.
   */
  replayStatus?: 'live' | 'exited';
  /**
   * Geometry follow (设计 §1/§2): non-null while this session's grid should
   * follow the pty geometry — the store's `geometryFollow`, set by another
   * client's `terminal.geometry_changed` and cleared on takeover. Edge
   * transitions drive the bridge: null→set injects `follow` (grid lock +
   * font scale), set→null injects `unfollow`; a geometry value change while
   * set re-injects `follow` (re-lock to the new geometry). While set, a
   * WebView resize report EQUAL to this geometry is the follow injection's
   * own echo and is dropped (never a takeover); the ready-time initial
   * resize also yields to the pending follow so the pty is not yanked back
   * to the phone geometry.
   */
  followGeometry?: TerminalFollowGeometry | null;
}

export interface TerminalEmulatorHandle {
  sendText: (data: string, options?: { focus?: boolean }) => void;
  focus: () => void;
  fit: () => void;
}

/**
 * WebView-based xterm.js terminal emulator.
 *
 * Data flow:
 *   xterm.js input → postMessage → RN → WS terminal.input → Server → Agent
 *   Agent → Server → WS terminal.output → RN → injectJS → xterm.js write
 */
export const TerminalEmulator: React.FC<TerminalEmulatorProps> = ({
  sessionId,
  enabled,
  terminalRef,
  onFocusRequest,
  onRendered,
  onRenderError,
  replayChunks,
  replayReady,
  replayPending,
  replayStatus,
  followGeometry,
}) => {
  const { isDark, theme } = useTheme();
  const { t } = useTranslation('terminal');
  const webViewRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const renderedRef = useRef(false);
  // Output batcher — lazily created (see getOutputBatcher); drained + requeued
  // to the registry on teardown so no chunk is lost or cross-injected.
  const batcherRef = useRef<TerminalOutputBatcher | null>(null);
  // Replay → live seam: true once this mount claimed the live output feed.
  // Until then the registry's pending buffer holds any arriving output, which
  // keeps live bytes strictly BEHIND the replayed scrollback.
  const liveWiredRef = useRef(false);
  // True once this mount wrote the replay chunks into xterm (consumed once).
  const replayConsumedRef = useRef(false);
  // WebView announced readiness — gates the replay injection + live wiring.
  const [webViewReady, setWebViewReady] = useState(false);
  // Geometry-follow mirror (latest-value ref): onMessage reads the current
  // follow geometry synchronously without joining it into the callback deps.
  const followRef = useRef(followGeometry ?? null);
  followRef.current = followGeometry ?? null;
  // Previous followGeometry for edge-transition detection in the inject effect.
  const prevFollowRef = useRef<TerminalFollowGeometry | null>(null);
  // True once the CURRENT follow state has actually been injected into the
  // bridge (set by the follow effect's injection branches, cleared on session
  // change / unfollow). Gates the resize branch: a report arriving while a
  // follow is pending-but-not-injected is the WebView startup fit's echo of
  // the phone geometry — mistaking it for a takeover would clear the pending
  // follow, misjudge the later follow echo too, and storm resizes.
  // 语义注意:闸在 dispatch 时置位,非 WebView 执行时——注入还在原生桥队列中时到达的 resize 回报不会被闸拦(病态时序,自愈于下一条 geometry_changed;见 Task 13 复审记录)。
  const followInjectedRef = useRef(false);
  const [liveWired, setLiveWired] = useState(false);
  // "已回放" badge bit: this mount rendered a non-empty replay.
  const [replayed, setReplayed] = useState(false);
  const html = useRef(getTerminalHtml(isDark)).current;
  const terminalTheme = useMemo(() => getTerminalThemePalette(isDark), [isDark]);
  const terminalThemeJson = useMemo(() => JSON.stringify(terminalTheme), [terminalTheme]);

  const injectTerminalData = useCallback(
    (type: string, payload = '', encoding = 'text', focus = true) => {
      webViewRef.current?.injectJavaScript(
        `if (window.injectTerminalData) { window.injectTerminalData(${JSON.stringify(
          type,
        )}, ${JSON.stringify(payload)}, ${JSON.stringify(
          encoding,
        )}, ${JSON.stringify(focus)}); } true;`,
      );
    },
    [],
  );

  // Output batching (2026-10 卡顿修复):PTY 回显按 pty.onData 原样转发,逐块
  // injectJavaScript 意味着每个回显字符一次原生桥穿越 —— 打字/刷屏即卡。路由
  // 到模拟器的块先进批处理器:空闲首块立即渲染(零附加回显延迟),突发其余块
  // 合并为单次注入(脚本内逐块调用,xterm.write 排队保序,字节流语义不变)。
  const injectOutputBatch = useCallback(
    (items: { data: string; encoding: string }[]) => {
      if (!webViewRef.current || items.length === 0) return;
      const calls = items
        .map(
          item =>
            `window.injectTerminalData("output", ${JSON.stringify(
              item.data,
            )}, ${JSON.stringify(item.encoding)}, false);`,
        )
        .join('');
      webViewRef.current.injectJavaScript(
        `if (window.injectTerminalData) { ${calls} } true;`,
      );
    },
    [],
  );

  const getOutputBatcher = useCallback(() => {
    if (!batcherRef.current) {
      batcherRef.current = createTerminalOutputBatcher(
        injectOutputBatch,
        TERMINAL_OUTPUT_FLUSH_MS,
        __DEV__ ? 'terminal-bridge' : undefined,
      );
    }
    return batcherRef.current;
  }, [injectOutputBatch]);

  // Forward output data from WS to xterm.js. Only ever registered after the
  // WebView is ready (see liveWired), so chunks arrive as direct injections;
  // everything from before that moment is held by the registry's pending
  // buffer and drained on wiring (through the batcher, coalesced).
  const handleOutput = useCallback(
    (data: string, encoding = 'text') => {
      getOutputBatcher().push(data, encoding);
    },
    [getOutputBatcher],
  );

  useEffect(() => {
    if (!terminalRef) return undefined;

    terminalRef.current = {
      sendText: (data: string, options?: { focus?: boolean }) => {
        if (!enabled || !data) return;
        injectTerminalData('input', data, 'text', options?.focus !== false);
      },
      focus: () => injectTerminalData('focus'),
      fit: () => injectTerminalData('fit'),
    };

    return () => {
      terminalRef.current = null;
    };
  }, [enabled, injectTerminalData, terminalRef]);

  useEffect(() => {
    readyRef.current = false;
    renderedRef.current = false;
    liveWiredRef.current = false;
    replayConsumedRef.current = false;
    // The WebView is re-keyed for the new session: its follow state starts
    // fresh, so a pending followGeometry must be able to inject again — a
    // stale prev from the previous session would suppress the injection —
    // and the injected flag must drop with it.
    prevFollowRef.current = null;
    followInjectedRef.current = false;
    setWebViewReady(false);
    setLiveWired(false);
    setReplayed(false);
  }, [sessionId]);

  useEffect(() => {
    if (!readyRef.current) return;
    injectTerminalData('theme', terminalThemeJson);
  }, [injectTerminalData, terminalThemeJson]);

  // Geometry follow (设计 §2): edge transitions of followGeometry drive the
  // bridge — null→set injects `follow` (grid lock + font scale), set→null
  // injects `unfollow`; a geometry VALUE change while already following
  // (web resized again → store overwrites geometryFollow) re-injects follow
  // so the phone re-locks to the new geometry. Injection waits for THIS
  // WebView's readiness (the `readyRef` guard covers the sessionId-swap
  // commit where `webViewReady` state is stale-true, same discipline as the
  // replay handoff below), and this effect is declared ahead of it so the
  // grid locks before scrollback is written.
  useEffect(() => {
    if (!webViewReady || !readyRef.current) return;
    // Capture the previous value BEFORE updating the ref — the transition
    // comparisons below must see the pre-change state.
    const prev = prevFollowRef.current;
    prevFollowRef.current = followGeometry ?? null;
    if (followGeometry && !prev) {
      followInjectedRef.current = true;
      injectTerminalData(
        'follow',
        JSON.stringify({ cols: followGeometry.cols, rows: followGeometry.rows }),
        'text',
        false,
      );
    } else if (
      followGeometry &&
      prev &&
      (followGeometry.cols !== prev.cols ||
        followGeometry.rows !== prev.rows)
    ) {
      // Non-null → non-null with a different geometry: re-inject follow
      // directly — the bridge's follow branch is idempotent (it clears the
      // previous scroll fallback, re-measures and re-locks); no unfollow
      // needed first. The re-injection's echo equals the NEW followRef
      // value, so the resize-echo discrimination drops it as usual.
      followInjectedRef.current = true;
      injectTerminalData(
        'follow',
        JSON.stringify({ cols: followGeometry.cols, rows: followGeometry.rows }),
        'text',
        false,
      );
    } else if (!followGeometry && prev) {
      // Follow state is gone: drop the injected flag with it (pure hygiene —
      // the resize gate consults it only while followRef is non-null).
      followInjectedRef.current = false;
      injectTerminalData('unfollow');
    }
  }, [followGeometry, webViewReady, injectTerminalData]);

  // Replay → live handoff. Order of operations once the WebView is ready:
  //   1. While a replay stream is still in flight — chunks buffered, final
  //      frame not arrived, OR merely announced (`replayPending`, first
  //      frame not landed so chunks are still empty) — the live feed is NOT
  //      wired yet. Waiting on the announcement closes the attach window
  //      where the chunks condition alone passes and stale pending output
  //      would be released into the emulator before the history (Bug D ②,
  //      probe order output → replay → replay); the agent's output gate
  //      guarantees no live bytes flow before the final frame, so waiting
  //      only ever buffers into the registry, never drops.
  //   2. A completed, non-empty replay is injected as `replay` chunks (the
  //      WebView writes them verbatim into xterm) and marks the badge bit.
  //   3. Only then is the live feed claimed, and the registry's pending
  //      buffer drained behind the replay (see liveWired effect below).
  //
  //   Residual window (Bug D, knowingly out of scope — needs the watermark/
  //   sequence scheme): bytes arriving between the attach's stream begin and
  //   the finalize still land in the registry pending and are drained behind
  //   the replay, where they can overlap the scrollback's tail (the agent's
  //   replay snapshot was taken at attach time). Related known: an ABANDONED
  //   stream (WS drops mid-stream, final never arrives) leaves the gate held
  //   — self-heal = re-entry re-attach / plain terminal.created / the
  //   reaper's terminal.closed, all of which clear the flag.
  //
  // The `readyRef.current` check guards the sessionId-change commit: state
  // (`webViewReady`) is stale-true there while the WebView is already re-keyed
  // and loading, but the reset effect above has synchronously flipped the ref
  // to false — without it, the swapped-in session's replay would be injected
  // into a WebView that cannot receive it yet (and consumed for good).
  useEffect(() => {
    if (!webViewReady || !readyRef.current) return;

    const chunks = replayChunks ?? [];
    const streamComplete = replayReady === true;

    // A merely-ANNOUNCED stream (replayPending) must hold the handoff even
    // with zero buffered chunks — the chunks condition alone passes in that
    // window (Bug D ②).
    if (
      !liveWiredRef.current &&
      !streamComplete &&
      (chunks.length > 0 || replayPending === true)
    ) {
      return;
    }

    if (streamComplete && chunks.length > 0 && !replayConsumedRef.current) {
      replayConsumedRef.current = true;
      // 'text' is contractual, not incidental: the store decodes base64
      // replay frames at ingest (appendTerminalReplayChunk), so every chunk
      // here is display-ready text.
      chunks.forEach(chunk => {
        injectTerminalData('replay', chunk, 'text', false);
      });
      setReplayed(true);
    }

    if (!liveWiredRef.current) {
      liveWiredRef.current = true;
      setLiveWired(true);
    }
  }, [webViewReady, replayReady, replayChunks, replayPending, injectTerminalData]);

  // Register/unregister the live output handler on the global socket
  // listener — only after replay consumption claimed the feed. The registry
  // owns the routing table; wiring returns whatever was buffered while no
  // handler was mounted (pre-mount AND pre-wiring windows) and it is drained
  // strictly behind the replayed scrollback.
  //
  // The `liveWiredRef.current` check guards the sessionId-change commit, where
  // `liveWired` state is stale-true for the PREVIOUS session while the reset
  // effect above has already flipped the ref to false. Without it this effect
  // re-runs for the NEW sessionId at that commit and drains its registry
  // pending buffer straight into the freshly-keyed, still-loading WebView —
  // where `window.injectTerminalData` does not exist yet, so the chunks are
  // silently lost. Registration must wait for the new WebView's `ready`.
  useEffect(() => {
    if (!liveWired || !liveWiredRef.current) return undefined;

    const batcher = getOutputBatcher();
    registerTerminalOutputHandler(sessionId, handleOutput).forEach(item => {
      // Registry-drained backlog coalesces (never leads): it is behind the
      // replayed scrollback by contract, not fresh live output.
      batcher.push(item.data, item.encoding, { leading: false });
    });

    return () => {
      // Unflushed batched output goes back to the registry's pending buffer —
      // never dropped, never injected into a WebView that has moved on to a
      // different session (sessionId swap reuses this mounted instance).
      const leftover = batcher.drain();
      requeuePendingTerminalOutput(sessionId, leftover);
      unregisterTerminalOutputHandler(sessionId);
    };
  }, [liveWired, sessionId, handleOutput, getOutputBatcher]);

  // Handle messages from xterm.js WebView
  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let payload: {
        type: string;
        data?: string;
        encoding?: string;
        cols?: number;
        rows?: number;
        message?: string;
      };
      try {
        payload = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }

      switch (payload.type) {
        case 'input':
          // Forward keystroke to server via WS
          if (enabled && payload.data) {
            const encoding = payload.encoding === 'base64' ? 'base64' : 'text';
            platformTransport.send({
              type: 'terminal.input',
              session_id: sessionId,
              encoding,
              data: payload.data,
            });
          }
          break;

        case 'resize': {
          // Forward resize to server
          if (payload.cols && payload.rows) {
            // Startup-fit gate (设计 §2,与桥侧 100ms 启动 fit 防护成对): a
            // follow can be pending but not yet injected — the WebView's
            // startup fit fires at ~100ms while the follow injection lands at
            // the next commit. Until it lands, any report is the startup fit
            // echoing the phone geometry: yield like the ready branch does
            // (no mark, no clear, no send), else the pending follow is
            // cleared, the subsequent follow echo is then misjudged against a
            // null followRef, and resizes storm.
            if (followRef.current && !followInjectedRef.current) {
              break;
            }
            // Follow-echo discrimination (设计 §2): while following, a report
            // EQUAL to the follow geometry is the bridge's own term.resize
            // echoing back (follow injection → onResize). Treating it as a
            // takeover would unfollow ourselves — drop it; an equal takeover
            // would be a no-op anyway (the grid is already at that geometry).
            // Anything else (user fit, rotation — in follow state the grid is
            // locked to the pty geometry, so a spontaneous fit yields the
            // phone's own geometry) is a genuine takeover: mark the
            // self-resize window and clear the pending follow so the
            // geometry_changed echo cannot re-follow.
            const follow = followRef.current;
            const isFollowEcho =
              follow !== null &&
              payload.cols === follow.cols &&
              payload.rows === follow.rows;
            if (!isFollowEcho) {
              // 显式夺回(2026-10-27 浏览器优先):跟随徽章 tap 先打一次性
              // 标记再 clearFollow;紧随这次 unfollow 的 fit 上报消费标记,
              // 升级为 takeover:true——服务端对「网页授权在线」的手机
              // resize 平时会降级回网页几何,只有显式夺回才放行。
              const takeover = consumeTerminalGeometryTakeover(sessionId);
              markLocalTerminalResize(sessionId);
              useControlCenterStore
                .getState()
                .clearTerminalGeometryFollow(sessionId);
              platformTransport.send({
                type: 'terminal.resize',
                session_id: sessionId,
                cols: payload.cols,
                rows: payload.rows,
                ...(takeover ? { takeover: true } : {}),
              });
            }
          }
          break;
        }

        case 'ready': {
          readyRef.current = true;
          injectTerminalData('theme', terminalThemeJson);
          // 进屏 resize 不在这里发(2026-10-27 浏览器优先):attach 已不带
          // 几何,服务端保持会话现有网格;这里携带的 cols/rows 只是 WebView
          // 的默认网格(80×24),先发就会把 PTY 砸回默认、让网页 letterbox。
          // 真正的进屏对齐由桥侧 100ms 启动 fit → onResize 走上面的 resize
          // 分支上报(尺寸没变时桥侧也会补报一条),再配合服务端的
          // 「网页授权在线 → 降级回网页几何(deferred)」协议决定跟随或夺回。
          setWebViewReady(true);
          break;
        }

        case 'rendered':
          if (!renderedRef.current) {
            renderedRef.current = true;
            onRendered?.();
          }
          break;

        case 'error':
          onRenderError?.(payload.message ?? 'Terminal WebView failed to load.');
          break;

        case 'focusrequest':
          if (enabled) {
            onFocusRequest?.();
          }
          break;
      }
    },
    [
      sessionId,
      enabled,
      injectTerminalData,
      onFocusRequest,
      onRenderError,
      onRendered,
      terminalThemeJson,
    ],
  );

  return (
    <View
      style={styles.container}
      onLayout={() => {
        // ready 前注入没有意义:桥侧还没装好 fit addon/测量函数,命令只会
        // 落到空实现上;ready 后的启动 fit 会补上首次对齐。
        if (readyRef.current) injectTerminalData('fit');
      }}
    >
      {replayStatus === 'exited' ? (
        <View
          style={[
            styles.replayBanner,
            { backgroundColor: theme.colors.surfaceContainerHigh },
          ]}
        >
          <Text
            style={[
              styles.replayBannerText,
              { color: theme.colors.onSurfaceVariant },
            ]}
          >
            {t('terminal:replay.endedBanner')}
          </Text>
        </View>
      ) : null}
      <WebView
        key={sessionId}
        ref={webViewRef}
        source={{ html }}
        onMessage={onMessage}
        style={styles.webview}
        hideKeyboardAccessoryView
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        scrollEnabled={false}
        bounces={false}
        cacheEnabled={false}
        incognito
        automaticallyAdjustContentInsets={false}
        contentMode="mobile"
      />
      {replayed ? (
        <View
          pointerEvents="none"
          style={[
            styles.replayBadge,
            {
              backgroundColor: theme.colors.surfaceContainerHigh,
              borderColor: theme.colors.outlineVariant,
            },
          ]}
        >
          <Text
            style={[
              styles.replayBadgeText,
              { color: theme.colors.onSurfaceVariant },
            ]}
          >
            {t('terminal:replay.replayedBadge')}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  replayBanner: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  replayBannerText: {
    fontSize: 12,
  },
  replayBadge: {
    position: 'absolute',
    top: 6,
    right: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  replayBadgeText: {
    fontSize: 10,
  },
});
