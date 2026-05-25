---
name: Cyber-Logic
colors:
  surface: '#111417'
  surface-dim: '#111417'
  surface-bright: '#37393d'
  surface-container-lowest: '#0b0e11'
  surface-container-low: '#191c1f'
  surface-container: '#1d2023'
  surface-container-high: '#272a2e'
  surface-container-highest: '#323538'
  on-surface: '#e1e2e7'
  on-surface-variant: '#bbc9cf'
  inverse-surface: '#e1e2e7'
  inverse-on-surface: '#2e3134'
  outline: '#859399'
  outline-variant: '#3c494e'
  surface-tint: '#4cd6ff'
  primary: '#a4e6ff'
  on-primary: '#003543'
  primary-container: '#00d1ff'
  on-primary-container: '#00566a'
  inverse-primary: '#00677f'
  secondary: '#d7ffc5'
  on-secondary: '#053900'
  secondary-container: '#2ff801'
  on-secondary-container: '#0f6d00'
  tertiary: '#ffd59c'
  on-tertiary: '#442b00'
  tertiary-container: '#feb127'
  on-tertiary-container: '#6b4700'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#b7eaff'
  primary-fixed-dim: '#4cd6ff'
  on-primary-fixed: '#001f28'
  on-primary-fixed-variant: '#004e60'
  secondary-fixed: '#79ff5b'
  secondary-fixed-dim: '#2ae500'
  on-secondary-fixed: '#022100'
  on-secondary-fixed-variant: '#095300'
  tertiary-fixed: '#ffddb1'
  tertiary-fixed-dim: '#ffba49'
  on-tertiary-fixed: '#291800'
  on-tertiary-fixed-variant: '#624000'
  background: '#111417'
  on-background: '#e1e2e7'
  surface-variant: '#323538'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 34px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: -0.01em
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-caps:
    fontFamily: Space Grotesk
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 12px
  margin: 16px
  stack-sm: 8px
  stack-md: 16px
  density-compact: 4px 8px
---

## Brand & Style

The design system is engineered for the modern developer and technical project manager. It embodies a **Geek-Chic** aesthetic that balances professional rigor with high-tech futurism. The personality is intelligent, fast, and uncompromisingly functional, evoking the feeling of a sophisticated command center rather than a standard consumer app.

The primary visual style is **Glassmorphism**, utilized to create a sense of depth and data-layering. This is paired with high-density information layouts to ensure that power users have maximum visibility into complex project architectures at a glance. Every interface element should feel like a piece of precision instrumentation—utilitarian, responsive, and intellectually stimulating.

## Colors

The palette is optimized for long-duration focus and high legibility. 

- **Primary Backgrounds**: Deep Charcoal (#0B0E11) and Obsidian (#121212) form the foundation, providing a low-strain environment for eyes accustomed to dark-mode IDEs.
- **Electric Blue (#00D1FF)**: Used exclusively for primary calls-to-action, active states, and navigation highlights. It represents the "AI" or the "intelligence" of the system.
- **Neon Green (#39FF14)**: Reserved for terminal outputs, status indicators (e.g., "Deployed", "Completed"), and code logic tokens.
- **Glass Surfaces**: Transparent overlays are generated using white or primary color at 4%–10% opacity, allowing background elements to softly bleed through via backdrop-blur filters (12px–20px).

## Typography

The typography strategy employs a dual-font approach to differentiate between interface management and technical data. 

- **Inter** serves as the workhorse for the UI, providing exceptional clarity in high-density mobile views. 
- **Space Grotesk** is used for labels and secondary headings to inject a technical, futuristic flair. 
- **JetBrains Mono** (or a system fallback like SF Mono) is mandatory for all code snippets, task IDs, and terminal-style logs. 

Use tighter line-heights for body text to maintain the high-density layout, and utilize the `label-caps` style for metadata and category tags to maximize vertical space.

## Layout & Spacing

This design system uses a **Fluid Grid** model with a 4px baseline grid. On mobile, the system adheres to 16px side margins with 12px gutters. 

To achieve the "Geek-Chic" high-density look, padding within components is kept to a minimum (`density-compact`). Content should be organized in vertical stacks where the primary hierarchy is established through subtle 1px borders rather than wide gaps of whitespace. Elements like list items and cards should span the full width of the container minus margins to maximize horizontal real estate for technical strings and code.

## Elevation & Depth

Depth is communicated through **Glassmorphism** and tonal layering rather than traditional drop shadows.

- **Level 0 (Base)**: Obsidian (#0B0E11).
- **Level 1 (Cards/Lists)**: Obsidian (#121212) with a 1px solid border at 10% white opacity.
- **Level 2 (Overlays/Modals)**: Semi-transparent surfaces (rgba(255, 255, 255, 0.05)) with a 20px `backdrop-filter: blur()`.
- **Accent Elevation**: For active states, use a 1px border of Electric Blue (#00D1FF) with a soft outer glow (`box-shadow: 0 0 8px rgba(0, 209, 255, 0.3)`).

Avoid heavy shadows; visual separation must be achieved through contrast and hair-line borders.

## Shapes

The shape language is "Soft-Tech." While the data is rigid and logical, the containers use a moderate `rounded-md` (8px) to `rounded-lg` (12px) radius to ensure the mobile experience feels modern and ergonomic. 

Buttons and input fields should strictly adhere to the 8px radius. Small tags, chips, and status indicators may use a pill-shape (full radius) to distinguish them as interactive or volatile metadata.

## Components

- **Buttons**: Primary buttons are solid Electric Blue with JetBlack text. Secondary buttons are outlined with a 1px glass border.
- **Chips**: Small, compact labels with Mono-spaced text. Use Neon Green for "Success/Live" and Electric Blue for "Active/In-Progress".
- **Inputs**: Field backgrounds match the level 0 background but feature a 1px bottom border that glows Blue on focus. Use JetBrains Mono for placeholder text to signal "command-line" readiness.
- **Cards**: Minimal padding (12px). Use horizontal rules (1px, 8% white) to separate sections within a card.
- **Terminal Blocks**: Components specifically for code or AI logs. Background: Pure Black (#000000), Border: Neon Green (20% opacity), Text: Neon Green.
- **Progress Bars**: Thin (4px height), using a Neon Green fill with a faint Blue glow to indicate AI-assisted completion status.