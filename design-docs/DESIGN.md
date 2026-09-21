---
name: Obsidian Telemetry
colors:
  surface: '#121318'
  surface-dim: '#121318'
  surface-bright: '#38393f'
  surface-container-lowest: '#0d0e13'
  surface-container-low: '#1a1b21'
  surface-container: '#1e1f25'
  surface-container-high: '#292a2f'
  surface-container-highest: '#34343a'
  on-surface: '#e3e1e9'
  on-surface-variant: '#c1cab0'
  inverse-surface: '#e3e1e9'
  inverse-on-surface: '#2f3036'
  outline: '#8b947c'
  outline-variant: '#424936'
  surface-tint: '#93da23'
  primary: '#cfff8f'
  on-primary: '#203600'
  primary-container: '#9fe833'
  on-primary-container: '#406500'
  inverse-primary: '#426900'
  secondary: '#c0c1ff'
  on-secondary: '#1000a9'
  secondary-container: '#3131c0'
  on-secondary-container: '#b0b2ff'
  tertiary: '#d6f5ff'
  on-tertiary: '#003640'
  tertiary-container: '#70e3ff'
  on-tertiary-container: '#006476'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#adf843'
  primary-fixed-dim: '#93da23'
  on-primary-fixed: '#112000'
  on-primary-fixed-variant: '#314f00'
  secondary-fixed: '#e1e0ff'
  secondary-fixed-dim: '#c0c1ff'
  on-secondary-fixed: '#07006c'
  on-secondary-fixed-variant: '#2f2ebe'
  tertiary-fixed: '#acedff'
  tertiary-fixed-dim: '#4cd7f6'
  on-tertiary-fixed: '#001f26'
  on-tertiary-fixed-variant: '#004e5c'
  background: '#121318'
  on-background: '#e3e1e9'
  surface-variant: '#34343a'
typography:
  display-hero:
    fontFamily: Geist
    fontSize: 58px
    fontWeight: '600'
    lineHeight: 60px
    letterSpacing: -0.04em
  display-hero-mobile:
    fontFamily: Geist
    fontSize: 36px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.035em
  headline-lg:
    fontFamily: Geist
    fontSize: 30px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.025em
  headline-lg-mobile:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: -0.02em
  title-sm:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 22px
    letterSpacing: -0.015em
  subtitle:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0em
  body-lg:
    fontFamily: Geist
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: 0em
  body-md:
    fontFamily: Geist
    fontSize: 13.5px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0em
  caption:
    fontFamily: Geist
    fontSize: 11.5px
    fontWeight: '400'
    lineHeight: 17px
    letterSpacing: 0em
  label-mono:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 12px
    letterSpacing: 0.1em
  code-block:
    fontFamily: JetBrains Mono
    fontSize: 12.5px
    fontWeight: '400'
    lineHeight: 23px
    letterSpacing: 0em
  metric-val:
    fontFamily: Geist
    fontSize: 30px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.03em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-tablet: 1.25rem
  gutter-desktop: 1.5rem
  margin: 1.25rem
  margin-tablet: 2rem
  margin-desktop: 3.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.25rem
---

## Brand & Style

This design system embodies the calculated precision, tactical clarity, and optical depth of mission-critical developer tooling. Designed for high-performance open-source documentation platforms, engineering consoles, and infrastructure landing pages, it treats the screen as an illuminated obsidian flight deck. The aesthetic draws inspiration from modern developer movements—merging the editorial restraint of Linear, the optical sharpness and hairline precision of Vercel, and the ambient, multi-chromatic glow fields of Stripe.

The design language moves away from flat synthetic blacks, deploying an authentically tiered obsidian-zinc continuum. Visual atmosphere is established through razor-sharp 1px hairline boundaries, deep structural glassmorphism, directional gradient glows (cyan, violet, and indigo), and an intentional, laser-focused electric lime accent reserved exclusively for primary interactive state paths. The interface instills a sense of rock-solid durability, craftsmanship, and high operational confidence without cognitive fatigue during extended terminal or reading sessions.

## Colors

The color palette is architected around five structural planes: foundational obsidian surfaces, high-contrast typography inks, high-energy interactive accents, atmospheric ambient glows, and strict semantic telemetry signals.

### Foundation & Surfaces
- **Deep Obsidian Canvas (`#0c0d12`)**: The foundational canvas beneath the entire layout; eliminates eye fatigue during protracted reading and operations.
- **Elevated Void (`#10131c`)**: Structural container fill for fixed sidebars, sticky header rails, and table wells.
- **Floating Surface (`#141724`)**: Overlay surfaces for command palettes (`⌘K`), modals, contextual menus, and floating toasts.
- **Card Panel Fill (`#171b29`)**: Resting background for cards, documentation containers, and modular interface units.
- **Sub-Card / Hover Fill (`#1d2233`)**: Active hover state fill for interactive rows, button troughs, code nests, and slider rails.
- **Hairline Border (`#262938`)**: Default 1px boundary dividing panels, sidebar edges, and document sections.
- **Elevated Rim (`#393e53`)**: High-contrast boundary for card hover states, focused inputs, and popover edges.

### Accent & Ambient Roles
- **Electric Lime (`#9fe833`)**: Primary brand pulse. Reserved strictly for primary action buttons, active navigation indicators, and verified system status.
- **Luminous Chartreuse (`#bbf451`)**: Active interactive hover tint and gradient termination for primary controls.
- **Accent Contrast Ink (`#121a05`)**: High-density olive-slate text for electric lime fills, ensuring an 11.2:1 contrast ratio.
- **Accent Soft Wash (`rgba(159, 232, 51, 0.13)`)**: Tint for active navigation pills and focused chips.
- **Ambient Radiant Glows**:
  - Indigo Drift (`#6366f1`): Atmospheric backlight for hero headers and section milestones.
  - Violet Mist (`#8b5cf6`): Secondary ambient depth behind documentation cards.
  - Cyan Aura (`#06b6d4`): Telemetry accents, syntax function highlights, and live metric shimmers.

### Ink & Contrast Hierarchy
- **Heading White (`#f6f7fb`)**: High-visibility white-zinc for page titles, headings, and active numeric values.
- **Body Zinc (`#c1c5d4`)**: Prose, documentation text, and console logs.
- **Subtle Slate (`#9da2b4`)**: Inactive navigation items, table headers, and breadcrumbs.
- **Meta Zinc Dim (`#878d9f`)**: Metric units, timestamps, monospace captions, and keyboard shortcuts (`kbd`).

### Semantic Status
Status signals report system states exclusively and never serve decorative purposes:
- **Emerald Success (`#24c297`)**: Healthy nodes, verified TLS, and copy confirmations. (Soft wash: `rgba(36, 194, 151, 0.14)`)
- **Amber Warning (`#fbb02d`)**: Degraded states, memory alerts, and caution callouts. (Soft wash: `rgba(251, 176, 45, 0.14)`)
- **Crimson Danger (`#f3453f`)**: Crashed processes, tick overloads, and destructive modals. (Soft wash: `rgba(243, 69, 63, 0.14)`)
- **Cobalt Info (`#5897fb`)**: Documentation tip callouts and operational updates. (Soft wash: `rgba(88, 151, 251, 0.14)`)

## Typography

The typography strategy leverages a clean dual-font structure: **Geist** handles human communication (marketing, navigation, headers, and documentation prose), while **JetBrains Mono** governs machine readouts, terminal buffers, syntax blocks, and telemetry metadata.

### Typographic Principles
- **Optical Tracking Compression**: As headlines scale upward, negative tracking tightens optical kerning (`-0.025em` to `-0.04em`), yielding the taut, high-impact aesthetic characteristic of leading developer portals.
- **Monospaced Eyebrows**: Section headers, uppercase label tags, table category names, and badge items enforce uppercase transforms paired with extended tracking (`+0.06em` to `+0.10em`).
- **Tabular Figures (`tnum`)**: All counters, tick rates, clock values, and performance indicators utilize `font-variant-numeric: tabular-nums` to ensure zero layout shift during real-time updates.
- **Code Block Line Rhythm**: Monospace documentation snippets apply an open line-height of `1.84` (`23px` on `12.5px` text), leaving ample vertical clearance for syntax readability and inline highlighting badges.

## Layout & Spacing

The layout model pairs a responsive CSS Grid with a three-column documentation architecture built on an immutable 4px base increment (8px baseline).

### Documentation Channel Architecture
- **Left Navigation Rail**: Fixed `252px` width (`bg-void`), housing the hierarchical documentation tree, version selectors, and the search command trigger.
- **Center Editorial Reading Column**: Fluid layout with an enforced ceiling of `840px` and inline padding of `2rem` to `2.75rem` (`space-xl`), ensuring optimal typographic line lengths (65–75 characters per line).
- **Right Table-of-Contents Rail**: Sticky `220px` column tracking on-page anchor links, section hierarchies, and interactive "Edit on GitHub" triggers.
- **Landing Canvas**: Centered container capped at `1200px` for landing marketing tiers; up to `1560px` for expanded telemetry dashboards.

### Breakpoints & Responsive Behavior
- **Mobile (< 640px)**: The left navigation moves into an off-canvas drawer controlled by a glass-morphic header or a 5-item pinned bottom bar. The right table-of-contents hides. Margins compress to `1.25rem` (`margin`). Grid blocks stack into a single column.
- **Tablet (640px – 1023px)**: Left navigation compresses into a 68px icon rail or persistent off-canvas menu; reading content takes priority; table of contents collapses into a top dropdown. Cards adopt a 2-column grid with a `1.25rem` (`gutter-tablet`) gap.
- **Desktop (≥ 1024px)**: Full three-column layout engages with a `1.5rem` (`gutter-desktop`) channel separation and `3.5rem` outer canvas padding.

## Elevation & Depth

Visual hierarchy does not rely on heavy drop shadows. Depth is achieved via five calibrated zinc surface tiers, 1px low-contrast hairline outlines, and radiant ambient backlights.

### Surface Tiers
- **Tier 0 (Base Ground)**: `#0c0d12` (pure canvas plane).
- **Tier 1 (Structural Void)**: `#10131c` with 1px `#262938` borders (sidebars, sticky header rails).
- **Tier 2 (Card Surface)**: `#171b29` bounded by 1px `#262938` (documentation widgets, code blocks, metrics cards).
- **Tier 3 (Hover / Sub-surface)**: `#1d2233` with 1px `#393e53` rim.
- **Tier 4 (Floating Overlay)**: `#141724` with 1px `#393e53` outline, layered over a 70% dark mask with `backdrop-blur: 16px` and `backdrop-saturate: 150%`.

### Shadows & Radiant Glows
- **Ambient Shadow 1 (Resting Cards)**: `0 1px 2px rgba(2, 4, 10, 0.5)` - subtle anchoring boundary.
- **Ambient Shadow 2 (Hover Elevation)**: `0 4px 16px -4px rgba(2, 4, 10, 0.65)` with a `-2px` Y-axis lift.
- **Ambient Shadow 3 (Command Palette / Dialogs)**: `0 24px 60px -12px rgba(2, 4, 10, 0.85)`.
- **Primary Glow**: `0 8px 22px -12px rgba(159, 232, 51, 0.35)` applied directly under electric lime primary actions.
- **Atmospheric Backlights**: Radial gradients (`radial-gradient(ellipse at top, rgba(99, 102, 241, 0.15), transparent 70%)`) positioned behind hero headlines and feature groupings to produce modern ambient lighting without muddying dark-mode legibility.

## Shapes

The design system maintains a balanced geometry calibrated to level 2 (`roundedness: 2`). Radii scale systematically according to element surface area:

- **6px (`rounded-sm`)**: Nested chips, keyboard shortcuts (`kbd`), sub-tabs, and inner copy badges.
- **9px (`rounded-md`)**: Interactive inputs, standard buttons, dropdown menu surfaces, and search triggers.
- **12px (`rounded-lg`)**: Callout containers, code snippet canvases, and secondary cards.
- **16px (`rounded-xl`)**: Primary dashboard panels, landing feature cards, and command palette shells.
- **Full (`rounded-full`)**: Status indicator pills, telemetry dots, and category avatar badges.

## Components

### Buttons
- **Primary CTA**: Solid Electric Lime background (`#9fe833`), dark olive contrast text (`#121a05`), semi-bold weight, `9px` radius, and ambient lime drop shadow. On hover, brightness increases by 10%; on active press, scales to `0.985`.
- **Secondary**: Surface card background (`#171b29`), 1px hairline border (`#262938`), and zinc text (`#c1c5d4`). On hover, border elevates to `#393e53` and text brightens to `#f6f7fb`.
- **Ghost**: Transparent fill, muted text (`#9da2b4`), zero border. On hover, transitions to `#1d2233` fill and `#f6f7fb` text.
- **Destructive**: Never a solid red slab. Constructed with an outlined treatment: `1px solid rgba(243, 69, 63, 0.30)`, background tint `rgba(243, 69, 63, 0.14)`, and crimson text (`#f3453f`).

### Documentation Code Snippets
- **Container**: Deep console well background (`#0e1017`) bounded by a 1px border (`#262938`) with `12px` rounded corners.
- **Header Bar**: Fixed 36px height, background `#10131c`, border-bottom 1px `#262938`. Left side holds the filename or language in uppercase JetBrains Mono (`10px`, `#878d9f`); right side houses the interactive copy button.
- **Copy Badge**: Micro-chip with copy icon. Upon interaction, transitions to Emerald Success (`#24c297`) with a checkmark for 1500ms before returning to resting state.
- **Code Area**: JetBrains Mono at `12.5px` with syntax highlighting using designated token roles: comments (`#878d9f`), keywords (`#8b5cf6`), strings (`#9fe833`), and methods/functions (`#06b6d4`).

### Interactive Callout Boxes
Callouts feature a `3px` solid accent left rail, `10px` rounded corners, soft background tint, and a monospaced status indicator:
- **Tip**: Emerald soft tint (`rgba(36, 194, 151, 0.14)`), left border `#24c297`.
- **Info**: Cobalt soft tint (`rgba(88, 151, 251, 0.14)`), left border `#5897fb`.
- **Warning**: Amber soft tint (`rgba(251, 176, 45, 0.14)`), left border `#fbb02d`.
- **Danger**: Crimson soft tint (`rgba(243, 69, 63, 0.14)`), left border `#f3453f`.

### Command Palette (`⌘K`)
- **Trigger**: Embedded search button within header and sidebar (`#10131c` fill, 1px border `#262938`, text `#878d9f`). Contains a search glyph, *"Search docs or jump to..."*, and a native `<kbd>` tag (`border #262938`, `bg #1d2233`, text `10px`).
- **Modal View**: 640px wide overlay, surface fill `#141724`, 1px border `#393e53`, drop shadow 3. Search field provides instant input with an electric lime selection reticle. Search results are grouped with monospace category eyebrows and navigable via arrow keys.

### Form Inputs & Checkboxes
- **Text Inputs**: Background `#10131c`, border 1px `#262938`, `9px` radius, text `#f6f7fb`, placeholder text `#878d9f`. Focus state displays an electric lime focus ring with 2px offset.
- **Checkboxes & Radios**: Custom 18px boxes with hairline borders (`#393e53`). Checked state renders a solid electric lime fill (`#9fe833`) with dark olive checkmark icon (`#121a05`).
- **Toggle Switches**: 36x20px rounded pill track (`#1d2233`). Active state shifts track to `#9fe833` and moves the 14px white circle across an 180ms ease curve.

### Chips, Pills & Badges
- **Status Pills**: Rounded-full pill (`rounded-full px-2.5 py-1 text-[10.5px] border`) containing a 5px telemetry dot. Active and running processes show a steady green dot; connecting or stopping states engage a 2.2s ease-out opacity pulse.