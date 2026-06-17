export const terminalKeySequences = {
  escape: '\x1b',
  tab: '\t',
  enter: '\r',
  backspace: '\x7f',
  delete: '\x1b[3~',
  home: '\x1b[H',
  end: '\x1b[F',
  pageUp: '\x1b[5~',
  pageDown: '\x1b[6~',
  ctrlC: '\x03',
  ctrlD: '\x04',
  ctrlL: '\x0c',
  ctrlR: '\x12',
  ctrlU: '\x15',
  ctrlW: '\x17',
  arrowUp: '\x1b[A',
  arrowDown: '\x1b[B',
  arrowRight: '\x1b[C',
  arrowLeft: '\x1b[D',
} as const;

export type TerminalShortcutKeyRow = readonly [label: string, sequence: string];
export interface TerminalShortcutGroup {
  label: string;
  rows: ReadonlyArray<TerminalShortcutKeyRow>;
}

export const terminalShortcutGroups: ReadonlyArray<TerminalShortcutGroup> = [
  {
    label: 'Core',
    rows: [
      ['Esc', terminalKeySequences.escape],
      ['Tab', terminalKeySequences.tab],
      ['Enter', terminalKeySequences.enter],
      ['Backspace', terminalKeySequences.backspace],
      ['Ctrl+C', terminalKeySequences.ctrlC],
      ['Ctrl+D', terminalKeySequences.ctrlD],
    ],
  },
  {
    label: 'Edit',
    rows: [
      ['Ctrl+L', terminalKeySequences.ctrlL],
      ['Ctrl+R', terminalKeySequences.ctrlR],
      ['Ctrl+U', terminalKeySequences.ctrlU],
      ['Ctrl+W', terminalKeySequences.ctrlW],
      ['Delete', terminalKeySequences.delete],
      ['Home', terminalKeySequences.home],
      ['End', terminalKeySequences.end],
    ],
  },
  {
    label: 'Move',
    rows: [
      ['PgUp', terminalKeySequences.pageUp],
      ['PgDn', terminalKeySequences.pageDown],
      ['Up', terminalKeySequences.arrowUp],
      ['Down', terminalKeySequences.arrowDown],
      ['Left', terminalKeySequences.arrowLeft],
      ['Right', terminalKeySequences.arrowRight],
    ],
  },
] as const;

export const terminalShortcutKeyRows: TerminalShortcutKeyRow[] =
  terminalShortcutGroups.flatMap(
    group => group.rows,
);

export const terminalNativeKeySequences: Record<string, string> = {
  Escape: terminalKeySequences.escape,
  Tab: terminalKeySequences.tab,
  Enter: terminalKeySequences.enter,
  Backspace: terminalKeySequences.backspace,
  Delete: terminalKeySequences.delete,
  Home: terminalKeySequences.home,
  End: terminalKeySequences.end,
  PageUp: terminalKeySequences.pageUp,
  PageDown: terminalKeySequences.pageDown,
  ArrowUp: terminalKeySequences.arrowUp,
  ArrowDown: terminalKeySequences.arrowDown,
  ArrowRight: terminalKeySequences.arrowRight,
  ArrowLeft: terminalKeySequences.arrowLeft,
};
