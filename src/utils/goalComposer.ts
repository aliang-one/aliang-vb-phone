export const parseGoalCommand = (value: string): string | null => {
  const match = value.match(/^\s*\/goal(?:\s+([\s\S]*))?$/i);
  return match ? match[1] ?? '' : null;
};

export const isGoalCommand = (value: string): boolean =>
  parseGoalCommand(value) !== null;
