import type { StateCreator } from 'zustand';
import { platformTransport } from '../../services/platformTransport';
import { fileCache } from '../../services/fileCache';
import type { ControlCenterState } from '../types';
import {
  attachDeviceRelations,
  event,
  formatBytes,
  nowTime,
  platformDeviceToClient,
  serverProjectContentToFileEntry,
  serverProjectFileToClient,
  serverProjectToClient,
} from '../internals';

type DeviceProjectSlice = Pick<
  ControlCenterState,
  | 'devices' | 'projects' | 'projectFiles' | 'scanResults'
  | 'bindDevice' | 'renameDevice' | 'scanDeviceProjects'
  | 'createProject' | 'updateProject' | 'deleteProject'
  | 'loadProjectFiles' | 'loadProjectFileContent' | 'dropFileContent'
>;

export const createDeviceProjectSlice: StateCreator<ControlCenterState, [], [], DeviceProjectSlice> = (set, get) => ({
  devices: [],
  projects: [],
  projectFiles: [],
  scanResults: [],

  bindDevice: async (input) => {
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

    if (get().serverMode && input.pairingCode) {
      try {
        const clientDevice = platformDeviceToClient(
          await platformTransport.pairDevice(input.pairingCode),
        );
        set(state => ({
          devices: [clientDevice, ...state.devices.filter(d => d.id !== clientDevice.id)],
          events: [
            event('device.bound', 'Device bound', `${clientDevice.name} paired successfully.`, 'done', { deviceId: clientDevice.id }),
            ...state.events,
          ],
        }));
        return { ok: true, deviceId: clientDevice.id };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Pairing failed',
        };
      }
    }

    return {
      ok: false,
      error: 'Platform connection is required before binding a device.',
    };
  },

  renameDevice: async (deviceId, name) => {
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

    if (!get().serverMode) {
      return {
        ok: false,
        error: 'Platform connection is required before renaming a device.',
      };
    }

    const updated = platformDeviceToClient(
      await platformTransport.updateDeviceSettings(deviceId, { name: trimmed }),
    );
    set(state => ({
      devices: attachDeviceRelations(
        state.devices.map(device => device.id === deviceId ? updated : device),
        state.projects,
        state.vibeRuns,
      ),
      events: [
        event('device.bound', 'Device renamed', updated.name, 'done', { deviceId }),
        ...state.events,
      ].slice(0, 120),
    }));

    return { ok: true, deviceId };
  },

  scanDeviceProjects: async (deviceId) => {
    if (get().serverMode) {
      try {
        await platformTransport.scanDeviceProjects(deviceId);
        // Projects will be updated via WS message projects.updated
      } catch {
        // Silently fail — WS may still deliver results
      }
      return;
    }
  },

  createProject: async input => {
    if (!get().serverMode) {
      throw new Error('Platform connection is required before creating a project.');
    }
    const serverProject = await platformTransport.createProject({
      device_id: input.deviceId,
      path: input.path,
      name: input.name,
      language: input.language,
      description: input.description,
      status: 'fresh',
      source_tools: ['mobile'],
    });
    const project = serverProjectToClient(serverProject);
    set(state => {
      const projects = [project, ...state.projects.filter(item => item.id !== project.id)];
      return {
        projects,
        devices: attachDeviceRelations(state.devices, projects, state.vibeRuns),
        events: [
          event('project.updated', 'Project created', project.path, 'done', {
            deviceId: project.deviceId,
            projectId: project.id,
          }),
          ...state.events,
        ].slice(0, 120),
      };
    });
    return project.id;
  },

  updateProject: async (projectId, input) => {
    if (!get().serverMode) {
      throw new Error('Platform connection is required before updating a project.');
    }
    const serverProject = await platformTransport.updateProject(projectId, {
      name: input.name,
      path: input.path,
      branch: input.branch,
      language: input.language,
      description: input.description,
      status: input.status,
    });
    const project = serverProjectToClient(serverProject);
    set(state => {
      const projects = state.projects.map(item => item.id === project.id ? project : item);
      return {
        projects,
        devices: attachDeviceRelations(state.devices, projects, state.vibeRuns),
      };
    });
  },

  deleteProject: async projectId => {
    if (!get().serverMode) {
      throw new Error('Platform connection is required before deleting a project.');
    }
    await platformTransport.deleteProject(projectId);
    set(state => {
      const projects = state.projects.filter(item => item.id !== projectId);
      const vibeRuns = state.vibeRuns.filter(run => run.projectId !== projectId);
      return {
        projects,
        vibeRuns,
        projectFiles: state.projectFiles.filter(file => file.projectId !== projectId),
        devices: attachDeviceRelations(state.devices, projects, vibeRuns),
      };
    });
  },

  loadProjectFiles: async (projectId, path, opts) => {
    if (!get().serverMode) {
      throw new Error('Platform connection is required before loading project files.');
    }

    try {
      const result = await fileCache.listFiles(projectId, path ?? '', { force: opts?.force });
      const nextEntries = result.entries.map(entry =>
        serverProjectFileToClient(result.project_id, result.path, entry),
      );

      set(state => {
        const existingByPath = new Map(
          state.projectFiles
            .filter(item => item.projectId === result.project_id)
            .map(item => [item.path, item]),
        );
        const mergedEntries = nextEntries.map(entry => {
          const existing = existingByPath.get(entry.path);
          if (!existing) return entry;
          if (existing.content !== undefined && existing.etag !== entry.etag) {
            fileCache.invalidateContent(result.project_id, entry.path);
            return entry;
          }
          return {
            ...entry,
            content: existing.content,
            encoding: existing.encoding,
            loadedAt: existing.loadedAt,
            truncated: existing.truncated,
            etag: entry.etag,
            previewBlocked: existing.previewBlocked,
          };
        });

        return {
          projectFiles: [
            ...state.projectFiles.filter(
              item =>
                item.projectId !== result.project_id ||
                item.directoryPath !== result.path,
            ),
            ...mergedEntries,
          ],
          events: [
            event(
              'project.scan.completed',
              'Project files loaded',
              `${mergedEntries.length} entries from ${result.path}`,
              'done',
              { projectId: result.project_id, deviceId: result.device_id },
            ),
            ...state.events,
          ].slice(0, 120),
        };
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Project file list failed';
      set(state => ({
        events: [
          event('project.scan.completed', 'Project file load failed', detail, 'failed', {
            projectId,
          }),
          ...state.events,
        ].slice(0, 120),
      }));
      throw error;
    }
  },

  loadProjectFileContent: async (projectId, path, opts) => {
    if (!get().serverMode) {
      throw new Error('Platform connection is required before reading project files.');
    }

    const existing = get().projectFiles.find(
      item => item.projectId === projectId && item.path === path,
    );
    const meta = {
      name: existing?.name ?? path.split('/').pop() ?? path,
      sizeBytes: existing?.sizeBytes,
    };

    try {
      const outcome = await fileCache.readFile(projectId, path, meta, {
        force: opts?.force,
        hasCachedContent: existing?.content !== undefined,
      });

      if (outcome.kind === 'blocked') {
        set(state => ({
          projectFiles: state.projectFiles.map(item =>
            item.projectId === projectId && item.path === path
              ? { ...item, content: undefined, previewBlocked: { reason: outcome.reason, sizeBytes: outcome.sizeBytes } }
              : item,
          ),
        }));
        return;
      }
      if (outcome.kind === 'cache_hit') {
        fileCache.touch(projectId, path);
        return;
      }

      const result = outcome.content;
      const etag = `${result.size_bytes ?? ''}:${result.modified_at ?? ''}`;
      // UTF-16 code units, not bytes — intentional: LRU is an approximate safety bound, not exact memory accounting.
      const bytes = result.content.length;

      set(state => {
        const hasExisting = state.projectFiles.some(
          item => item.projectId === result.project_id && item.path === result.path,
        );
        const nextFiles = hasExisting
          ? state.projectFiles.map(item =>
              item.projectId === result.project_id && item.path === result.path
                ? {
                    ...item,
                    content: result.content,
                    encoding: result.encoding,
                    loadedAt: nowTime(),
                    truncated: result.truncated,
                    sizeBytes: result.size_bytes ?? item.sizeBytes,
                    size: result.size_bytes !== undefined ? formatBytes(result.size_bytes) : item.size,
                    modifiedAt: result.modified_at ?? item.modifiedAt,
                    lastTouched: result.modified_at ?? item.lastTouched,
                    etag,
                    previewBlocked: undefined,
                    error: undefined,
                  }
                : item,
            )
          : [...state.projectFiles, serverProjectContentToFileEntry(result.project_id, result)];

        return {
          projectFiles: nextFiles,
          events: [
            event('file.changed', 'Project file loaded', result.path, 'done', {
              projectId: result.project_id,
              deviceId: result.device_id,
            }),
            ...state.events,
          ].slice(0, 120),
        };
      });

      const evicted = fileCache.noteContentLoaded(projectId, path, bytes, etag);
      for (const key of evicted) {
        // key format: `read:<projectId>:<path>`; projectIds are UUIDs (no colon),
        // so the first ':' after the `read:` prefix splits projectId from path.
        const rest = key.slice('read:'.length);
        const sep = rest.indexOf(':');
        const evProjectId = rest.slice(0, sep);
        const evPath = rest.slice(sep + 1);
        get().dropFileContent(evProjectId, evPath);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Project file read failed';
      set(state => ({
        projectFiles: state.projectFiles.map(item =>
          item.projectId === projectId && item.path === path
            ? { ...item, error: detail }
            : item,
        ),
        events: [
          event('file.changed', 'Project file read failed', detail, 'failed', {
            projectId,
          }),
          ...state.events,
        ].slice(0, 120),
      }));
      throw error;
    }
  },

  dropFileContent: (projectId, path) => {
    set(state => ({
      projectFiles: state.projectFiles.map(item =>
        item.projectId === projectId && item.path === path
          ? {
              ...item,
              content: undefined,
              encoding: undefined,
              loadedAt: undefined,
              etag: undefined,
              error: undefined,
            }
          : item,
      ),
    }));
  },
});
