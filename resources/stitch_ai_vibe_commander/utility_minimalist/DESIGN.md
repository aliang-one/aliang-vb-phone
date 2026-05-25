---
name: Utility Minimalist
colors:
  surface: '#f7f9ff'
  surface-dim: '#d7dae1'
  surface-bright: '#f7f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f1f4fa'
  surface-container: '#ebeef5'
  surface-container-high: '#e5e8ef'
  surface-container-highest: '#e0e2e9'
  on-surface: '#181c21'
  on-surface-variant: '#424753'
  inverse-surface: '#2d3136'
  inverse-on-surface: '#eef1f8'
  outline: '#727785'
  outline-variant: '#c2c6d6'
  surface-tint: '#005bc0'
  primary: '#0051ae'
  on-primary: '#ffffff'
  primary-container: '#0969da'
  on-primary-container: '#ecefff'
  inverse-primary: '#adc6ff'
  secondary: '#565f69'
  on-secondary: '#ffffff'
  secondary-container: '#dae3ef'
  on-secondary-container: '#5c656f'
  tertiary: '#4d565d'
  on-tertiary: '#ffffff'
  tertiary-container: '#656e76'
  on-tertiary-container: '#e8f1fa'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a41'
  on-primary-fixed-variant: '#004493'
  secondary-fixed: '#dae3ef'
  secondary-fixed-dim: '#bec7d2'
  on-secondary-fixed: '#141c25'
  on-secondary-fixed-variant: '#3f4851'
  tertiary-fixed: '#dbe3ed'
  tertiary-fixed-dim: '#bfc8d1'
  on-tertiary-fixed: '#141d23'
  on-tertiary-fixed-variant: '#3f484f'
  background: '#f7f9ff'
  on-background: '#181c21'
  surface-variant: '#e0e2e9'
typography:
  h1:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.25'
    letterSpacing: -0.02em
  h2:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.25'
    letterSpacing: -0.01em
  h3:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.25'
    letterSpacing: '0'
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.5'
  code-md:
    fontFamily: monospace
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.45'
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.2'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  container-max: 1280px
  gutter: 16px
---

## Brand & Style
This design system is rooted in **Minimalism** and developer-centric utility. It prioritizes information density and clarity over decorative flair, drawing inspiration from technical documentation and version control interfaces. The brand personality is precise, reliable, and unobtrusive—designed to fade into the background so the user's content remains the primary focus. 

The aesthetic is defined by high-contrast monochromatic foundations, generous yet intentional whitespace, and a structural rigor that evokes a sense of order and efficiency. It avoids all forms of skeuomorphism, neon glows, or heavy gradients, relying instead on thin lines and tonal shifts to communicate hierarchy.

## Colors
The palette is strictly functional. In **Light Mode**, the interface uses a pure white background with dark gray text to maintain high legibility without the harshness of pure black. Blue accents are reserved exclusively for interactive elements like links, primary actions, and state indicators.

In **Dark Mode**, the system shifts to a deep charcoal/black foundation (`#0D1117`). The primary text transitions to a light gray to reduce eye strain, while the blue accent is desaturated to a muted variant. Grayscale shades are used to differentiate "surface" layers (e.g., sidebars vs. main content) and to define the subtle 1px borders that separate UI modules.

## Typography
The typography system utilizes **Inter** for all UI and prose elements to ensure maximum readability across screen densities. A vertical rhythm is maintained by sticking to a base 14px size for standard body text, which allows for high information density characteristic of technical tools.

A crisp **Monospace** stack is used for terminal outputs, code blocks, and specific technical identifiers. Weight is used sparingly to create hierarchy—primarily restricted to semi-bold (`600`) for headings and medium (`500`) for labels. Headlines feature slight negative letter-spacing to appear tighter and more professional at larger scales.

## Layout & Spacing
This design system employs a **Fixed-Fluid Hybrid Grid**. The primary content container is capped at a maximum width for readability, but the internal components respond fluidly to the viewport. 

The spacing rhythm is built on an **8px linear scale**. All margins, paddings, and component heights should be multiples of 8 (or 4 for micro-adjustments). This ensures a mathematical harmony across the layout. Use 16px gutters between columns and 24px margins for page-level padding to create a structured, "boxed" feel that aligns with the 1px border philosophy.

## Elevation & Depth
Depth is created through **Tonal Layers** and **Low-Contrast Outlines** rather than traditional shadows. Surfaces are stacked using background color shifts: 
- **Level 0 (Base):** The main background color.
- **Level 1 (Card/Section):** A slightly shifted background color (e.g., a very light gray in light mode) or the base color wrapped in a 1px border.
- **Level 2 (Popovers/Modals):** Elevated surfaces that use a very subtle, highly diffused ambient shadow solely to separate the element from the layer immediately below it.

Borders are the primary tool for separation. All containers must feature a 1px solid border in a neutral tone slightly darker (light mode) or lighter (dark mode) than the surface it sits upon.

## Shapes
The shape language is disciplined and consistent. A standard **8px (0.5rem) radius** is applied to almost all UI elements, including buttons, input fields, cards, and dropdowns. This "Rounded" setting provides a subtle softening of the high-contrast aesthetic without appearing overly organic or "bubbly."

Small tags or badges may use a slightly smaller radius (4px) to maintain visual balance at smaller scales, but the 8px standard remains the default for structural components.

## Components
- **Buttons:** Primary buttons use a solid fill (Blue) with white text. Secondary buttons use a white/dark-gray background with a 1px border and a subtle hover state that shifts the background tone slightly.
- **Inputs:** Text fields feature a 1px border, 8px corners, and a 14px font size. On focus, the border color changes to the primary blue with a subtle 2px outer glow (ring) of the same color at low opacity.
- **Chips/Badges:** Small, pill-like elements with a 12px font size and light grayscale backgrounds. They use a border that is one shade darker than their background fill.
- **Lists:** Rows are separated by 1px horizontal dividers. Hover states for list items should trigger a subtle background color change to indicate interactivity.
- **Cards:** Defined by a 1px border and 8px corners. Headers within cards should be separated by a 1px horizontal stroke.
- **Code Blocks:** Use a dark background in both light and dark modes to maintain the "terminal" feel, paired with a monospace font and syntax highlighting using a muted color palette.
- **Checkboxes & Radios:** Sharp, 1px bordered boxes/circles that fill with the primary blue color when selected, maintaining the 8px corner logic where possible (checkboxes).