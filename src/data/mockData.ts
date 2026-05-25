export interface Project {
  id: string;
  name: string;
  status: 'active' | 'idle' | 'error';
  branch: string;
  lastDeploy: string;
  language: string;
  description: string;
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

export interface GitHubRepo {
  id: string;
  name: string;
  fullName: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  openPRs: number;
  lastUpdated: string;
  visibility: 'public' | 'private';
}

export interface PullRequest {
  id: string;
  title: string;
  author: string;
  branch: string;
  base: string;
  status: 'open' | 'merged' | 'closed';
  additions: number;
  deletions: number;
  files: DiffFile[];
}

export interface DiffFile {
  filename: string;
  status: 'added' | 'modified' | 'removed';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
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

// --- Mock Data ---

export const mockProjects: Project[] = [
  {
    id: '1',
    name: 'api-gateway',
    status: 'active',
    branch: 'main',
    lastDeploy: '2h ago',
    language: 'Go',
    description: 'High-performance API gateway with rate limiting',
  },
  {
    id: '2',
    name: 'web-dashboard',
    status: 'active',
    branch: 'feature/auth',
    lastDeploy: '5h ago',
    language: 'TypeScript',
    description: 'React dashboard for monitoring services',
  },
  {
    id: '3',
    name: 'ml-pipeline',
    status: 'error',
    branch: 'dev',
    lastDeploy: '1d ago',
    language: 'Python',
    description: 'ML training pipeline with automated CI/CD',
  },
  {
    id: '4',
    name: 'mobile-app',
    status: 'idle',
    branch: 'main',
    lastDeploy: '3d ago',
    language: 'Kotlin',
    description: 'Android companion app',
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
    content: 'Add error handling to the auth middleware',
    timestamp: '14:32',
  },
  {
    id: '2',
    role: 'assistant',
    content:
      "I'll add comprehensive error handling to the auth middleware. This includes JWT validation errors, expired token handling, and rate limiting error responses.",
    timestamp: '14:32',
    reasoning:
      'The user wants error handling in auth middleware. I should look at the existing middleware pattern and add try-catch blocks for JWT verification, handle TokenExpiredError separately, and add proper HTTP status codes for each error type.',
    fileActions: [
      { type: 'modify', path: 'src/middleware/auth.ts', lines: 24 },
      { type: 'create', path: 'src/utils/authErrors.ts', lines: 45 },
      { type: 'modify', path: 'tests/auth.test.ts', lines: 12 },
    ],
  },
];

export const mockGitHubRepos: GitHubRepo[] = [
  {
    id: '1',
    name: 'api-gateway',
    fullName: 'org/api-gateway',
    description: 'High-performance API gateway',
    language: 'Go',
    stars: 234,
    forks: 45,
    openPRs: 3,
    lastUpdated: '2h ago',
    visibility: 'private',
  },
  {
    id: '2',
    name: 'web-dashboard',
    fullName: 'org/web-dashboard',
    description: 'React monitoring dashboard',
    language: 'TypeScript',
    stars: 89,
    forks: 12,
    openPRs: 7,
    lastUpdated: '5h ago',
    visibility: 'private',
  },
  {
    id: '3',
    name: 'mobile-app',
    fullName: 'org/mobile-app',
    description: 'Cross-platform companion app',
    language: 'Kotlin',
    stars: 156,
    forks: 23,
    openPRs: 1,
    lastUpdated: '1d ago',
    visibility: 'public',
  },
];

export const mockPullRequest: PullRequest = {
  id: '1',
  title: 'feat: add error handling to auth middleware',
  author: 'dev.agent',
  branch: 'feature/auth-error-handling',
  base: 'main',
  status: 'open',
  additions: 45,
  deletions: 12,
  files: [
    {
      filename: 'src/middleware/auth.ts',
      status: 'modified',
      additions: 24,
      deletions: 8,
      hunks: [
        {
          oldStart: 15,
          newStart: 15,
          lines: [
            { type: 'context', content: 'export async function authMiddleware(req, res, next) {' },
            { type: 'context', content: '  const token = req.headers.authorization?.split(" ")[1];' },
            { type: 'remove', content: '  const decoded = jwt.verify(token, SECRET);' },
            { type: 'remove', content: '  req.user = decoded;' },
            { type: 'add', content: '  try {' },
            { type: 'add', content: '    const decoded = jwt.verify(token, SECRET);' },
            { type: 'add', content: '    req.user = decoded;' },
            { type: 'add', content: '  } catch (err) {' },
            { type: 'add', content: '    if (err.name === "TokenExpiredError") {' },
            { type: 'add', content: '      return res.status(401).json({ error: "TOKEN_EXPIRED" });' },
            { type: 'add', content: '    }' },
            { type: 'add', content: '    return res.status(403).json({ error: "INVALID_TOKEN" });' },
            { type: 'add', content: '  }' },
            { type: 'context', content: '  next();' },
            { type: 'context', content: '}' },
          ],
        },
      ],
    },
  ],
};

export const mockVibeCodingSession: VibeCodingSession = {
  id: '1',
  project: 'api-gateway',
  status: 'applying',
  currentFile: 'src/middleware/auth.ts',
  diffLines: [
    { type: 'context', content: 'import jwt from "jsonwebtoken";' },
    { type: 'context', content: 'import { Request, Response, NextFunction } from "express";' },
    { type: 'context', content: '' },
    { type: 'context', content: 'const SECRET = process.env.JWT_SECRET!;' },
    { type: 'context', content: '' },
    { type: 'remove', content: 'export async function authMiddleware(req: Request, res: Response, next: NextFunction) {' },
    { type: 'remove', content: '  const token = req.headers.authorization?.split(" ")[1];' },
    { type: 'remove', content: '  if (!token) return res.status(401).json({ error: "No token" });' },
    { type: 'remove', content: '  const decoded = jwt.verify(token, SECRET);' },
    { type: 'remove', content: '  req.user = decoded;' },
    { type: 'remove', content: '  next();' },
    { type: 'remove', content: '}' },
    { type: 'add', content: 'export async function authMiddleware(req: Request, res: Response, next: NextFunction) {' },
    { type: 'add', content: '  try {' },
    { type: 'add', content: '    const token = req.headers.authorization?.split(" ")[1];' },
    { type: 'add', content: '    if (!token) {' },
    { type: 'add', content: '      return res.status(401).json({ error: "MISSING_TOKEN" });' },
    { type: 'add', content: '    }' },
    { type: 'add', content: '    const decoded = jwt.verify(token, SECRET, { algorithms: ["HS256"] });' },
    { type: 'add', content: '    req.user = decoded as JwtPayload;' },
    { type: 'add', content: '    next();' },
    { type: 'add', content: '  } catch (err: any) {' },
    { type: 'add', content: '    if (err.name === "TokenExpiredError") {' },
    { type: 'add', content: '      return res.status(401).json({ error: "TOKEN_EXPIRED", message: "Token has expired" });' },
    { type: 'add', content: '    }' },
    { type: 'add', content: '    return res.status(403).json({ error: "INVALID_TOKEN", message: "Invalid authentication" });' },
    { type: 'add', content: '  }' },
    { type: 'add', content: '}' },
  ],
  logs: [
    { timestamp: '14:32:01', level: 'info', message: 'AI session started for api-gateway' },
    { timestamp: '14:32:02', level: 'info', message: 'Analyzing src/middleware/auth.ts' },
    { timestamp: '14:32:05', level: 'info', message: 'Generating error handling patterns...' },
    { timestamp: '14:32:08', level: 'success', message: 'Diff generated: +16 -6 lines' },
    { timestamp: '14:32:09', level: 'warn', message: 'Applying changes to production branch' },
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
