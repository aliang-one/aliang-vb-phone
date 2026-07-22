import { isGoalCommand, parseGoalCommand } from '../src/utils/goalComposer';

describe('goal composer command parsing', () => {
  it.each([
    ['/goal', ''],
    ['/goal 完成登录流程', '完成登录流程'],
    ['  /GOAL\n完成登录流程', '完成登录流程'],
  ])('detects %p and returns its objective', (input, objective) => {
    expect(parseGoalCommand(input)).toBe(objective);
    expect(isGoalCommand(input)).toBe(true);
  });

  it.each(['/goals', '/goalkeeper', '请执行 /goal 任务'])('does not misclassify %p', input => {
    expect(parseGoalCommand(input)).toBeNull();
    expect(isGoalCommand(input)).toBe(false);
  });
});
