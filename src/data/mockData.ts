import {
  LOCAL_SERVICE_BASE_URL,
  LOCAL_SERVICE_HOST,
  LOCAL_SERVICE_PORT,
} from '../config/localService';

export interface Project {
  id: string;
  name: string;
  status: 'active' | 'idle' | 'error';
  branch: string;
  lastDeploy?: string;
  language: string;
  description: string;
  path: string;
  deviceId?: string;
  packageManager?: string;
  isGitRepo?: boolean;
  detectedPorts: number[];
  sourceTools?: string[];
}

export interface TerminalNode {
  id: string;
  name: string;
  host: string;
  status: 'active' | 'idle' | 'error';
  latency: number;
  uptime: string;
  cpuLoad: number;
  memLoad: number;
  group: string;
  processes: ProcessInfo[];
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number;
  memory: number;
  status: string;
}

export interface RunningInstance {
  id: string;
  name: string;
  project: string;
  progress: number;
  status: 'building' | 'deploying' | 'running' | 'stopping';
  startedAt: string;
  cluster: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  reasoning?: string;
  fileActions?: FileAction[];
}

export interface FileAction {
  type: 'create' | 'modify' | 'delete';
  path: string;
  lines: number;
}

export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
}

export interface VibeCodingSession {
  id: string;
  project: string;
  status: 'thinking' | 'applying' | 'success' | 'paused';
  currentFile: string;
  diffLines: DiffLine[];
  logs: LogEntry[];
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

export interface UserPlan {
  userName: string;
  planName: string;
  renewsAt: string;
  balanceLimit: number;
  balanceUsed: number;
  timeLimitHours: number;
  timeUsedHours: number;
  concurrentLimit: number;
  concurrentUsed: number;
}

export type DeviceStatus = 'online' | 'offline' | 'warning';

export interface Device {
  id: string;
  name: string;
  status: DeviceStatus;
  location: string;
  os: string;
  host: string;
  cpuLoad: number;
  memLoad: number;
  battery?: number;
  authorizedDirectories: string[];
  activePorts: number[];
  projectIds: string[];
  activeSessionIds: string[];
  lastSeen: string;
  uniqueCode?: string;
  agentVersion?: string;
  remoteTerminalEnabled: boolean;
  aiControlEnabled: boolean;
  capabilities: string[];
  /** Tools advertised by the agent, including detected AI coding tools (claude-code/codex). */
  tools: AgentToolInfo[];
  /** Workspace roots the agent discovered (e.g. claude-code/codex session dirs). */
  history: WorkspaceHistoryEntry[];
  createdAt?: string;
}

export interface AgentToolInfo {
  id: string;
  name?: string;
  command?: string;
  path?: string;
  available?: boolean;
  description?: string;
}

export interface WorkspaceHistoryEntry {
  tool: string;
  path: string;
  exists?: boolean;
  file_count?: number;
  total_size?: number;
  updated_at?: string;
}

export type VibeStatus =
  | 'idle'
  | 'running'
  | 'waiting_user'
  | 'waiting_approval'
  | 'testing'
  | 'preview_ready'
  | 'failed'
  | 'completed'
  | 'paused';

export interface VibeCodingRun {
  id: string;
  title: string;
  deviceId: string;
  projectId: string;
  directory: string;
  status: VibeStatus;
  objective: string;
  model: string;
  projectBudget?: AgentBudgetInfo;
  timeLimitMinutes: number;
  elapsedMinutes: number;
  risk: 'low' | 'medium' | 'high';
  currentStep: string;
  branch: string;
  updatedAt: string;
  previewId?: string;
  suggestions: string[];
  transcript: AgentMessage[];
  events: AgentEvent[];
}

export interface AgentBudgetInfo {
  source: 'codex';
  currencySymbol: string;
  used: number;
  limit: number;
  updatedAt: string;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  mode?: 'voice' | 'text' | 'action';
  content: string;
  timestamp: string;
  pending?: boolean;
}

export interface AgentEvent {
  id: string;
  type: 'command' | 'file' | 'test' | 'preview' | 'approval' | 'status';
  title: string;
  detail: string;
  status: 'done' | 'running' | 'waiting' | 'failed';
  timestamp: string;
}

export interface PreviewLink {
  id: string;
  sessionId: string;
  port: number;
  shortUrl: string;
  targetUrl: string;
  expiresIn: string;
  access: 'private' | 'team' | 'public';
}

// --- Mock Data ---

export const mockUserPlan: UserPlan = {
  userName: 'Aliang',
  planName: 'Builder Pro',
  renewsAt: '2026-06-25',
  balanceLimit: 120,
  balanceUsed: 46.8,
  timeLimitHours: 80,
  timeUsedHours: 31.5,
  concurrentLimit: 4,
  concurrentUsed: 2,
};

export const mockProjects: Project[] = [
  {
    id: '1',
    name: 'api-gateway',
    status: 'active',
    branch: 'main',
    lastDeploy: '2h ago',
    language: 'Go',
    description: 'High-performance API gateway with rate limiting',
    path: '/Users/liang/project/api-gateway',
    detectedPorts: [],
  },
  {
    id: '2',
    name: 'web-dashboard',
    status: 'active',
    branch: 'feature/auth',
    lastDeploy: '5h ago',
    language: 'TypeScript',
    description: 'React dashboard for monitoring services',
    path: '/Users/liang/project/web-dashboard',
    detectedPorts: [],
  },
  {
    id: '3',
    name: 'ml-pipeline',
    status: 'error',
    branch: 'dev',
    lastDeploy: '1d ago',
    language: 'Python',
    description: 'ML training pipeline with automated CI/CD',
    path: '/Users/liang/project/ml-pipeline',
    detectedPorts: [],
  },
  {
    id: '4',
    name: 'mobile-app',
    status: 'idle',
    branch: 'main',
    lastDeploy: '3d ago',
    language: 'Kotlin',
    description: 'Android companion app',
    path: '/Users/liang/project/mobile-app',
    detectedPorts: [],
  },
];

export const mockTerminals: TerminalNode[] = [
  {
    id: '1',
    name: 'prod-us-east-1',
    host: '10.0.1.42',
    status: 'active',
    latency: 12,
    uptime: '45d 12h',
    cpuLoad: 67,
    memLoad: 82,
    group: 'Production',
    processes: [
      { pid: 1024, name: 'nginx', cpu: 4.2, memory: 128, status: 'running' },
      { pid: 1025, name: 'node', cpu: 23.1, memory: 512, status: 'running' },
      { pid: 1026, name: 'redis', cpu: 1.8, memory: 256, status: 'running' },
    ],
  },
  {
    id: '2',
    name: 'staging-eu-west',
    host: '10.0.2.88',
    status: 'active',
    latency: 45,
    uptime: '12d 4h',
    cpuLoad: 34,
    memLoad: 56,
    group: 'Staging',
    processes: [
      { pid: 2048, name: 'docker', cpu: 12.5, memory: 1024, status: 'running' },
      { pid: 2049, name: 'postgres', cpu: 3.4, memory: 384, status: 'running' },
    ],
  },
  {
    id: '3',
    name: 'dev-local-01',
    host: '192.168.1.10',
    status: 'idle',
    latency: 2,
    uptime: '2d 8h',
    cpuLoad: 5,
    memLoad: 23,
    group: 'Development',
    processes: [],
  },
  {
    id: '4',
    name: 'prod-apac-sydney',
    host: '10.0.3.15',
    status: 'error',
    latency: 89,
    uptime: '0d 0h',
    cpuLoad: 99,
    memLoad: 97,
    group: 'Production',
    processes: [
      { pid: 3072, name: 'java', cpu: 95.2, memory: 2048, status: 'running' },
    ],
  },
];

export const mockRunningInstances: RunningInstance[] = [
  {
    id: '1',
    name: 'api-gateway-v2.4',
    project: 'api-gateway',
    progress: 78,
    status: 'deploying',
    startedAt: '10 min ago',
    cluster: 'prod-us-east',
  },
  {
    id: '2',
    name: 'dashboard-fe',
    project: 'web-dashboard',
    progress: 100,
    status: 'running',
    startedAt: '2h ago',
    cluster: 'staging-eu',
  },
  {
    id: '3',
    name: 'ml-train-job-42',
    project: 'ml-pipeline',
    progress: 34,
    status: 'building',
    startedAt: '25 min ago',
    cluster: 'gpu-cluster',
  },
];

export const mockChatMessages: ChatMessage[] = [
  {
    id: '1',
    role: 'user',
    content: 'Wire device list through the platform transport layer',
    timestamp: '14:32',
  },
  {
    id: '2',
    role: 'assistant',
    content:
      "I'll load the platform device snapshot, normalize it for the app model, and keep realtime updates flowing through one transport layer.",
    timestamp: '14:32',
    reasoning:
      'The user wants the login-to-device-list path to use real platform data. I should connect the snapshot API, normalize device fields, and route websocket events into shared state.',
    fileActions: [
      { type: 'modify', path: 'src/store/controlCenterStore.ts', lines: 24 },
      { type: 'create', path: 'src/services/platformTransport.ts', lines: 45 },
      { type: 'modify', path: 'src/screens/terminals/TerminalListScreen.tsx', lines: 12 },
    ],
  },
];

export const mockVibeCodingSession: VibeCodingSession = {
  id: '1',
  project: 'api-gateway',
  status: 'applying',
  currentFile: 'src/services/platformTransport.ts',
  diffLines: [
    { type: 'context', content: 'export async function loadSnapshot(): Promise<PlatformSnapshot> {' },
    { type: 'context', content: '  const serverDevices = await fetchDevices();' },
    { type: 'remove', content: '  return serverDevices as unknown as PlatformSnapshot;' },
    { type: 'add', content: '  const [projects, aiSessions, approvals] = await Promise.all([' },
    { type: 'add', content: '    fetchProjects(),' },
    { type: 'add', content: '    fetchAiSessions(),' },
    { type: 'add', content: '    fetchApprovals(),' },
    { type: 'add', content: '  ]);' },
    { type: 'add', content: '  return {' },
    { type: 'add', content: '    devices: serverDevices.map(normalizeServerDevice),' },
    { type: 'add', content: '    projects, aiSessions, approvals,' },
    { type: 'add', content: '  };' },
    { type: 'add', content: '}' },
  ],
  logs: [
    { timestamp: '14:32:01', level: 'info', message: 'AI session started for api-gateway' },
    { timestamp: '14:32:02', level: 'info', message: 'Analyzing src/services/platformTransport.ts' },
    { timestamp: '14:32:05', level: 'info', message: 'Generating device snapshot adapters...' },
    { timestamp: '14:32:08', level: 'success', message: 'Diff generated: +16 -6 lines' },
    { timestamp: '14:32:09', level: 'warn', message: 'Validating realtime event routing' },
  ],
};

export const mockErrors = [
  {
    id: '1',
    type: 'critical' as const,
    title: 'ml-pipeline: Build Failed',
    message: 'TypeError: Cannot read properties of undefined',
    time: '5 min ago',
    project: 'ml-pipeline',
  },
  {
    id: '2',
    type: 'warning' as const,
    title: 'prod-apac-sydney: High CPU',
    message: 'CPU load at 99% - java process consuming 95%',
    time: '12 min ago',
    project: 'api-gateway',
  },
];

export const mockDevices: Device[] = [
  {
    id: 'mac-studio',
    name: 'Mac Studio - Desk',
    status: 'online',
    location: 'Shanghai desk',
    os: 'macOS 15.5',
    host: LOCAL_SERVICE_HOST,
    cpuLoad: 42,
    memLoad: 68,
    authorizedDirectories: [
      '~/Work/ai-products',
      '~/MyProgram/AiProgram',
      '~/Sites/lab',
    ],
    activePorts: [LOCAL_SERVICE_PORT],
    projectIds: ['1', '2'],
    activeSessionIds: ['vc-1', 'vc-2'],
    lastSeen: 'now',
    remoteTerminalEnabled: true,
    aiControlEnabled: true,
    capabilities: ['terminal', 'ai', 'file_browser'],
    tools: [
      { id: 'local-terminal', name: 'Local Terminal', available: true },
      { id: 'claude-code', name: 'Claude Code', command: 'claude', available: true, description: 'installed · 2.1.0' },
      { id: 'codex', name: 'Codex CLI', command: 'codex', available: true, description: 'installed · 0.9.2' },
    ],
    history: [
      { tool: 'claude-code', path: '~/Work/ai-products', exists: true, file_count: 18, updated_at: '2026-06-12T08:30:00Z' },
      { tool: 'codex', path: '~/.codex/sessions', exists: true, file_count: 42, updated_at: '2026-06-12T07:10:00Z' },
    ],
  },
  {
    id: 'mbp-travel',
    name: 'MacBook Pro - Travel',
    status: 'online',
    location: 'Remote tunnel',
    os: 'macOS 15.4',
    host: 'tailscale:mbp-travel',
    cpuLoad: 76,
    memLoad: 72,
    battery: 34,
    authorizedDirectories: ['~/Projects/mobile', '~/Projects/client-work'],
    activePorts: [3001],
    projectIds: ['3', '4'],
    activeSessionIds: ['vc-3'],
    lastSeen: '2 min ago',
    remoteTerminalEnabled: true,
    aiControlEnabled: false,
    capabilities: ['terminal', 'file_browser'],
    tools: [
      { id: 'local-terminal', name: 'Local Terminal', available: true },
      { id: 'claude-code', name: 'Claude Code', available: false, description: 'not installed' },
      { id: 'codex', name: 'Codex CLI', command: 'codex', available: true, description: 'installed · 0.9.2' },
    ],
    history: [
      { tool: 'codex', path: '~/.codex/sessions', exists: true, file_count: 9, updated_at: '2026-06-11T22:05:00Z' },
    ],
  },
  {
    id: 'linux-gpu',
    name: 'Linux GPU Box',
    status: 'offline',
    location: 'Studio rack',
    os: 'Ubuntu 24.04',
    host: '10.0.0.88',
    cpuLoad: 0,
    memLoad: 0,
    authorizedDirectories: ['/srv/agents', '/srv/ml'],
    activePorts: [],
    projectIds: ['3'],
    activeSessionIds: [],
    lastSeen: '3h ago',
    remoteTerminalEnabled: true,
    aiControlEnabled: true,
    capabilities: ['terminal', 'ai', 'gpu'],
    tools: [],
    history: [],
  },
];

export const mockPreviewLinks: PreviewLink[] = [
  {
    id: 'preview-1',
    sessionId: 'vc-1',
    port: LOCAL_SERVICE_PORT,
    shortUrl: LOCAL_SERVICE_BASE_URL,
    targetUrl: LOCAL_SERVICE_BASE_URL,
    expiresIn: '54 min',
    access: 'private',
  },
  {
    id: 'preview-2',
    sessionId: 'vc-3',
    port: 3001,
    shortUrl: 'https://vibe.link/p/k7m2',
    targetUrl: 'mbp-travel.local:3001',
    expiresIn: '18 min',
    access: 'team',
  },
];

export const mockVibeCodingRuns: VibeCodingRun[] = [
  {
    id: 'vc-1',
    title: 'Polish mobile control dashboard',
    deviceId: 'mac-studio',
    projectId: '2',
    directory: '~/MyProgram/AiProgram/AliangVibeCodingPhone',
    status: 'preview_ready',
    objective:
      'Make the dashboard feel like a mobile command center for remote coding agents.',
    model: 'GPT-5 Codex',
    projectBudget: {
      source: 'codex',
      currencySymbol: '$',
      used: 6.45,
      limit: 18,
      updatedAt: '1 min ago',
    },
    timeLimitMinutes: 90,
    elapsedMinutes: 42,
    risk: 'medium',
    currentStep: `Preview is ready at ${LOCAL_SERVICE_BASE_URL}.`,
    branch: 'feature/mobile-command-ui',
    updatedAt: '1 min ago',
    previewId: 'preview-1',
    suggestions: [
      'Open preview',
      'Run tests',
      'Tighten empty states',
      'Show diff summary',
      'Prepare commit',
    ],
    transcript: [
      {
        id: 'm1',
        role: 'user',
        mode: 'voice',
        content:
          'I want the phone app to show all coding agents and make the active tasks easier to control.',
        timestamp: '15:20',
      },
      {
        id: 'm2',
        role: 'assistant',
        mode: 'action',
        content:
          '整理后指令：重构控制台首页，突出套餐额度、在线设备、等待用户处理的 VibeCoding，并添加预览入口。',
        timestamp: '15:21',
      },
      {
        id: 'm3',
        role: 'assistant',
        content:
          'Dashboard and session cards are updated. I generated a preview link and need your review before preparing a commit.',
        timestamp: '15:36',
      },
    ],
    events: [
      {
        id: 'e1',
        type: 'file',
        title: 'Updated dashboard layout',
        detail: 'src/screens/dashboard/DashboardScreen.tsx',
        status: 'done',
        timestamp: '15:25',
      },
      {
        id: 'e2',
        type: 'test',
        title: 'Type check',
        detail: 'npx tsc --noEmit passed',
        status: 'done',
        timestamp: '15:32',
      },
      {
        id: 'e3',
        type: 'preview',
        title: 'Preview link opened',
        detail: `Port ${LOCAL_SERVICE_PORT} is reachable on LAN`,
        status: 'waiting',
        timestamp: '15:36',
      },
    ],
  },
  {
    id: 'vc-2',
    title: 'Connect device model sync',
    deviceId: 'mac-studio',
    projectId: '1',
    directory: '~/Work/ai-products/api-gateway',
    status: 'waiting_approval',
    objective:
      'Normalize platform device data and verify the device list after connection.',
    model: 'Claude Code',
    timeLimitMinutes: 60,
    elapsedMinutes: 26,
    risk: 'high',
    currentStep: 'Needs approval before updating shared transport files.',
    branch: 'agent/device-sync',
    updatedAt: '4 min ago',
    suggestions: [
      'Approve file edits',
      'Ask for plan',
      'Lower risk scope',
      'Pause session',
    ],
    transcript: [
      {
        id: 'm4',
        role: 'user',
        mode: 'text',
        content: 'Wire the device list through the platform transport and add focused checks.',
        timestamp: '14:32',
      },
      {
        id: 'm5',
        role: 'assistant',
        content:
          'I found the store and transport layer. This touches shared app state, so I need approval before applying the patch.',
        timestamp: '14:35',
      },
    ],
    events: [
      {
        id: 'e4',
        type: 'approval',
        title: 'Approval required',
        detail: 'Modify src/middleware/auth.ts and tests/auth.test.ts',
        status: 'waiting',
        timestamp: '14:35',
      },
    ],
  },
  {
    id: 'vc-3',
    title: 'Refine onboarding flow',
    deviceId: 'mbp-travel',
    projectId: '4',
    directory: '~/Projects/mobile/companion',
    status: 'running',
    objective:
      'Improve the first-run setup flow and connect empty states to mock data.',
    model: 'GPT-5 Codex',
    projectBudget: {
      source: 'codex',
      currencySymbol: '$',
      used: 2.15,
      limit: 10,
      updatedAt: 'now',
    },
    timeLimitMinutes: 45,
    elapsedMinutes: 13,
    risk: 'low',
    currentStep: 'Editing onboarding screen copy and form states.',
    branch: 'agent/onboarding-polish',
    updatedAt: 'now',
    previewId: 'preview-2',
    suggestions: ['Watch progress', 'Open preview', 'Send voice note'],
    transcript: [
      {
        id: 'm6',
        role: 'user',
        mode: 'voice',
        content:
          'Make onboarding less confusing and show what device permissions are needed.',
        timestamp: '16:08',
      },
      {
        id: 'm7',
        role: 'assistant',
        content:
          'I am updating the setup steps and will expose a preview when the first pass is done.',
        timestamp: '16:10',
      },
    ],
    events: [
      {
        id: 'e5',
        type: 'status',
        title: 'Implementation running',
        detail: 'Editing onboarding copy and permission checklist',
        status: 'running',
        timestamp: '16:14',
      },
    ],
  },
];
