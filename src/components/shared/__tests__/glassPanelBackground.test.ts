import { glassPanelBackground } from '../GlassPanel';

// Regression guard for the "vibecoding list long-press menu looked transparent"
// bug: GlassPanel was designed as a near-transparent glass card (dark:
// rgba(255,255,255,0.04)) to float on a SOLID in-app surface. Reused inside a
// Modal whose only backdrop is a semi-transparent dim layer, that 96%-clear
// fill let the dimmed list bleed through the dialog body. The menu panel must
// opt into a solid surface token so its content stops being see-through.
const colors = {
  surfaceContainerHigh: '#333333',
  surfaceContainerLow: '#f1f4fa',
};

describe('glassPanelBackground', () => {
  it('opaque renders a SOLID surface token so modal dialogs are not see-through', () => {
    expect(glassPanelBackground({ isDark: true, opaque: true, colors })).toBe(
      colors.surfaceContainerHigh,
    );
    expect(glassPanelBackground({ isDark: false, opaque: true, colors })).toBe(
      colors.surfaceContainerHigh,
    );
  });

  it('non-opaque keeps the glass fill (dark) / low surface (light) for in-screen cards', () => {
    expect(glassPanelBackground({ isDark: true, opaque: false, colors })).toBe(
      'rgba(255, 255, 255, 0.04)',
    );
    expect(glassPanelBackground({ isDark: false, opaque: false, colors })).toBe(
      colors.surfaceContainerLow,
    );
  });
});
