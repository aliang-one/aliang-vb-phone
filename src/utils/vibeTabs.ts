export type VibeTab =
  | { key: 'vibecoding'; title: string }
  | { key: 'tasks'; title: string }
  | { key: 'terminals'; title: string };

/** Tasks 段仅在确有任务数据时出现；否则只留 Vibecoding + Terminals 两段。 */
export function buildTabs(hasTasks: boolean): VibeTab[] {
  const tabs: VibeTab[] = [{ key: 'vibecoding', title: 'Vibecoding' }];
  if (hasTasks) tabs.push({ key: 'tasks', title: 'Tasks' });
  tabs.push({ key: 'terminals', title: 'Terminals' });
  return tabs;
}
