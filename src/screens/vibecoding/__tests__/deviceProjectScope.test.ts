import {
  initialProjectIdForDevice,
  projectBelongsToDevice,
  resolveDeviceScopedProject,
} from '../deviceProjectScope';
import type { Device, Project } from '../../../data/platformModels';

const project = (overrides: Partial<Project> = {}): Project => ({
  id: 'proj-old',
  name: 'old device project',
  status: 'active',
  branch: 'main',
  language: 'ts',
  description: '',
  path: '/home/old/proj',
  deviceId: 'dev-old',
  detectedPorts: [],
  ...overrides,
});

const device = (overrides: Partial<Device> = {}): Device => ({
  id: 'dev-new',
  name: 'brand new device',
  status: 'online',
  location: '',
  os: 'windows',
  host: '',
  cpuLoad: 0,
  memLoad: 0,
  authorizedDirectories: [],
  activePorts: [],
  projectIds: [],
  activeSessionIds: [],
  lastSeen: '',
  remoteTerminalEnabled: true,
  aiControlEnabled: true,
  peerExecEnabled: false,
  peerFetchEnabled: false,
  capabilities: [],
  tools: [],
  history: [],
  ...overrides,
});

describe('deviceProjectScope — 崭新设备创建对话消息发不出去(404 project_not_found 零痕迹)', () => {
  describe('initialProjectIdForDevice — 初始项目必须设备级', () => {
    test('新设备无项目 → 空串(自定义路径流),绝不跨设备兜底', () => {
      const projects = [project()]; // 只有旧设备的项目
      expect(initialProjectIdForDevice(projects, 'dev-new', [device()])).toBe('');
    });

    test('旧实现回归:projects[0] 属于其他设备时不得选中', () => {
      const projects = [project({ id: 'proj-old', deviceId: 'dev-old' })];
      const id = initialProjectIdForDevice(projects, 'dev-new', [
        device({ id: 'dev-new', projectIds: [] }),
      ]);
      expect(id).not.toBe('proj-old');
    });

    test('设备自己的项目 → 正常选中', () => {
      const projects = [
        project({ id: 'proj-old', deviceId: 'dev-old' }),
        project({ id: 'proj-new', deviceId: 'dev-new', path: '/home/new/proj' }),
      ];
      expect(initialProjectIdForDevice(projects, 'dev-new', [device()])).toBe(
        'proj-new',
      );
    });

    test('设备 projectIds 广告的项目(路径归属另一设备记录)也可选中', () => {
      const projects = [project({ id: 'proj-adv', deviceId: 'dev-old' })];
      const devices = [device({ id: 'dev-new', projectIds: ['proj-adv'] })];
      expect(initialProjectIdForDevice(projects, 'dev-new', devices)).toBe(
        'proj-adv',
      );
    });

    test('deviceId 在 devices 里找不到 → 只按 project.deviceId 匹配', () => {
      const projects = [project({ id: 'proj-x', deviceId: 'dev-x' })];
      expect(initialProjectIdForDevice(projects, 'dev-x', [])).toBe('proj-x');
      expect(initialProjectIdForDevice(projects, 'dev-none', [])).toBe('');
    });
  });

  describe('resolveDeviceScopedProject — 发送前项目归属防御', () => {
    test('跨设备 projectId → undefined(回落 project_path 流,服务端为本机建项目)', () => {
      const projects = [project({ id: 'proj-old', deviceId: 'dev-old' })];
      expect(
        resolveDeviceScopedProject(projects, 'proj-old', device()),
      ).toBeUndefined();
    });

    test('本设备 projectId → 正常解析', () => {
      const projects = [project({ id: 'proj-new', deviceId: 'dev-new' })];
      expect(resolveDeviceScopedProject(projects, 'proj-new', device())?.id).toBe(
        'proj-new',
      );
    });

    test('projectIds 广告的 projectId → 正常解析', () => {
      const projects = [project({ id: 'proj-adv', deviceId: 'dev-old' })];
      const dev = device({ projectIds: ['proj-adv'] });
      expect(resolveDeviceScopedProject(projects, 'proj-adv', dev)?.id).toBe(
        'proj-adv',
      );
    });

    test('device 未定义 → 一律 undefined(不发给服务端赌运气)', () => {
      const projects = [project()];
      expect(resolveDeviceScopedProject(projects, 'proj-old')).toBeUndefined();
    });

    test('空 projectId → undefined', () => {
      expect(resolveDeviceScopedProject([project()], '')).toBeUndefined();
    });
  });

  describe('projectBelongsToDevice — 归属谓词', () => {
    test('deviceId 直接匹配 / projectIds 广告匹配 / 不匹配', () => {
      const p = project({ id: 'p1', deviceId: 'dev-a' });
      expect(projectBelongsToDevice(p, device({ id: 'dev-a' }))).toBe(true);
      expect(
        projectBelongsToDevice(p, device({ id: 'dev-b', projectIds: ['p1'] })),
      ).toBe(true);
      expect(projectBelongsToDevice(p, device({ id: 'dev-b' }))).toBe(false);
      expect(projectBelongsToDevice(p, undefined)).toBe(false);
    });
  });
});
