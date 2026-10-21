import { GOAL_UI_ENABLED } from '../config/featureFlags';

export type VibeTab =
  | { key: 'vibecoding'; title: string }
  | { key: 'tasks'; title: string }
  | { key: 'terminals'; title: string };

/**
 * Tasks 段仅在确有任务数据时出现；否则只留 Vibecoding + Terminals 两段。
 * GOAL_UI_ENABLED 关闭时 Tasks 段整段不出现——它唯一的用途就是 goal 收件箱,
 * 藏掉入口后留着只会是空壳(见 config/featureFlags.ts)。
 */
export function buildTabs(hasTasks: boolean): VibeTab[] {
  const tabs: VibeTab[] = [{ key: 'vibecoding', title: 'Vibecoding' }];
  if (GOAL_UI_ENABLED && hasTasks) tabs.push({ key: 'tasks', title: 'Tasks' });
  tabs.push({ key: 'terminals', title: 'Terminals' });
  return tabs;
}
