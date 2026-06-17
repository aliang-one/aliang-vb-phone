import {
  terminalKeySequences,
  terminalNativeKeySequences,
  terminalShortcutGroups,
  terminalShortcutKeyRows,
} from '../src/utils/terminalKeySequences';

describe('terminalKeySequences', () => {
  it('uses the same terminal bytes for shortcut labels and native keys', () => {
    expect(terminalShortcutKeyRows).toEqual([
      ['Esc', terminalKeySequences.escape],
      ['Tab', terminalKeySequences.tab],
      ['Enter', terminalKeySequences.enter],
      ['Backspace', terminalKeySequences.backspace],
      ['Ctrl+C', terminalKeySequences.ctrlC],
      ['Ctrl+D', terminalKeySequences.ctrlD],
      ['Ctrl+L', terminalKeySequences.ctrlL],
      ['Ctrl+R', terminalKeySequences.ctrlR],
      ['Ctrl+U', terminalKeySequences.ctrlU],
      ['Ctrl+W', terminalKeySequences.ctrlW],
      ['Delete', terminalKeySequences.delete],
      ['Home', terminalKeySequences.home],
      ['End', terminalKeySequences.end],
      ['PgUp', terminalKeySequences.pageUp],
      ['PgDn', terminalKeySequences.pageDown],
      ['Up', terminalKeySequences.arrowUp],
      ['Down', terminalKeySequences.arrowDown],
      ['Left', terminalKeySequences.arrowLeft],
      ['Right', terminalKeySequences.arrowRight],
    ]);
    expect(terminalNativeKeySequences).toMatchObject({
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
    });
    expect(terminalShortcutGroups.flatMap(group => group.rows)).toEqual(
      terminalShortcutKeyRows,
    );
    expect(terminalShortcutGroups.map(group => group.label)).toEqual([
      'Core',
      'Edit',
      'Move',
    ]);
  });
});
