import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  AgentEvent,
  AgentMessage,
  Device,
  mockDevices,
  mockPreviewLinks,
  mockProjects,
  mockVibeCodingRuns,
  PreviewLink,
  Project,
  VibeCodingRun,
  VibeStatus,
} from '../data/mockData';
import {
  LOCAL_SERVICE_BASE_URL,
  LOCAL_SERVICE_HOST,
  LOCAL_SERVICE_PORT,
} from '../config/localService';

export type TerminalLineKind =
  | 'command'
  | 'stdout'
  | 'stderr'
  | 'system'
  | 'success';

export type TerminalSessionStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'waiting_approval';

export type AgentProvider = 'claude_code' | 'codex';

export type UnifiedEventType =
  | 'terminal.output'
  | 'agent.delta'
  | 'command.started'
  | 'command.completed'
  | 'approval.requested'
  | 'file.changed'
  | 'device.bound'
  | 'device.offline'
  | 'project.scan.completed'
  | 'agent.session.started'
  | 'agent.session.paused'
  | 'agent.session.resumed'
  | 'agent.session.terminated';

export type UnifiedEventStatus =
  | 'info'
  | 'running'
  | 'waiting'
  | 'done'
  | 'failed';

export interface TerminalLine {
  id: string;
  kind: TerminalLineKind;
  content: string;
  timestamp: string;
}

export interface TerminalSession {
  id: string;
  deviceId: string;
  directory: string;
  shell: string;
  status: TerminalSessionStatus;
  lines: TerminalLine[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectScanResult {
  id: string;
  deviceId: string;
  projectId: string;
  name: string;
  path: string;
  isGitRepo: boolean;
  branch: string;
  language: string;
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'go' | 'pip' | 'gradle' | 'none';
  packageName: string;
  detectedPorts: number[];
  lastActiveAt: string;
  status: 'fresh' | 'active' | 'stale' | 'warning';
}

export type ApprovalKind =
  | 'dangerous_command'
  | 'file_write'
  | 'file_delete'
  | 'git_push';

export interface ApprovalRequest {
  id: string;
  kind: ApprovalKind;
  title: string;
  summary: string;
  deviceId: string;
  projectId?: string;
  sessionId?: string;
  terminalId?: string;
  command?: string;
  files?: string[];
  risk: 'medium' | 'high';
  status: 'pending' | 'approved' | 'denied';
  createdAt: string;
  resolvedAt?: string;
}

export interface PushNotificationItem {
  id: string;
  type: 'approval' | 'completed' | 'error' | 'device_offline';
  title: string;
  body: string;
  deviceId?: string;
  sessionId?: string;
  approvalId?: string;
  read: boolean;
  createdAt: string;
}

export interface ProjectFileEntry {
  id: string;
  projectId: string;
  path: string;
  name: string;
  kind: 'file' | 'folder';
  status: 'clean' | 'modified' | 'added' | 'deleted';
  language: string;
  size: string;
  lastTouched: string;
  summary: string;
}

export interface UnifiedEvent {
  id: string;
  type: UnifiedEventType;
  title: string;
  detail: string;
  status: UnifiedEventStatus;
  deviceId?: string;
  projectId?: string;
  sessionId?: string;
  terminalId?: string;
  approvalId?: string;
  timestamp: string;
  payload?: Record<string, string | number | boolean | undefined>;
}

interface StartAgentInput {
  deviceId: string;
  projectId: string;
  directory: string;
  provider: AgentProvider;
  objective: string;
  timeLimitMinutes: number;
}

interface BindDeviceInput {
  name: string;
  os: string;
  host: string;
  location: string;
  pairingCode: string;
}

interface BindDeviceResult {
  ok: boolean;
  deviceId?: string;
  error?: string;
}

interface ControlCenterState {
  devices: Device[];
  projects: Project[];
  vibeRuns: VibeCodingRun[];
  previewLinks: PreviewLink[];
  terminalSessions: TerminalSession[];
  scanResults: ProjectScanResult[];
  approvals: ApprovalRequest[];
  notifications: PushNotificationItem[];
  events: UnifiedEvent[];
  projectFiles: ProjectFileEntry[];
  bindDevice: (input: BindDeviceInput) => BindDeviceResult;
  renameDevice: (deviceId: string, name: string) => BindDeviceResult;
  scanDeviceProjects: (deviceId: string) => void;
  createTerminalSession: (deviceId: string, directory?: string) => string;
  executeTerminalCommand: (terminalId: string, command: string) => void;
  clearTerminal: (terminalId: string) => void;
  stopTerminal: (terminalId: string) => void;
  startAgentSession: (input: StartAgentInput) => string;
  pauseAgentSession: (sessionId: string) => void;
  resumeAgentSession: (sessionId: string) => void;
  terminateAgentSession: (sessionId: string) => void;
  deleteAgentSession: (sessionId: string) => void;
  appendAgentMessage: (
    sessionId: string,
    content: string,
    mode: 'voice' | 'text',
  ) => void;
  resolveApproval: (approvalId: string, decision: 'approved' | 'denied') => void;
  markNotificationRead: (notificationId: string) => void;
  markAllNotificationsRead: () => void;
}

const nowTime = () =>
  new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

const shortTime = () =>
  new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

const createId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const line = (kind: TerminalLineKind, content: string): TerminalLine => ({
  id: createId('line'),
  kind,
  content,
  timestamp: nowTime(),
});

const event = (
  type: UnifiedEventType,
  title: string,
  detail: string,
  status: UnifiedEventStatus,
  meta: Partial<UnifiedEvent> = {},
): UnifiedEvent => ({
  id: createId('evt'),
  type,
  title,
  detail,
  status,
  timestamp: nowTime(),
  ...meta,
});

const notification = (
  type: PushNotificationItem['type'],
  title: string,
  body: string,
  meta: Partial<PushNotificationItem> = {},
): PushNotificationItem => ({
  id: createId('push'),
  type,
  title,
  body,
  read: false,
  createdAt: nowTime(),
  ...meta,
});

const isDangerousCommand = (command: string) => {
  const normalized = command.toLowerCase();
  return (
    normalized.includes('rm -rf') ||
    normalized.includes('sudo rm') ||
    normalized.includes('git push') ||
    normalized.includes('chmod -r') ||
    normalized.includes('chown -r')
  );
};

const classifyApprovalKind = (command: string): ApprovalKind => {
  const normalized = command.toLowerCase();
  if (normalized.includes('git push')) {
    return 'git_push';
  }
  if (normalized.includes('rm ') || normalized.includes('delete')) {
    return 'file_delete';
  }
  return 'dangerous_command';
};

const buildCommandOutput = (
  command: string,
  directory: string,
): Array<Omit<TerminalLine, 'id' | 'timestamp'>> => {
  const normalized = command.trim().toLowerCase();

  if (normalized === 'pwd') {
    return [{ kind: 'stdout', content: directory }];
  }

  if (normalized === 'ls' || normalized === 'ls -la') {
    return [
      { kind: 'stdout', content: 'drwxr-xr-x  src' },
      { kind: 'stdout', content: 'drwxr-xr-x  android' },
      { kind: 'stdout', content: 'drwxr-xr-x  ios' },
      { kind: 'stdout', content: '-rw-r--r--  package.json' },
      { kind: 'stdout', content: '-rw-r--r--  README.md' },
    ];
  }

  if (normalized.startsWith('git status')) {
    return [
      { kind: 'stdout', content: 'On branch codex/mobile-agent-console' },
      { kind: 'stdout', content: 'Changes not staged for commit:' },
      { kind: 'stdout', content: '  modified: src/screens/devices/DeviceDetailScreen.tsx' },
      { kind: 'stdout', content: '  new file: src/store/controlCenterStore.ts' },
      { kind: 'success', content: 'Working tree scanned.' },
    ];
  }

  if (normalized.includes('npm test')) {
    return [
      { kind: 'system', content: 'Starting Jest through the device agent.' },
      { kind: 'stdout', content: 'PASS __tests__/App.test.tsx' },
      { kind: 'stdout', content: 'Tests: 1 passed, 1 total' },
      { kind: 'success', content: 'Exit code 0' },
    ];
  }

  if (normalized.includes('npm run lint')) {
    return [
      { kind: 'system', content: 'Running eslint in the selected workspace.' },
      { kind: 'stdout', content: '> eslint .' },
      { kind: 'success', content: 'Lint completed. No blocking issues.' },
    ];
  }

  if (normalized.includes('npm run build')) {
    return [
      { kind: 'system', content: 'Starting build command.' },
      { kind: 'stderr', content: 'No build script is configured in package.json.' },
      { kind: 'stderr', content: 'Exit code 1' },
    ];
  }

  return [
    { kind: 'system', content: `Executing in ${directory}` },
    { kind: 'stdout', content: command },
    { kind: 'success', content: 'Command accepted by device agent. Exit code 0' },
  ];
};

const makeScanResults = (
  devices: Device[] = mockDevices,
  projects: Project[] = mockProjects,
): ProjectScanResult[] =>
  projects.map((project, index) => {
    const device =
      devices.find(item => item.projectIds.includes(project.id)) ?? devices[0];
    const directory =
      device.authorizedDirectories[index % device.authorizedDirectories.length] ??
      '~';

    return {
      id: `scan-${project.id}`,
      deviceId: device.id,
      projectId: project.id,
      name: project.name,
      path: `${directory}/${project.name}`,
      isGitRepo: true,
      branch: project.branch,
      language: project.language,
      packageManager:
        project.language === 'TypeScript'
          ? 'pnpm'
          : project.language === 'Go'
          ? 'go'
          : project.language === 'Python'
          ? 'pip'
          : project.language === 'Kotlin'
          ? 'gradle'
          : 'none',
      packageName: project.name,
      detectedPorts: device.activePorts.slice(0, 2),
      lastActiveAt: index === 0 ? '8 min ago' : project.lastDeploy,
      status:
        project.status === 'error'
          ? 'warning'
          : project.status === 'active'
          ? 'active'
          : 'stale',
    };
  });

const makeProjectFiles = (projects: Project[]): ProjectFileEntry[] =>
  projects.flatMap(project => {
    const common = {
      projectId: project.id,
      language: project.language,
    };
    const fileSet =
      project.language === 'TypeScript'
        ? [
            ['src/screens/CommandCenterScreen.tsx', 'CommandCenterScreen.tsx', 'modified', 'Home project workspace and mobile scan entry.'],
            ['src/store/controlCenterStore.ts', 'controlCenterStore.ts', 'modified', 'Frontend state model for devices, sessions, approvals, files.'],
            ['package.json', 'package.json', 'clean', 'React Native dependencies and scripts.'],
            ['src/components/visual/IconBadge.tsx', 'IconBadge.tsx', 'added', 'Reusable visual icon badge component.'],
          ]
        : project.language === 'Go'
        ? [
            ['cmd/server/main.go', 'main.go', 'modified', 'Gateway process entrypoint and startup config.'],
            ['internal/auth/middleware.go', 'middleware.go', 'modified', 'Auth token validation and request context.'],
            ['go.mod', 'go.mod', 'clean', 'Go module definition.'],
            ['README.md', 'README.md', 'clean', 'Project setup and deploy notes.'],
          ]
        : project.language === 'Python'
        ? [
            ['pipeline/train.py', 'train.py', 'modified', 'Training orchestration and model output.'],
            ['pipeline/config.py', 'config.py', 'clean', 'Runtime configuration.'],
            ['requirements.txt', 'requirements.txt', 'clean', 'Python package requirements.'],
            ['notebooks/eval.ipynb', 'eval.ipynb', 'added', 'Evaluation notebook draft.'],
          ]
        : [
            ['app/src/main/MainActivity.kt', 'MainActivity.kt', 'modified', 'Android entry activity and edge-to-edge setup.'],
            ['app/build.gradle', 'build.gradle', 'clean', 'Android module build config.'],
            ['README.md', 'README.md', 'clean', 'Mobile companion app notes.'],
            ['app/src/main/res/values/colors.xml', 'colors.xml', 'clean', 'Android color resources.'],
          ];

    return fileSet.map((item, index): ProjectFileEntry => ({
      id: `file-${project.id}-${index}`,
      ...common,
      path: item[0],
      name: item[1],
      kind: 'file',
      status: item[2] as ProjectFileEntry['status'],
      size: index === 0 ? '18 KB' : index === 1 ? '11 KB' : '3 KB',
      lastTouched: index === 0 ? 'just now' : project.lastDeploy,
      summary: item[3],
    }));
  });

const initialApprovals: ApprovalRequest[] = [
  {
    id: 'appr-auth-files',
    kind: 'file_write',
    title: 'Apply auth middleware patch',
    summary:
      'Claude Code wants to modify auth middleware and related tests before running the suite.',
    deviceId: 'mac-studio',
    projectId: '1',
    sessionId: 'vc-2',
    files: ['src/middleware/auth.ts', 'tests/auth.test.ts'],
    risk: 'high',
    status: 'pending',
    createdAt: '14:35:20',
  },
  {
    id: 'appr-git-push',
    kind: 'git_push',
    title: 'Push onboarding branch',
    summary:
      'Codex prepared a git push to origin agent/onboarding-polish after preview checks.',
    deviceId: 'mbp-travel',
    projectId: '4',
    sessionId: 'vc-3',
    command: 'git push origin agent/onboarding-polish',
    risk: 'medium',
    status: 'pending',
    createdAt: '16:18:04',
  },
];

const initialEvents: UnifiedEvent[] = [
  event(
    'terminal.output',
    'Terminal output',
    'mac-studio ~/MyProgram/AiProgram $ git status',
    'info',
    {
      deviceId: 'mac-studio',
      terminalId: 'term-seed',
      timestamp: '15:31:44',
    },
  ),
  event('command.started', 'Command started', 'npx tsc --noEmit', 'running', {
    deviceId: 'mac-studio',
    sessionId: 'vc-1',
    terminalId: 'term-seed',
    timestamp: '15:31:30',
  }),
  event(
    'file.changed',
    'File changed',
    'src/screens/projects/CommandCenterScreen.tsx modified by agent.',
    'done',
    {
      deviceId: 'mac-studio',
      projectId: '2',
      sessionId: 'vc-1',
      timestamp: '15:30:12',
    },
  ),
  event('device.bound', 'Device bound', 'Mac Studio - Desk is connected.', 'done', {
    deviceId: 'mac-studio',
    timestamp: '13:52:10',
  }),
  event(
    'agent.delta',
    'Agent message',
    `Preview is ready at ${LOCAL_SERVICE_BASE_URL}.`,
    'info',
    {
      deviceId: 'mac-studio',
      projectId: '2',
      sessionId: 'vc-1',
      timestamp: '15:36:02',
    },
  ),
  event(
    'approval.requested',
    'Approval required',
    'Modify src/middleware/auth.ts and tests/auth.test.ts',
    'waiting',
    {
      deviceId: 'mac-studio',
      projectId: '1',
      sessionId: 'vc-2',
      approvalId: 'appr-auth-files',
      timestamp: '14:35:20',
    },
  ),
  event(
    'device.offline',
    'Device offline',
    'Linux GPU Box missed heartbeat for 3 hours.',
    'failed',
    {
      deviceId: 'linux-gpu',
      timestamp: '12:08:11',
    },
  ),
];

const initialNotifications: PushNotificationItem[] = [
  notification(
    'approval',
    'Approval needed',
    'Claude Code is waiting before modifying auth middleware.',
    {
      deviceId: 'mac-studio',
      sessionId: 'vc-2',
      approvalId: 'appr-auth-files',
      createdAt: '14:35:20',
    },
  ),
  notification(
    'completed',
    'Preview ready',
    `Polish mobile control dashboard exposed ${LOCAL_SERVICE_BASE_URL}.`,
    {
      deviceId: 'mac-studio',
      sessionId: 'vc-1',
      createdAt: '15:36:02',
    },
  ),
  notification(
    'device_offline',
    'Device offline',
    'Linux GPU Box is no longer reachable from the relay.',
    {
      deviceId: 'linux-gpu',
      createdAt: '12:08:11',
    },
  ),
];

const mapProviderToModel = (provider: AgentProvider) =>
  provider === 'claude_code' ? 'Claude Code' : 'GPT-5 Codex';

const applyLocalServiceConfig = (
  state: Partial<ControlCenterState>,
): Partial<ControlCenterState> => ({
  ...state,
  devices: (state.devices ?? mockDevices).map(device =>
    device.id === 'mac-studio'
      ? {
          ...device,
          host: LOCAL_SERVICE_HOST,
          activePorts: [LOCAL_SERVICE_PORT],
        }
      : device,
  ),
  previewLinks: (state.previewLinks ?? mockPreviewLinks).map(preview =>
    preview.id === 'preview-1'
      ? {
          ...preview,
          port: LOCAL_SERVICE_PORT,
          shortUrl: LOCAL_SERVICE_BASE_URL,
          targetUrl: LOCAL_SERVICE_BASE_URL,
        }
      : preview,
  ),
  vibeRuns: (state.vibeRuns ?? mockVibeCodingRuns).map(run =>
    run.id === 'vc-1'
      ? {
          ...run,
          currentStep: `Preview is ready at ${LOCAL_SERVICE_BASE_URL}.`,
        }
      : run,
  ),
});

const appendAgentTimelineEvent = (
  run: VibeCodingRun,
  nextEvent: AgentEvent,
): VibeCodingRun => ({
  ...run,
  events: [...run.events, nextEvent],
  updatedAt: 'now',
});

export const useControlCenterStore = create<ControlCenterState>()(
  persist(
    (set, get) => ({
      devices: mockDevices,
      projects: mockProjects,
      vibeRuns: mockVibeCodingRuns,
      previewLinks: mockPreviewLinks,
      terminalSessions: [],
      scanResults: makeScanResults(),
      approvals: initialApprovals,
      notifications: initialNotifications,
      events: initialEvents,
      projectFiles: makeProjectFiles(mockProjects),

      bindDevice: input => {
        const name = input.name.trim();
        const duplicate = get().devices.some(
          device => device.name.toLowerCase() === name.toLowerCase(),
        );

        if (duplicate) {
          return {
            ok: false,
            error: 'A device with this name already exists.',
          };
        }

        const id = `device-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        const nextDevice: Device = {
          id,
          name,
          status: 'online',
          location: input.location.trim() || 'Remote device',
          os: input.os.trim() || 'macOS',
          host: input.host.trim() || `relay:${id}`,
          cpuLoad: 18,
          memLoad: 41,
          authorizedDirectories: ['~/Projects', '~/Work'],
          activePorts: [],
          projectIds: [],
          activeSessionIds: [],
          lastSeen: 'now',
        };

        set(state => ({
          devices: [nextDevice, ...state.devices],
          events: [
            event(
              'device.bound',
              'Device bound',
              `${nextDevice.name} paired with code ${input.pairingCode}.`,
              'done',
              { deviceId: id },
            ),
            ...state.events,
          ],
          notifications: [
            notification(
              'completed',
              'Device paired',
              `${nextDevice.name} is ready for terminal and agent sessions.`,
              { deviceId: id },
            ),
            ...state.notifications,
          ],
        }));

        return { ok: true, deviceId: id };
      },

      renameDevice: (deviceId, name) => {
        const trimmed = name.trim();
        const duplicate = get().devices.some(
          device =>
            device.id !== deviceId &&
            device.name.toLowerCase() === trimmed.toLowerCase(),
        );

        if (duplicate) {
          return {
            ok: false,
            error: 'A device with this name already exists.',
          };
        }

        set(state => ({
          devices: state.devices.map(device =>
            device.id === deviceId ? { ...device, name: trimmed } : device,
          ),
        }));

        return { ok: true, deviceId };
      },

      scanDeviceProjects: deviceId => {
        const device = get().devices.find(item => item.id === deviceId);

        if (!device) {
          return;
        }

        const generated = device.authorizedDirectories.slice(0, 3).map(
          (directory, index): ProjectScanResult => {
            const project = get().projects[index % get().projects.length];
            return {
              id: createId('scan'),
              deviceId,
              projectId: project.id,
              name: project.name,
              path: `${directory}/${project.name}`,
              isGitRepo: true,
              branch: project.branch,
              language: project.language,
              packageManager:
                project.language === 'TypeScript'
                  ? 'pnpm'
                  : project.language === 'Go'
                  ? 'go'
                  : project.language === 'Python'
                  ? 'pip'
                  : 'gradle',
              packageName: project.name,
              detectedPorts:
                index === 0 ? device.activePorts : device.activePorts.slice(0, 1),
              lastActiveAt: index === 0 ? 'just now' : project.lastDeploy,
              status: index === 0 ? 'fresh' : 'active',
            };
          },
        );

        set(state => ({
          scanResults: [
            ...generated,
            ...state.scanResults.filter(item => item.deviceId !== deviceId),
          ],
          events: [
            event(
              'project.scan.completed',
              'Project scan completed',
              `${generated.length} repositories found on ${device.name}.`,
              'done',
              { deviceId },
            ),
            ...state.events,
          ],
          notifications: [
            notification(
              'completed',
              'Project scan completed',
              `${device.name} found ${generated.length} candidate projects.`,
              { deviceId },
            ),
            ...state.notifications,
          ],
        }));
      },

      createTerminalSession: (deviceId, directory) => {
        const device = get().devices.find(item => item.id === deviceId);
        const selectedDirectory =
          directory ?? device?.authorizedDirectories[0] ?? '~';
        const terminalId = createId('term');

        set(state => ({
          terminalSessions: [
            {
              id: terminalId,
              deviceId,
              directory: selectedDirectory,
              shell: device?.os.toLowerCase().includes('windows') ? 'pwsh' : 'zsh',
              status: device?.status === 'offline' ? 'stopped' : 'idle',
              lines: [
                line(
                  'system',
                  device
                    ? `Real terminal session opened on ${device.name}.`
                    : 'Device is unavailable.',
                ),
                line('system', `Working directory: ${selectedDirectory}`),
              ],
              createdAt: nowTime(),
              updatedAt: nowTime(),
            },
            ...state.terminalSessions,
          ],
          events: [
            event(
              'terminal.output',
              'Terminal opened',
              `${selectedDirectory} shell is ready.`,
              'info',
              { deviceId, terminalId },
            ),
            ...state.events,
          ],
        }));

        return terminalId;
      },

      executeTerminalCommand: (terminalId, command) => {
        const trimmed = command.trim();
        const terminal = get().terminalSessions.find(item => item.id === terminalId);
        const device = terminal
          ? get().devices.find(item => item.id === terminal.deviceId)
          : undefined;

        if (!terminal || !trimmed || !device || device.status === 'offline') {
          return;
        }

        if (isDangerousCommand(trimmed)) {
          const approvalId = createId('appr');
          const approval: ApprovalRequest = {
            id: approvalId,
            kind: classifyApprovalKind(trimmed),
            title: trimmed.toLowerCase().includes('git push')
              ? 'Confirm git push'
              : 'Confirm dangerous command',
            summary: `${device.name} wants to run "${trimmed}" in ${terminal.directory}.`,
            deviceId: device.id,
            terminalId,
            command: trimmed,
            risk: trimmed.toLowerCase().includes('rm') ? 'high' : 'medium',
            status: 'pending',
            createdAt: nowTime(),
          };

          set(state => ({
            approvals: [approval, ...state.approvals],
            terminalSessions: state.terminalSessions.map(item =>
              item.id === terminalId
                ? {
                    ...item,
                    status: 'waiting_approval',
                    updatedAt: nowTime(),
                    lines: [
                      ...item.lines,
                      line('command', `${item.directory} $ ${trimmed}`),
                      line(
                        'system',
                        'Command is paused until mobile approval is resolved.',
                      ),
                    ],
                  }
                : item,
            ),
            events: [
              event(
                'approval.requested',
                approval.title,
                approval.summary,
                'waiting',
                {
                  deviceId: device.id,
                  terminalId,
                  approvalId,
                },
              ),
              ...state.events,
            ],
            notifications: [
              notification('approval', approval.title, approval.summary, {
                deviceId: device.id,
                approvalId,
              }),
              ...state.notifications,
            ],
          }));
          return;
        }

        const output = buildCommandOutput(trimmed, terminal.directory);
        const didFail = output.some(item => item.kind === 'stderr');

        set(state => ({
          terminalSessions: state.terminalSessions.map(item =>
            item.id === terminalId
              ? {
                  ...item,
                  status: didFail ? 'failed' : 'completed',
                  updatedAt: nowTime(),
                  lines: [
                    ...item.lines,
                    line('command', `${item.directory} $ ${trimmed}`),
                    ...output.map(itemLine => line(itemLine.kind, itemLine.content)),
                  ],
                }
              : item,
          ),
          events: [
            event(
              didFail ? 'command.completed' : 'command.completed',
              didFail ? 'Command failed' : 'Command completed',
              trimmed,
              didFail ? 'failed' : 'done',
              {
                deviceId: device.id,
                terminalId,
                payload: { exitCode: didFail ? 1 : 0 },
              },
            ),
            event('command.started', 'Command started', trimmed, 'running', {
              deviceId: device.id,
              terminalId,
            }),
            ...state.events,
          ],
        }));
      },

      clearTerminal: terminalId => {
        set(state => ({
          terminalSessions: state.terminalSessions.map(item =>
            item.id === terminalId
              ? {
                  ...item,
                  status: 'idle',
                  updatedAt: nowTime(),
                  lines: [
                    line('system', 'Terminal output cleared.'),
                    line('system', `Working directory: ${item.directory}`),
                  ],
                }
              : item,
          ),
        }));
      },

      stopTerminal: terminalId => {
        set(state => ({
          terminalSessions: state.terminalSessions.map(item =>
            item.id === terminalId
              ? {
                  ...item,
                  status: 'stopped',
                  updatedAt: nowTime(),
                  lines: [
                    ...item.lines,
                    line('system', 'Process interrupted from mobile control.'),
                  ],
                }
              : item,
          ),
        }));
      },

      startAgentSession: input => {
        const sessionId = createId('vc');
        const model = mapProviderToModel(input.provider);
        const project = get().projects.find(item => item.id === input.projectId);
        const nextRun: VibeCodingRun = {
          id: sessionId,
          title: input.objective.slice(0, 44) || 'New VibeCoding session',
          deviceId: input.deviceId,
          projectId: input.projectId,
          directory: input.directory,
          status: 'running',
          objective: input.objective,
          model,
          ...(input.provider === 'codex'
            ? {
                projectBudget: {
                  source: 'codex' as const,
                  currencySymbol: '$',
                  used: 0.15,
                  limit: 12,
                  updatedAt: 'now',
                },
              }
            : {}),
          timeLimitMinutes: input.timeLimitMinutes,
          elapsedMinutes: 1,
          risk: input.provider === 'claude_code' ? 'medium' : 'low',
          currentStep: `${model} is reading the project and preparing a plan.`,
          branch: `agent/${sessionId}`,
          updatedAt: 'now',
          suggestions: ['Ask for plan', 'Open terminal', 'Pause session'],
          transcript: [
            {
              id: createId('msg'),
              role: 'user',
              mode: 'text',
              content: input.objective,
              timestamp: shortTime(),
            },
            {
              id: createId('msg'),
              role: 'assistant',
              content: `${model} connected. I will stay inside ${input.directory}.`,
              timestamp: shortTime(),
            },
          ],
          events: [
            {
              id: createId('agent-event'),
              type: 'status',
              title: 'Agent session started',
              detail: `${model} started on ${project?.name ?? input.projectId}`,
              status: 'running',
              timestamp: shortTime(),
            },
          ],
        };

        set(state => ({
          vibeRuns: [nextRun, ...state.vibeRuns],
          devices: state.devices.map(device =>
            device.id === input.deviceId
              ? {
                  ...device,
                  activeSessionIds: [sessionId, ...device.activeSessionIds],
                }
              : device,
          ),
          events: [
            event(
              'agent.session.started',
              'Agent session started',
              `${model} started in ${input.directory}.`,
              'running',
              {
                deviceId: input.deviceId,
                projectId: input.projectId,
                sessionId,
                payload: { provider: input.provider },
              },
            ),
            ...state.events,
          ],
        }));

        return sessionId;
      },

      pauseAgentSession: sessionId => {
        set(state => ({
          vibeRuns: state.vibeRuns.map(run =>
            run.id === sessionId
              ? appendAgentTimelineEvent(
                  {
                    ...run,
                    status: 'paused',
                    currentStep: 'Paused from mobile control.',
                  },
                  {
                    id: createId('agent-event'),
                    type: 'status',
                    title: 'Paused',
                    detail: 'Mobile user paused this agent session.',
                    status: 'waiting',
                    timestamp: shortTime(),
                  },
                )
              : run,
          ),
          events: [
            event(
              'agent.session.paused',
              'Agent paused',
              'Mobile user paused the session.',
              'waiting',
              { sessionId },
            ),
            ...state.events,
          ],
        }));
      },

      resumeAgentSession: sessionId => {
        set(state => ({
          vibeRuns: state.vibeRuns.map(run =>
            run.id === sessionId
              ? appendAgentTimelineEvent(
                  {
                    ...run,
                    status: 'running',
                    currentStep: 'Agent resumed and is syncing workspace state.',
                  },
                  {
                    id: createId('agent-event'),
                    type: 'status',
                    title: 'Resumed',
                    detail: 'Mobile user resumed this agent session.',
                    status: 'running',
                    timestamp: shortTime(),
                  },
                )
              : run,
          ),
          events: [
            event(
              'agent.session.resumed',
              'Agent resumed',
              'Mobile user resumed the session.',
              'running',
              { sessionId },
            ),
            ...state.events,
          ],
        }));
      },

      terminateAgentSession: sessionId => {
        set(state => ({
          vibeRuns: state.vibeRuns.map(run =>
            run.id === sessionId
              ? appendAgentTimelineEvent(
                  {
                    ...run,
                    status: 'completed',
                    currentStep: 'Session terminated from mobile control.',
                  },
                  {
                    id: createId('agent-event'),
                    type: 'status',
                    title: 'Terminated',
                    detail: 'Mobile user terminated this agent session.',
                    status: 'done',
                    timestamp: shortTime(),
                  },
                )
              : run,
          ),
          devices: state.devices.map(device => ({
            ...device,
            activeSessionIds: device.activeSessionIds.filter(id => id !== sessionId),
          })),
          events: [
            event(
              'agent.session.terminated',
              'Agent terminated',
              'Mobile user stopped the session.',
              'done',
              { sessionId },
            ),
            ...state.events,
          ],
          notifications: [
            notification(
              'completed',
              'Agent session stopped',
              'The selected VibeCoding session was terminated.',
              { sessionId },
            ),
            ...state.notifications,
          ],
        }));
      },

      deleteAgentSession: sessionId => {
        const run = get().vibeRuns.find(item => item.id === sessionId);

        set(state => ({
          vibeRuns: state.vibeRuns.filter(item => item.id !== sessionId),
          devices: state.devices.map(device => ({
            ...device,
            activeSessionIds: device.activeSessionIds.filter(id => id !== sessionId),
          })),
          events: [
            event(
              'agent.session.terminated',
              'Agent session deleted',
              run?.title ?? sessionId,
              'done',
              { sessionId },
            ),
            ...state.events,
          ],
        }));
      },

      appendAgentMessage: (sessionId, content, mode) => {
        const userMessage: AgentMessage = {
          id: createId('msg'),
          role: 'user',
          mode,
          content,
          timestamp: shortTime(),
        };
        const assistantMessage: AgentMessage = {
          id: createId('msg'),
          role: 'assistant',
          content:
            'Received. I will continue within the authorized directory and report file changes before applying risky actions.',
          timestamp: shortTime(),
        };

        set(state => ({
          vibeRuns: state.vibeRuns.map(run =>
            run.id === sessionId
              ? {
                  ...run,
                  status: 'running' as VibeStatus,
                  transcript: [
                    ...run.transcript,
                    userMessage,
                    assistantMessage,
                  ],
                  currentStep: 'Processing the latest mobile instruction.',
                  updatedAt: 'now',
                }
              : run,
          ),
          events: [
            event('agent.delta', 'Agent direction sent', content, 'info', {
              sessionId,
            }),
            ...state.events,
          ],
        }));
      },

      resolveApproval: (approvalId, decision) => {
        const approval = get().approvals.find(item => item.id === approvalId);

        if (!approval) {
          return;
        }

        const approved = decision === 'approved';
        const approvalLine = approved
          ? 'Approval granted from mobile.'
          : 'Approval denied from mobile.';

        set(state => ({
          approvals: state.approvals.map(item =>
            item.id === approvalId
              ? { ...item, status: decision, resolvedAt: nowTime() }
              : item,
          ),
          terminalSessions: approval.terminalId
            ? state.terminalSessions.map(item =>
                item.id === approval.terminalId
                  ? {
                      ...item,
                      status: approved ? 'completed' : 'stopped',
                      updatedAt: nowTime(),
                      lines: approved
                        ? [
                            ...item.lines,
                            line('success', approvalLine),
                            ...buildCommandOutput(
                              approval.command ?? 'approved command',
                              item.directory,
                            ).map(output => line(output.kind, output.content)),
                          ]
                        : [...item.lines, line('stderr', approvalLine)],
                    }
                  : item,
              )
            : state.terminalSessions,
          vibeRuns: approval.sessionId
            ? state.vibeRuns.map(run =>
                run.id === approval.sessionId
                  ? appendAgentTimelineEvent(
                      {
                        ...run,
                        status: approved ? 'running' : 'paused',
                        currentStep: approved
                          ? 'Approval granted. Agent is continuing the task.'
                          : 'Approval denied. Agent is waiting for a safer direction.',
                      },
                      {
                        id: createId('agent-event'),
                        type: 'approval',
                        title: approved ? 'Approval granted' : 'Approval denied',
                        detail: approval.title,
                        status: approved ? 'done' : 'waiting',
                        timestamp: shortTime(),
                      },
                    )
                  : run,
              )
            : state.vibeRuns,
          events: [
            event(
              'approval.requested',
              approved ? 'Approval granted' : 'Approval denied',
              approval.title,
              approved ? 'done' : 'failed',
              {
                deviceId: approval.deviceId,
                projectId: approval.projectId,
                sessionId: approval.sessionId,
                terminalId: approval.terminalId,
                approvalId,
              },
            ),
            ...state.events,
          ],
          notifications: [
            notification(
              approved ? 'completed' : 'error',
              approved ? 'Approval granted' : 'Approval denied',
              approval.title,
              {
                deviceId: approval.deviceId,
                sessionId: approval.sessionId,
                approvalId,
              },
            ),
            ...state.notifications,
          ],
        }));
      },

      markNotificationRead: notificationId => {
        set(state => ({
          notifications: state.notifications.map(item =>
            item.id === notificationId ? { ...item, read: true } : item,
          ),
        }));
      },

      markAllNotificationsRead: () => {
        set(state => ({
          notifications: state.notifications.map(item => ({ ...item, read: true })),
        }));
      },
    }),
    {
      name: 'aliang-vibecoding-control-center',
      storage: createJSONStorage(() => AsyncStorage),
      version: 2,
      migrate: persistedState =>
        applyLocalServiceConfig(persistedState as Partial<ControlCenterState>),
      partialize: state => ({
        devices: state.devices,
        projects: state.projects,
        vibeRuns: state.vibeRuns,
        previewLinks: state.previewLinks,
        terminalSessions: state.terminalSessions,
        scanResults: state.scanResults,
        approvals: state.approvals,
        notifications: state.notifications,
        events: state.events,
        projectFiles: state.projectFiles,
      }),
    },
  ),
);
