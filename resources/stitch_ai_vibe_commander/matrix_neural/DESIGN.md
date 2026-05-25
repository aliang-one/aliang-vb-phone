---
name: Matrix-Neural
colors:
  surface: '#0c160a'
  surface-dim: '#0c160a'
  surface-bright: '#313c2e'
  surface-container-lowest: '#071106'
  surface-container-low: '#141e12'
  surface-container: '#182216'
  surface-container-high: '#222d20'
  surface-container-highest: '#2d382a'
  on-surface: '#dae6d2'
  on-surface-variant: '#b9ccb2'
  inverse-surface: '#dae6d2'
  inverse-on-surface: '#283326'
  outline: '#84967e'
  outline-variant: '#3b4b37'
  surface-tint: '#00e639'
  primary: '#ebffe2'
  on-primary: '#003907'
  primary-container: '#00ff41'
  on-primary-container: '#007117'
  inverse-primary: '#006e16'
  secondary: '#4edea3'
  on-secondary: '#003824'
  secondary-container: '#00a572'
  on-secondary-container: '#00311f'
  tertiary: '#fff8f4'
  on-tertiary: '#442b10'
  tertiary-container: '#ffd5ae'
  on-tertiary-container: '#7a5b3c'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#72ff70'
  primary-fixed-dim: '#00e639'
  on-primary-fixed: '#002203'
  on-primary-fixed-variant: '#00530e'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#ffdcbd'
  tertiary-fixed-dim: '#e7bf99'
  on-tertiary-fixed: '#2c1701'
  on-tertiary-fixed-variant: '#5d4124'
  background: '#0c160a'
  on-background: '#dae6d2'
  surface-variant: '#2d382a'
typography:
  display:
    fontFamily: Space Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.1em
  data-mono:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '450'
    lineHeight: '1.5'
  terminal-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.4'
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 16px
  margin: 24px
  container-max: 1440px
  section-gap: 48px
---

## Brand & Style

This design system is built upon a digital-first, futuristic aesthetic that prioritizes high-density information architecture with surgical precision. The brand personality is professional, sophisticated, and cold—evoking the feeling of a high-end terminal interface or a neural uplink. 

The visual style blends **Minimalism** with **Glassmorphism** and **Brutalism**. It utilizes a "Dark-Mode-Only" philosophy to maintain the digital void aesthetic. Key characteristics include:
- **Data-Rich Minimalims:** Reducing visual noise while maximizing data throughput.
- **Atmospheric Depth:** Using subtle grid patterns and glow effects to simulate a three-dimensional digital space.
- **High-Tech Sophistication:** Moving away from "sci-fi tropes" toward a modern, high-performance computing interface.

## Colors

The palette is anchored in a monochromatic "void" to ensure the vibrant accents command absolute attention. 

- **The Void:** Pure Black (#050505) serves as the base layer, with Deep Charcoal (#0A0A0A) used for structural surfaces and containers.
- **The Neural Accents:** 'Matrix Green' (#00FF41) is the primary interactive color, used for high-priority calls to action and active states. 'Digital Emerald' (#10B981) provides a secondary, slightly more grounded green for status indicators and success states.
- **Grayscale:** UI borders and inactive elements use low-luminance grays to prevent light bleed, ensuring the "glow" of active elements remains impactful.

## Typography

This design system utilizes a dual-font strategy to separate UI navigation from technical data interpretation.

1.  **System Sans (Inter):** Used for all UI labels, navigation menus, and body copy. It provides the necessary readability and professional polish for standard interactions.
2.  **Neural Mono (JetBrains Mono):** Reserved for technical readouts, timestamps, logs, and any "machine-generated" content. This font should be used sparingly for effect, creating a clear visual distinction between user-facing text and raw system data.
3.  **Display (Space Grotesk):** For large headers and dashboard titles, providing a geometric, tech-focused edge.

## Layout & Spacing

The layout follows a **Fixed-Fluid Hybrid Grid**. Content is housed within a 12-column grid system with 16px gutters. To maintain the "precise" tone, a strict 4px base unit is used for all internal component spacing (padding/margins).

- **Grid Background:** A subtle 24px x 24px grid pattern (#FFFFFF, 2% opacity) should be overlaid on the background to provide a sense of alignment and digital structure.
- **Information Density:** Use generous whitespace between major sections to prevent visual fatigue, but allow for high-density layouts within data tables and terminal components.
- **Alignment:** All elements must align to the grid; avoid centered layouts unless for specific authentication or empty-state views. Left-alignment is preferred for professional precision.

## Elevation & Depth

Depth is conveyed through **Glassmorphism** and **Luminance**, rather than traditional shadows.

- **Surface Tiers:** Surfaces "rise" by becoming lighter and more transparent. A base container is #0A0A0A, while a floating modal uses a semi-transparent blur effect.
- **Glassmorphism:** Use a `backdrop-filter: blur(12px)` and a background color of `rgba(10, 10, 10, 0.7)`. 
- **Active Glow:** Active or focused elements (like a selected button or input) utilize a `box-shadow` of `0 0 15px rgba(0, 255, 65, 0.3)`. This "digital glow" replaces traditional depth, making active elements feel powered-on.
- **Borders:** Use 1px solid borders for all containers. Inactive borders are #1A1A1A; active borders use the Primary Green.

## Shapes

The design system uses a **Semi-Sharp** aesthetic. The base border radius is 2px for small components (checkboxes, tags) and 4px for larger components (cards, modals). 

This slight rounding prevents the UI from feeling overly aggressive (pure 0px) while maintaining the precise, engineered look required for a high-tech interface. Avoid large pill shapes or circular buttons entirely; even icons should sit within square-ish containers.

## Components

- **Buttons:** Sharp corners (2px). Primary buttons feature a solid #00FF41 background with black text. Secondary buttons use a ghost style: 1px #1A1A1A border that glows green on hover.
- **Input Fields:** Underline-style or full-border with a 2px radius. Placeholders should use the Monospace font to suggest a command-line input.
- **Cards:** Use the glassmorphism treatment. Background: `rgba(10, 10, 10, 0.8)`, Border: 1px #1A1A1A, Backdrop-filter: 12px blur.
- **Data Tables:** No vertical borders. Use thin horizontal dividers. Header cells should use `label-caps` typography in primary green.
- **Terminal Logs:** A dedicated container with a pure black background (#000000), utilizing `terminal-sm` monospace text in Green or Gray.
- **Status Indicators:** Small 6px squares (not circles) using Primary Green for active/online and #333333 for offline.
- **Progress Bars:** Thin 2px lines. The progress fill should have a slight outer glow to simulate a light-pipe.