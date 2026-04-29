---
name: Portfolio Tracker
description: A dual-theme financial portfolio tracker built for clarity under pressure.
colors:
  cobalt-execution: "#0058be"
  cobalt-signal: "#2170e4"
  signal-blue: "#3b82f6"
  signal-blue-deep: "#1d4ed8"
  emerald-uptick: "#10b981"
  loss-crimson: "#9c3c3e"
  alert-rose: "#f43f5e"
  alert-amber: "#f59e0b"
  secondary-violet: "#8b5cf6"
  teal-readout: "#06b6d4"
  worksheet-white: "#f7f9fb"
  paper-white: "#ffffff"
  ruled-line: "#f2f4f6"
  active-row-light: "#eceef0"
  grid-line: "#c2c6d6"
  grid-line-bright: "#727785"
  ink: "#191c1e"
  slate: "#424754"
  ghost-type: "#727785"
  midnight-navy: "#080d18"
  deep-hull: "#0f1629"
  deck-plate: "#131d35"
  active-row-dark: "#1a2846"
  keel-black: "#0b1120"
  console-hairline: "#1e2d4a"
  console-border-bright: "#2a3f6a"
  terminal-white: "#e2e8f0"
  console-label: "#7c8fad"
  dimmed-readout: "#cbd5e1"
typography:
  display:
    fontFamily: "'JetBrains Mono', monospace"
    fontSize: "2rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif"
    fontSize: "1.15rem"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 700
    letterSpacing: "0.06em"
rounded:
  pill: "99px"
  md: "12px"
  sm: "8px"
  icon: "9px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.cobalt-execution}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "7px 16px"
  button-primary-hover:
    backgroundColor: "{colors.cobalt-signal}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "7px 16px"
  button-ghost:
    backgroundColor: "{colors.ruled-line}"
    textColor: "{colors.slate}"
    rounded: "{rounded.sm}"
    padding: "0px"
    width: "34px"
    height: "34px"
  button-ghost-hover:
    backgroundColor: "{colors.active-row-light}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0px"
    width: "34px"
    height: "34px"
  card:
    backgroundColor: "{colors.paper-white}"
    rounded: "{rounded.md}"
    padding: "22px 24px 18px"
---

# Design System: Portfolio Tracker

## 1. Overview

**Creative North Star: "The Trading Floor Terminal"**

Dense, precise, data-forward. This is the interface of someone who acts on information rather than admires it. Every element earns its place not by aesthetic appeal but by functional necessity: the font choices, the color decisions, the shadow vocabulary are all calibrated to one end — getting you to the right number, in the right context, in the fewest possible eye movements.

The system runs two fully equal themes. Light mode is the clean daytime session — a cool worksheet white backdrop where data sits against pure paper, numbers rendered in near-black ink. Dark mode is the late-session, second-screen presence — a deep midnight navy constellation lit by cobalt signal blues, where financial values glow like readouts on a console. Neither is a courtesy toggle; both are first-class, with independently tuned accent values and shadow vocabularies.

This system refuses the gamification vocabulary of consumer finance apps. No rainbow gradients, no celebration confetti, no "you're up 3% today — keep it up!" copy. Gains and losses are facts, not emotions. The interface has no opinion about your portfolio.

**Key Characteristics:**
- Dual-role typography: Inter for UI structure, JetBrains Mono strictly for financial values and tabular data
- Two equal themes: cool worksheet light and deep-navy dark, each independently tuned
- Restrained color strategy with one execution accent (cobalt) and three semantic signal colors (green/red/amber)
- Precise diffuse shadows in light; deep contrast shadows in dark — no decorative blur
- Controls feel like switches on a panel, not decorative affordances

## 2. Colors: The Cobalt Signal Palette

The palette is built around one primary execution accent (cobalt blue) and three functional signals (emerald uptick, loss crimson/rose, alert amber). All remaining color comes from two complete neutral scales — one light, one dark — that swap on theme change. Color is information here, not decoration.

### Primary
- **Cobalt Execution Blue** (`#0058be`): The primary action color in light mode. Used on CTA buttons (as a 135° gradient with Cobalt Signal), active toggle states, active nav indicators, and accent glows. Carries authority — not friendliness.
- **Cobalt Signal Blue** (`#2170e4`): The lighter end of the primary gradient. Appears as the gradient terminus on buttons and active currency chips. Never used solo.
- **Signal Blue** (`#3b82f6`): The dark-theme primary accent. Calibrated to read at appropriate contrast against midnight navy without the deep saturation of Cobalt Execution. Same role, recalibrated for the dark canvas.
- **Signal Blue Deep** (`#1d4ed8`): Dark-mode gradient terminus, mirrors the Cobalt Execution / Cobalt Signal relationship.

### Semantic
- **Emerald Uptick** (`#10b981`): Positive PnL, positive price movement, live market status. Used for `.pos` value coloring, status dots, and tick-flash backgrounds. Never decorative.
- **Loss Crimson** (`#9c3c3e`): Negative PnL and downward price ticks in light mode. Muted rather than alarming — losses are serious, not panic-inducing.
- **Alert Rose** (`#f43f5e`): Negative signal in dark mode. The vivid rose is required for contrast against midnight navy; the light mode's crimson would disappear.
- **Alert Amber** (`#f59e0b`): Secondary signal. Used for the FG portfolio identity, earnings/calendar markers, and the news widget's refresh arc.
- **Secondary Violet** (`#8b5cf6`): Tertiary portfolio identity and combined-portfolio marker. Appears in left-border identity strips and diagonal gradient tints only.
- **Teal Readout** (`#06b6d4`): Heatmap widget accent, used for the heatmap refresh clock arc exclusively.

### Neutral (Light Theme)
- **Worksheet White** (`#f7f9fb`): Page background. Slightly cool-tinted — never pure white.
- **Paper White** (`#ffffff`): Card and table surface. The one contrast step above the page.
- **Ruled Line** (`#f2f4f6`): Alternating table rows, sidebar background, button resting state.
- **Active Row Light** (`#eceef0`): Hover states on rows and neutral buttons.
- **Grid Line** (`#c2c6d6`): Default border on cards, inputs, and tables.
- **Grid Line Bright** (`#727785`): Elevated or active borders — on hover or focus.
- **Ink** (`#191c1e`): Primary text. Near-black with a trace blue tint.
- **Slate** (`#424754`): Secondary text — sub-labels, supporting values.
- **Ghost Type** (`#727785`): Muted labels, section headers, metadata.

### Neutral (Dark Theme)
- **Midnight Navy** (`#080d18`): Page background. Deep enough to be night, tinted enough to avoid void.
- **Deep Hull** (`#0f1629`): Card and table surface in dark mode.
- **Deck Plate** (`#131d35`): Alternating row tint in dark mode.
- **Active Row Dark** (`#1a2846`): Hover state on dark surfaces.
- **Keel Black** (`#0b1120`): Sidebar background — one step darker than the page.
- **Console Hairline** (`#1e2d4a`): Default border in dark mode.
- **Console Border Bright** (`#2a3f6a`): Elevated border on hover/focus in dark mode.
- **Terminal White** (`#e2e8f0`): Primary text in dark mode.
- **Console Label** (`#7c8fad`): Secondary text in dark mode.
- **Dimmed Readout** (`#cbd5e1`): Muted text in dark mode.

### Named Rules

**The Cobalt Only Rule.** One execution accent, used precisely. Cobalt appears on the primary CTA, active toggle pills, active nav items, and accent glows. It does not appear on decorative elements, chart fills unrelated to user action, or non-interactive status text.

**The Semantic Signals Rule.** Green, red, and amber are reserved for financial signal only: PnL direction, price movement, and market status. Never use them for decoration, general emphasis, or categorization by any axis other than financial performance. A green element that does not mean "positive" breaks the readout contract.

## 3. Typography

**Display Font:** JetBrains Mono (monospace fallback)
**Body Font:** Inter (system-ui, -apple-system, sans-serif fallback)

**Character:** A deliberate dual-role pairing. Inter handles all UI scaffolding — labels, headings, navigation, copy — with modern humanist warmth held tightly at small sizes. JetBrains Mono handles only what it was built for: tabular financial values that must align, tick-precisely, at any size. The separation is strict; they never compete.

### Hierarchy

- **Display** (JetBrains Mono, 800, 2rem, line-height 1.1, letter-spacing −0.03em): Large financial values — portfolio totals, P&L figures, percentage changes. The terminal's primary readout. Maximum compression.
- **Headline** (Inter, 800, 1.15rem, line-height 1.2, letter-spacing −0.02em): Brand identity and top-level section markers only. Used sparingly.
- **Title** (Inter, 700, 0.95rem, line-height 1.4): Panel headers, card section titles.
- **Body** (Inter, 400, 0.875rem, line-height 1.5): Base type for all prose, table cell text, and supporting content.
- **Label** (Inter, 700, 0.72rem, letter-spacing 0.06em, UPPERCASE): Section identifiers, card category labels, column headers. Always uppercase with tracked letter-spacing. The smallest visible type in the system.

### Named Rules

**The Mono Gate Rule.** JetBrains Mono is used only for financial values (currency amounts, percentages, ticker symbols) and code. Never use it for labels, headings, or prose. Never use Inter for financial values. The pairing is the design — do not collapse it.

## 4. Elevation

Flat by default with two distinct shadow vocabularies tuned per theme. Shadows communicate structure (card above page) and interactivity (hover state confirmation). Never decorative.

### Shadow Vocabulary

- **Light Ambient** (`0px 12px 32px rgba(25, 28, 30, .06)`): All cards and panels in light mode. Extremely diffuse and low-opacity — the card barely lifts off the page. Structural separation, not visual drama.
- **Light Hover Lift** (`0px 16px 40px rgba(25, 28, 30, .10)`): Card hover in light mode, paired with `translateY(-1px)`. Measured lift — confirms the element is interactive.
- **Dark Ambient** (`0 8px 32px rgba(0, 0, 0, .5)`): Full contrast shadow in dark mode. The dark backdrop requires higher opacity to read.
- **Dark Card** (`0 4px 20px rgba(0, 0, 0, .4)`): Panels and activity cards in dark mode — slightly more contained than ambient.
- **Accent Glow** (`0 2px 12px rgba(0, 88, 190, .12)` light / `rgba(59, 130, 246, .25)` dark): On primary buttons and active interactive elements only. A soft colored bloom, not a dramatic halo. Intensifies to `0 4px 20px` on hover.
- **Semantic Glow** (`0 4px 24px rgba(16, 185, 129, .12)` / `rgba(244, 63, 94, .12)`): Applied to the dynamic returns card based on current PnL direction. The card surface responds to the portfolio's state.

### Named Rules

**The Flat-By-Default Rule.** Shadows appear only to communicate structural depth (card above page) or interactive state (hover, focus). Never for decoration. If the element does not move or lift, it does not glow.

**The Theme-Calibrated Shadow Rule.** Never use light-mode shadow values in dark mode, or vice versa. The light shadow's `rgba(25,28,30,.06)` reads as zero on a midnight navy canvas. The dark shadow's `.5` opacity black is oppressive on white.

## 5. Components

### Buttons

Controls feel like switches on a console panel. They respond immediately, telegraph their state, and recede when not in use.

- **Shape:** Primary buttons use a full pill radius (99px). Secondary and ghost buttons use 8px radius. Icon buttons are 34×34px squares at 8px radius.
- **Primary:** Cobalt 135° gradient (Cobalt Execution `#0058be` → Cobalt Signal `#2170e4`), white text, `7px 16px` padding, accent glow shadow (`0 2px 12px`). On hover: `brightness(1.08)` filter + deeper glow (`0 4px 20px`) + `rgba(255,255,255,.15)` inset ring. In dark mode the gradient uses Signal Blue variants.
- **Ghost / Icon toggle:** `--bg-row-alt` background, no border in light, `1px solid var(--border)` in dark. Becomes `--bg-hover` on hover. Accent-colored text on the digest variant.
- **Success state:** Replaces accent gradient with green gradient (`#10b981 → #059669`) when a refresh action succeeds. Temporary state, not a persistent style.

### Currency / PID Toggle Pills

- **Container:** `99px` pill, `--bg-row-alt` background. Dark mode: `1px solid var(--border)`.
- **Inactive tab:** Transparent background, secondary text, small padding. Hover: `--bg-hover`.
- **Active tab:** Full cobalt gradient (mirrors primary button), white text, small accent glow. The active toggle is the same material as the primary button — smaller, same authority.

### Filter Pills

Discrete category selectors (time range, sector, allocation filters). Flat with a full `1px` border, neutral background. On hover: border shifts to `--border-bright`. Active: cobalt accent fill with white text. These are decisions, not decorations — treat them with the same weight as buttons.

### Summary Cards (s-card)

Primary data container. `22px 24px 18px` padding, `12px` radius, `1px` border (dark mode only), diffuse ambient shadow. On hover: `translateY(-1px)` + deeper shadow — the lift confirms interactivity.

Portfolio identity variants (`.s-card-blue`, `.s-card-teal`, etc.) add a `3px left border` in the portfolio's assigned color plus a diagonal gradient tint at 6% opacity. **This is a portfolio identity device only** — it identifies which portfolio a card belongs to. Do not generalize the left-border pattern to callouts, alerts, or emphasis.

The dynamic returns card (`s-card-dynamic`) gains a semantic glow (green or red at 12% opacity) based on current PnL direction. The card surface itself responds to the portfolio's state.

### Portfolio Overview Cards (ov-card)

Same architecture as summary cards. Each portfolio gets an assigned color: blue (portfolio 1), green (portfolio 2), violet (combined), amber (FG). Applied as a `3px` left border + 6% diagonal gradient. Dark mode swaps from the left-border+gradient pattern to a full gradient wash (`rgba(color, 0.08) → transparent`) with `backdrop-filter: blur(8px)`.

### Navigation (Sidebar)

Icon-only vertical rail, 40px brand area, icon nav items. No text labels visible — the sidebar is infrastructure. Active state: cobalt accent color on the icon. The sidebar recedes completely; the data surface takes the full canvas.

### Topbar

Sticky horizontal action bar. Dark mode: `rgba(8, 13, 24, 0.82)` frosted glass + `backdrop-filter: blur(16px)` + `1px` console hairline bottom border. Light mode: plain card white + diffuse shadow. Glass is a dark-mode tool in this system — on a white surface it would be noise. Disabled on mobile where `backdrop-filter` causes smear artifacts on semi-transparent cards beneath it.

### Status Dots / Live Indicators

6–7px circles. Live market open: Emerald Uptick with a matching box-shadow glow + `pulse` animation (2s opacity fade between 1 and 0.4). Closed/stale: ghost type color, no glow, no animation. The dot earns its animation only when the data is actually live.

### Price Tick Flash

Heatmap cells flash `rgba(16, 185, 129, 0.55)` for upticks and `rgba(244, 63, 94, 0.55)` for downticks — `0.6s ease-out`, no bounce, no hold. The flash is informational; it disappears completely, leaving the cell unchanged.

## 6. Do's and Don'ts

### Do:
- **Do** use JetBrains Mono for financial values, percentages, ticker symbols, and tabular numbers. Use Inter for everything else. The boundary is strict.
- **Do** apply the two-step hover pattern on cards: `translateY(-1px)` + deeper shadow. The lift is the confirmation of interactivity.
- **Do** design and test both light and dark themes. Neither is a fallback — they have independently tuned shadow depths and accent values.
- **Do** reserve semantic colors (green/red/amber) for financial signal only: PnL direction, price movement, market status.
- **Do** keep cobalt to interactive affordances: primary buttons, active toggle states, active nav indicators, accent glows.
- **Do** use the pill radius (99px) on primary CTAs and toggle pill containers. Use 8px on secondary and ghost controls.
- **Do** calibrate shadows per theme. The light ambient shadow is invisible on dark backgrounds; use the dark ambient value there.
- **Do** accompany a portfolio identity left border with its diagonal gradient tint — the strip without the gradient reads as a stripe, which is prohibited in all other contexts.

### Don't:
- **Don't** add rainbow gradients, neon glows, confetti, celebration states, or "you're up today!" styling. This tracks serious money. No Robinhood energy.
- **Don't** use gradient text (`background-clip: text` + gradient fill). Emphasis is weight and size, not color trickery.
- **Don't** generalize the left-border accent strip to callouts, alerts, list items, or any general emphasis context. The 3px colored left border is a multi-portfolio identity device, nothing else. Prohibited outside that specific use.
- **Don't** use semantic signal colors (green, red, amber) for non-financial categorization or decoration. A green element that doesn't mean "positive" breaks the readout.
- **Don't** apply `backdrop-filter` glass in light mode. Glass is purposeful only on the dark midnight canvas.
- **Don't** use JetBrains Mono for labels, headings, or prose. The mono gate is strict.
- **Don't** use bounce or elastic easing. Ease-out only (`all .15s`, `background .2s`, `box-shadow .2s`).
- **Don't** import the same shadow value into both themes. Each theme's shadow is calibrated for its surface.
- **Don't** design this to resemble a retail crypto app, a consumer fintech product, or a gamified trading platform. The interface has no opinion about your portfolio.
