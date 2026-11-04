import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../app/navigation/types';
import { SafeAreaWrapper } from '../../components/layout/SafeAreaWrapper';
import { TopAppBar } from '../../components/layout/TopAppBar';
import { useTheme } from '../../theme/useTheme';
import { useToastStore } from '../../store/toastStore';
import { ApiResponseError } from '../../api/client';
import {
  fetchProjectFileContent,
  writeProjectFileContent,
} from '../../api/projects';
import { describeDeviceError } from '../../utils/deviceError';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

// ---------------------------------------------------------------------------
// 纯逻辑层(FileEditorSave.test.ts 锚点;不依赖渲染/导航)
// ---------------------------------------------------------------------------

/** 编辑器单次载入/保存的字节上限(载入超过即只读;保存超过被服务端拒 too_large)。 */
export const EDITOR_MAX_BYTES = 512 * 1024;

/**
 * 「编辑」入口的文本扩展名 allowlist(FileBrowserScreen 长按菜单组装处消费)。
 * 小写比对;无扩展名不编(Dockerfile/.gitignore 两个无后缀 basename 走
 * isTextEditableFile 的 basename 放行)。
 */
export const TEXT_EDITABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  'ts', 'tsx', 'js', 'jsx', 'json', 'md', 'txt', 'py', 'go', 'java', 'kt',
  'swift', 'rb', 'rs', 'c', 'h', 'cpp', 'hpp', 'hh', 'cc', 'css', 'scss',
  'less', 'html', 'htm', 'xml', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf',
  'sh', 'bat', 'ps1', 'sql', 'graphql', 'proto', 'vue', 'php', 'lua', 'dart',
  'gradle', 'properties', 'env', 'lock', 'gitignore', 'dockerfile',
]);

export const isTextEditableFile = (file: {
  kind: string;
  name: string;
}): boolean => {
  if (file.kind !== 'file') return false;
  const base = file.name.toLowerCase();
  // 无扩展名的两个特例:构建/隐藏配置是最高频的「想顺手改」目标。
  if (base === 'dockerfile' || base === 'gitignore') return true;
  const dot = base.lastIndexOf('.');
  if (dot < 0) return false;
  return TEXT_EDITABLE_EXTENSIONS.has(base.slice(dot + 1));
};

/**
 * 编辑器文档状态:content 是输入框当前值;baseline 是原文快照(载入时或最近
 * 一次成功保存时)——dirty 的唯一基准;sha256 是乐观锁原料,undefined = 无锁
 * (旧 agent 读响应缺 sha256,保存时优雅退化为无锁写入,不是错误)。
 */
export interface FileEditorDoc {
  content: string;
  baseline: string;
  sha256?: string;
}

export const createEditorDoc = (
  content: string,
  sha256?: string,
): FileEditorDoc => ({
  content,
  baseline: content,
  ...(sha256 ? { sha256 } : {}),
});

/**
 * 保存成功:基线推进到「发出请求时捕获的那份内容」(sentContent,不是 resolve
 * 时刻的最新输入)——飞行窗口内的继续键入保持 dirty,不会被判为已保存而静默
 * 丢失;锁链换成服务端刚回的新 sha256(对应盘上的 sentContent,下次保存
 * expectedSha256 对盘正确)。响应缺 sha256(旧 agent)→ 降级无锁。
 */
export const applySaveSuccess = (
  doc: FileEditorDoc,
  sentContent: string,
  sha256?: string,
): FileEditorDoc => ({
  content: doc.content,
  baseline: sentContent,
  ...(sha256 ? { sha256 } : {}),
});

export const isEditorDirty = (doc: FileEditorDoc | null): boolean =>
  !!doc && doc.content !== doc.baseline;

/**
 * 「保存并离开」的续存闸门(N1):先 join 传入的初始保存(可能是飞行中的在途
 * 保存),resolve 成功后只要文档仍 dirty(飞行窗口内的分叉键入)就继续保存,
 * 直到干净或某一次失败(失败 → 返回 false,用户留在编辑器)。C1 已保证每次
 * 保存后 baseline=盘上内容,循环内每跳的 expectedSha256 天然正确。
 */
export const runLeaveWithSave = async (
  initialSave: Promise<boolean>,
  isDirty: () => boolean,
  save: () => Promise<boolean>,
): Promise<boolean> => {
  let saved = await initialSave;
  while (saved && isDirty()) {
    saved = await save();
  }
  return saved;
};

/**
 * 保存失败的人话映射。conflict 走 Alert(重新加载/继续编辑两个出口),其余
 * 一律 toast。细分码读 ApiResponseError.agentErrorCode(服务端透传;旧服务端
 * 的 404 没有该字段 → 按 status 兜底「服务端版本过旧」)。读不到细分码时
 * 自然落到通用文案,不猜码。
 */
export type FileEditorFailure =
  | { kind: 'conflict'; message: string }
  | { kind: 'toast'; message: string };

export const resolveFileEditorError = (
  error: unknown,
  t: TFunction,
): FileEditorFailure => {
  const isApiError = error instanceof ApiResponseError;
  const agentErrorCode = isApiError ? error.agentErrorCode : undefined;
  if (agentErrorCode === 'conflict') {
    return { kind: 'conflict', message: t('fileEditor.conflictMessage') };
  }
  if (agentErrorCode === 'too_large') {
    return { kind: 'toast', message: t('fileEditor.tooLargeReadOnly') };
  }
  if (agentErrorCode === 'path_forbidden') {
    return { kind: 'toast', message: t('fileEditor.pathForbidden') };
  }
  if (isApiError && error.status === 404) {
    // 旧服务端没有 PUT files/content → 路由层 404,没有 agentErrorCode。
    return { kind: 'toast', message: t('fileEditor.serverTooOld') };
  }
  const detail = error instanceof Error ? error.message : '';
  return {
    kind: 'toast',
    message: detail
      ? `${t('fileEditor.saveFailed')}: ${detail}`
      : t('fileEditor.saveFailed'),
  };
};

// ---------------------------------------------------------------------------
// 屏
// ---------------------------------------------------------------------------

type EditorRoute = RouteProp<RootStackParamList, 'FileEditor'>;
type EditorNavigation = NativeStackNavigationProp<RootStackParamList>;

/** 等宽编辑字体(计划规格:ios Menlo / android monospace)。 */
const MONOSPACE_FAMILY = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: undefined,
});

/**
 * 文件编辑器:读走既有 GET files/content,存走 PUT files/content
 * (expected_sha256 乐观锁;spec 2026-11-02 §D3)。
 *
 * 载入四种走向:二进制(base64)→ toast 退出;truncated(>512KiB)→ 只读
 * banner 模式;读响应缺 sha256(旧 agent)→ 无锁编辑;正常 → 带锁编辑。
 * 保存失败按 resolveFileEditorError 分流;dirty 离开经 beforeRemove 三选一。
 */
export const FileEditorScreen: React.FC = () => {
  const { theme, isDark } = useTheme();
  const { t } = useTranslation('projects');
  const navigation = useNavigation<EditorNavigation>();
  const route = useRoute<EditorRoute>();
  const show = useToastStore(s => s.show);
  const { projectId } = route.params;
  const filePath = route.params.path;

  const [doc, setDoc] = useState<FileEditorDoc | null>(null);
  // N2:docRef 与 doc 状态同步锁步(写只经 commitDoc 一处),保存/离开闸门一律
  // 读 ref——Alert 弹窗飞行中才作答时,旧渲染闭包里的 doc 可能已过期
  // (保存成功已换 sha),用陈旧闭包的 sha 会制造假冲突。
  const docRef = useRef<FileEditorDoc | null>(null);
  // 只读模式:载入即 truncated(>512KiB)——可看不可存,banner 说明。
  const [readonly, setReadonly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const commitDoc = useCallback((next: FileEditorDoc | null) => {
    docRef.current = next;
    setDoc(next);
  }, []);

  const handleContentChange = useCallback(
    (text: string) => {
      const prev = docRef.current;
      if (prev) commitDoc({ ...prev, content: text });
    },
    [commitDoc],
  );

  const exitWithToast = useCallback(
    (message: string) => {
      show(message, 'error');
      navigation.goBack();
    },
    [navigation, show],
  );

  /**
   * 冲突弹窗的「重新加载」:丢弃本地改动重拉文件 + 换新锁。冲突窗口内文件
   * 若已被换成二进制,按二进制路径退出(不可编辑没有停留意义)。
   */
  const reloadDiscardingLocal = useCallback(async () => {
    try {
      const next = await fetchProjectFileContent(
        projectId,
        filePath,
        EDITOR_MAX_BYTES,
      );
      if (next.encoding === 'base64') {
        exitWithToast(t('fileEditor.binaryNotEditable'));
        return;
      }
      setReadonly(next.truncated === true);
      commitDoc(createEditorDoc(next.content ?? '', next.sha256));
    } catch (error) {
      const deviceMessage = describeDeviceError(error);
      show(deviceMessage?.title ?? t('fileBrowser.error.readFailed'), 'error');
    }
  }, [projectId, filePath, commitDoc, exitWithToast, show, t]);

  // 在途保存的唯一登记位(I1):双击同帧双发去重 + beforeRemove 的「保存并离开」
  // 在飞行窗口内选择时 join 在途 Promise 拿真实结果,而不是再起一次静默空操作。
  const savingRef = useRef<Promise<boolean> | null>(null);

  /**
   * 保存(可重入去重)。返回是否「已落盘(或本就无改动)」,供 beforeRemove 的
   * 保存放行路径判断。
   * - 命中在途 → 返回同一个 Promise(不发第二次请求);
   * - 无改动 → 视为成功(离开路径直接放行);
   * - 发出请求前捕获 sentContent(C1):成功后基线推进到它,飞行窗口内新键入
   *   保持 dirty,绝不静默丢失;
   * - N2:doc/sha 一律读 docRef.current,不吃渲染闭包——弹窗飞行中才作答时
   *   闭包可能是旧渲染(活保存已把 sha 换新),陈旧 sha 会制造假冲突。
   */
  const handleSave = useCallback((): Promise<boolean> => {
    if (savingRef.current) return savingRef.current;
    const current = docRef.current;
    if (!current || readonly) return Promise.resolve(false);
    if (current.content === current.baseline) return Promise.resolve(true);
    const sentContent = current.content;
    const expectedSha256 = current.sha256;
    setSaving(true);
    const run = (async (): Promise<boolean> => {
      try {
        // 旧 agent 读响应缺 sha256 → expectedSha256 传 undefined → api 层
        // 省键 → 服务端按无锁写入优雅退化。
        const result = await writeProjectFileContent(
          projectId,
          filePath,
          sentContent,
          { expectedSha256 },
        );
        const prev = docRef.current;
        if (prev) commitDoc(applySaveSuccess(prev, sentContent, result?.sha256));
        show(t('fileEditor.saved'), 'success');
        return true;
      } catch (error) {
        const resolution = resolveFileEditorError(error, t);
        if (resolution.kind === 'conflict') {
          Alert.alert(t('fileEditor.conflictTitle'), resolution.message, [
            {
              text: t('fileEditor.reload'),
              onPress: () => {
                void reloadDiscardingLocal();
              },
            },
            { text: t('fileEditor.keepEditing'), style: 'cancel' },
          ]);
        } else {
          show(resolution.message, 'error');
        }
        return false;
      } finally {
        setSaving(false);
        savingRef.current = null;
      }
    })();
    savingRef.current = run;
    return run;
  }, [readonly, projectId, filePath, commitDoc, reloadDiscardingLocal, show, t]);

  // 载入只在挂载做一次(路由参数不可变;返回重进是新挂载)。二进制 → toast
  // 退出;truncated → 只读;缺 sha256 → 无锁。载入失败 → toast + 退出。
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchProjectFileContent(projectId, filePath, EDITOR_MAX_BYTES)
      .then(next => {
        if (cancelled) return;
        if (next.encoding === 'base64') {
          exitWithToast(t('fileEditor.binaryNotEditable'));
          return;
        }
        setReadonly(next.truncated === true);
        commitDoc(createEditorDoc(next.content ?? '', next.sha256));
      })
      .catch(error => {
        if (cancelled) return;
        const deviceMessage = describeDeviceError(error);
        exitWithToast(
          deviceMessage?.title ?? t('fileBrowser.error.readFailed'),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // exitWithToast/t 稳定或由 i18n 语言变化驱动,重拉会闪屏;参数不可变。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, filePath]);

  // dirty 离开围栏:beforeRemove 拦截,三选一(保存/放弃/取消),保存成功后
  // 放行原始 action。dirty 判定读 docRef(N2:不吃渲染闭包,监听不随键入
  // 重挂)。只读模式输入框不可编辑 → 不可能 dirty,监听自然放行。
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', event => {
      if (!isEditorDirty(docRef.current)) return;
      event.preventDefault();
      Alert.alert(
        t('fileEditor.unsavedTitle'),
        t('fileEditor.unsavedMessage'),
        [
          {
            text: t('fileEditor.saveAndLeave'),
            onPress: () => {
              // I1 join 在途保存的真实结果 + N1 while 续存:join 到的可能是
              // 旧内容(B)的成功保存,飞行窗口内的分叉键入(C)必须追平落盘
              // 后才放行;任一跳失败 → 停在编辑器。
              void runLeaveWithSave(
                savingRef.current ?? handleSave(),
                () => isEditorDirty(docRef.current),
                handleSave,
              ).then(saved => {
                if (saved) navigation.dispatch(event.data.action);
              });
            },
          },
          {
            text: t('fileEditor.discard'),
            style: 'destructive',
            onPress: () => navigation.dispatch(event.data.action),
          },
          { text: t('fileEditor.cancel'), style: 'cancel' },
        ],
      );
    });
    return unsubscribe;
  }, [navigation, handleSave, t]);

  return (
    <SafeAreaWrapper>
      <TopAppBar
        title={route.params.fileName || t('fileEditor.title')}
        subtitle={filePath}
        onBack={() => navigation.goBack()}
        rightAction={
          readonly || loading ? undefined : (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => {
                void handleSave();
              }}
              disabled={saving}
              style={[
                styles.saveButton,
                { borderColor: theme.colors.primary },
              ]}
              // I3:按钮视觉 ~26px,触控目标补 hitSlop 到 ≥44pt。
              hitSlop={{ top: 9, bottom: 9, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={saving ? t('fileEditor.saving') : t('fileEditor.save')}>
              <Text style={[theme.typography.labelCaps, { color: theme.colors.primary }]}>
                {saving ? t('fileEditor.saving') : t('fileEditor.save')}
              </Text>
            </TouchableOpacity>
          )
        }
      />
      {readonly && doc ? (
        <View
          style={[
            styles.banner,
            {
              borderColor: theme.colors.warning,
              backgroundColor: isDark
                ? 'rgba(229,195,107,0.12)'
                : 'rgba(181,137,0,0.08)',
            },
          ]}>
          <Text style={[theme.typography.bodySm, { color: theme.colors.warning }]}>
            {t('fileEditor.readonlyBanner')}
          </Text>
        </View>
      ) : null}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* 已知性能债(I2,记债不改):编辑输入框是受控 value,每个 keystroke
            全量重渲染本屏,512KiB 极限文件会有顿挫。后续优化 = 非受控
            defaultValue + ref 读值,dirty 判定挪到 save/back 时刻;常规源文件
            (<100KB)现状可接受。 */}
        {loading || !doc ? (
          <View style={[styles.flex, styles.center]}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : (
          <TextInput
            style={[
              styles.editor,
              {
                color: theme.colors.onSurface,
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.outlineVariant,
              },
            ]}
            value={doc.content}
            onChangeText={handleContentChange}
            editable={!readonly}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            textAlignVertical="top"
            keyboardAppearance={isDark ? 'dark' : 'light'}
            placeholderTextColor={theme.colors.onSurfaceVariant}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaWrapper>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  banner: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginHorizontal: 16,
    marginTop: 8,
  },
  editor: {
    flex: 1,
    fontFamily: MONOSPACE_FAMILY,
    fontSize: 13,
    lineHeight: 20,
    padding: 12,
    borderWidth: 0,
    textAlignVertical: 'top',
  },
  saveButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
});
