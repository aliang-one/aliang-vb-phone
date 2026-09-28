import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useVoiceStt, type VoiceSttStatus } from './useVoiceStt';
import { generateCommand } from '../api/commandGen';
import { ApiResponseError } from '../api/client';
import {
  subscribeCommandGenEvents,
  type CommandGenLiveEvent,
} from '../services/commandGenEvents';
import { commandGenErrorText } from '../utils/commandGenErrorText';
import {
  chipsFromCommandGenResult,
  mergeAiSuggestions,
  type AiSuggestionChip,
} from '../utils/aiSuggestions';

export type AiSuggestPhase = 'idle' | 'recording' | 'generating' | 'recovering' | 'error';

/** commandGen 工具循环的实时进度(全部来自 commandGen.* WS 事件)。 */
export interface AiSuggestProgress {
  /** 已完成的工具调用数(tool_result 计数)。 */
  stepsDone: number;
  /** 正在执行的工具名(tool_call 到 tool_result 之间),null = 等模型出招。 */
  currentTool: string | null;
  /** runStarted 的本机时间戳(ms),null = 尚未看到首轮事件。 */
  startedAt: number | null;
}

export interface UseAiCommandSuggestionsOptions {
  deviceId: string;
  cwd: string;
  sessionId?: string;
  projectId?: string;
}

export interface UseAiCommandSuggestionsResult {
  phase: AiSuggestPhase;
  chips: AiSuggestionChip[];
  liveCaption: string;
  progress: AiSuggestProgress | null;
  errorText: string;
  textMode: boolean;
  voiceStatus: VoiceSttStatus;
  startVoice: () => void;
  stopVoice: () => void;
  submitText: (text: string) => void;
  retry: () => void;
  clearChips: () => void;
  dismissError: () => void;
  openTextInput: () => void;
  closeTextInput: () => void;
  reset: () => void;
}

// 断连恢复:HTTP 长连接会被中间设备(云端代理/NAT)在 ~60s 掐死,但服务端的
// commandGen 工具循环还在跑,结果会经常驻 WS 的 runFinished 送达。POST 网络层
// 死亡后进入 recovering:事件续流就等结果;30s 无任何事件说明 WS 也断了 → 放弃;
// 硬顶 360s(服务端 300s 预算 + 120s 收尾调用的实际上限以内)保证 UI 必然落地。
const RECOVERY_WATCHDOG_MS = 30_000;
const RECOVERY_TICK_MS = 5_000;
const RECOVERY_HARD_CAP_MS = 360_000;

type RunFinishedEvent = Extract<CommandGenLiveEvent, { type: 'commandGen.runFinished' }>;

/**
 * Terminal AI-suggest flow (spec 2026-09-21): tap the FAB to record → STT →
 * straight into commandGen (no review step; editing belongs to the long-press
 * text path) → 1-3 suggestion chips. Live commandGen.step events feed
 * `progress` while generating. reset() must be invoked when the terminal
 * session changes — stale chips must never execute in a different pty.
 */
export function useAiCommandSuggestions(
  options: UseAiCommandSuggestionsOptions,
): UseAiCommandSuggestionsResult {
  const { t } = useTranslation('terminal');
  const voiceStt = useVoiceStt();
  const [phase, setPhase] = useState<AiSuggestPhase>('idle');
  const [chips, setChips] = useState<AiSuggestionChip[]>([]);
  const [progress, setProgress] = useState<AiSuggestProgress | null>(null);
  const [errorText, setErrorText] = useState('');
  const [textMode, setTextMode] = useState(false);

  // Latest props/handlers in refs so STT's long-lived onComplete closure and
  // the unmount cleanup never go stale (same discipline as VoiceToBashModal).
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const cancelRef = useRef(voiceStt.cancel);
  cancelRef.current = voiceStt.cancel;
  const lastTextRef = useRef('');
  // Bumped on reset() so a response landing after a terminal switch is dropped
  // instead of merging the old terminal's chips into the new one.
  const generationTokenRef = useRef(0);
  // Single-flight: voice and text funnel into generate(); a second request
  // must never run while one is in flight (re-entry would race chips/phase).
  const generatingRef = useRef(false);
  // 停掉当前 run 的 WS 订阅 + 恢复看门狗(settle/reset/unmount 共用,幂等)。
  const abortRunRef = useRef<() => void>(() => {});

  const generate = useCallback(
    async (text: string) => {
      const opts = optionsRef.current;
      const trimmed = text.trim();
      if (!trimmed || !opts.deviceId) return;
      if (generatingRef.current) return;
      generatingRef.current = true;
      lastTextRef.current = trimmed;
      setTextMode(false);
      setProgress({ stepsDone: 0, currentTool: null, startedAt: null });
      setPhase('generating');
      const token = ++generationTokenRef.current;
      const genStartedAt = Date.now();

      let activeRunId: string | null = null;
      let recovering = false;
      // runFinished/failed 在 POST 还挂着时先到(代理掐线前服务端已收敛)就记下。
      // ref 持有:闭包内写入,外层读取——直接用 let 会被 TS 流分析收窄成 never。
      const finishMemoRef: { current: CommandGenLiveEvent | null } = { current: null };
      let settled = false;
      let lastEventAt = 0;
      const stepProgress: AiSuggestProgress = { stepsDone: 0, currentTool: null, startedAt: null };

      let watchdog: ReturnType<typeof setInterval> | null = null;
      const stopWatchdog = () => {
        if (watchdog) {
          clearInterval(watchdog);
          watchdog = null;
        }
      };

      const finishError = (msg: string) => {
        if (settled || token !== generationTokenRef.current) return;
        settled = true;
        abortRunRef.current();
        setErrorText(msg);
        setPhase('error');
        generatingRef.current = false;
      };
      const finishSuccess = (ev: RunFinishedEvent) => {
        if (settled || token !== generationTokenRef.current) return;
        settled = true;
        abortRunRef.current();
        setChips(prev =>
          mergeAiSuggestions(
            prev,
            chipsFromCommandGenResult({
              command: ev.finalCommand,
              commands: ev.commands,
              dangerous: ev.dangerous,
              dangerousFlags: ev.dangerousFlags,
            }),
          ),
        );
        setPhase('idle');
        generatingRef.current = false;
      };

      const unsubscribe = subscribeCommandGenEvents(event => {
        if (token !== generationTokenRef.current) return;
        if (activeRunId === null) {
          if ('runId' in event && event.runId) activeRunId = event.runId;
          else return;
        } else if ('runId' in event && event.runId && event.runId !== activeRunId) {
          return;
        }
        lastEventAt = Date.now();
        switch (event.type) {
          case 'commandGen.runStarted':
            stepProgress.startedAt = Date.now();
            setProgress({ ...stepProgress });
            break;
          case 'commandGen.step':
            if (event.kind === 'tool_call') stepProgress.currentTool = event.toolName ?? null;
            else if (event.kind === 'tool_result') {
              stepProgress.stepsDone += 1;
              stepProgress.currentTool = null;
            }
            setProgress({ ...stepProgress });
            break;
          case 'commandGen.runFinished':
            if (recovering) finishSuccess(event);
            else finishMemoRef.current = event; // POST 还挂着:由 POST 正常收尾,这里只记账
            break;
          case 'commandGen.failed':
            if (recovering) finishError(t('aiSuggest.errorGenerate'));
            else finishMemoRef.current = event;
            break;
        }
      });
      abortRunRef.current = () => {
        stopWatchdog();
        unsubscribe();
      };

      try {
        const result = await generateCommand({
          text: trimmed,
          deviceId: opts.deviceId,
          cwd: opts.cwd,
          mode: 'live',
          sessionId: opts.sessionId,
          projectId: opts.projectId,
        });
        if (token !== generationTokenRef.current) return;
        settled = true;
        abortRunRef.current();
        setChips(prev => mergeAiSuggestions(prev, chipsFromCommandGenResult(result)));
        setPhase('idle');
        generatingRef.current = false;
      } catch (e) {
        if (token !== generationTokenRef.current) return;
        // 服务器明确回的错误(限流/参数/鉴权/504 工具超时)是终态答案,不值得等;
        // 只有连接层的死法(TypeError/abort —— 中间设备掐空闲长连接)且 run 确认
        // 已开跑,才值得切恢复态等 WS 送达。
        if (e instanceof ApiResponseError || !activeRunId) {
          settled = true;
          abortRunRef.current();
          setErrorText(commandGenErrorText(e, t));
          setPhase('error');
          generatingRef.current = false;
          return;
        }
        recovering = true;
        setPhase('recovering');
        const memo = finishMemoRef.current;
        if (memo) {
          if (memo.type === 'commandGen.runFinished') finishSuccess(memo);
          else finishError(t('aiSuggest.errorGenerate'));
          return;
        }
        lastEventAt = Date.now();
        watchdog = setInterval(() => {
          if (token !== generationTokenRef.current) {
            stopWatchdog();
            return;
          }
          const now = Date.now();
          if (now - lastEventAt >= RECOVERY_WATCHDOG_MS || now - genStartedAt >= RECOVERY_HARD_CAP_MS) {
            finishError(commandGenErrorText(e, t));
          }
        }, RECOVERY_TICK_MS);
      }
    },
    [t],
  );

  const startVoice = useCallback(() => {
    if (phase === 'recording' || phase === 'generating' || phase === 'recovering') return;
    Keyboard.dismiss();
    setErrorText('');
    setTextMode(false);
    setPhase('recording');
    void voiceStt.start({
      onComplete: text => {
        void generate(text);
      },
      sessionId: optionsRef.current.sessionId,
      projectPath: optionsRef.current.cwd,
      deviceId: optionsRef.current.deviceId,
    });
  }, [phase, voiceStt, generate]);

  const stopVoice = useCallback(() => {
    if (phase !== 'recording') return;
    void voiceStt.stop();
  }, [phase, voiceStt]);

  // A recording that ends in failure (permission drop, socket close with no
  // transcript, …) never fires onComplete — surface it instead of sitting in
  // `recording` forever.
  useEffect(() => {
    if (phase !== 'recording') return;
    if (voiceStt.status !== 'error') return;
    setErrorText(voiceStt.errorMessage || t('aiSuggest.errorVoice'));
    setPhase('error');
  }, [phase, voiceStt.status, voiceStt.errorMessage, t]);

  const submitText = useCallback(
    (text: string) => {
      if (phase === 'recording' || phase === 'generating' || phase === 'recovering') return;
      void generate(text);
    },
    [phase, generate],
  );

  // STT failures land in error phase with empty lastText — retry then falls
  // back to restart recording instead of dead-ending.
  const retry = useCallback(() => {
    if (phase === 'generating' || phase === 'recovering') return;
    if (lastTextRef.current) {
      void generate(lastTextRef.current);
    } else {
      startVoice();
    }
  }, [phase, generate, startVoice]);

  const clearChips = useCallback(() => setChips([]), []);
  const dismissError = useCallback(() => {
    setErrorText('');
    setPhase(prev => (prev === 'error' ? 'idle' : prev));
  }, []);
  const openTextInput = useCallback(() => {
    if (phase !== 'idle') return;
    setTextMode(true);
  }, [phase]);
  const closeTextInput = useCallback(() => setTextMode(false), []);

  const reset = useCallback(() => {
    generationTokenRef.current += 1;
    abortRunRef.current(); // 恢复态/生成态下停掉订阅与看门狗
    generatingRef.current = false; // 悬挂中的 POST 不堵死下一个终端
    cancelRef.current();
    lastTextRef.current = '';
    setChips([]);
    setProgress(null);
    setErrorText('');
    setTextMode(false);
    setPhase('idle');
  }, []);

  // Unmount: kill any in-flight recording (a late stt.completed must not
  // resurrect state after the screen is gone).
  useEffect(
    () => () => {
      cancelRef.current();
      abortRunRef.current();
    },
    [],
  );

  return {
    phase,
    chips,
    liveCaption: voiceStt.liveCaption,
    progress,
    errorText,
    textMode,
    voiceStatus: voiceStt.status,
    startVoice,
    stopVoice,
    submitText,
    retry,
    clearChips,
    dismissError,
    openTextInput,
    closeTextInput,
    reset,
  };
}
