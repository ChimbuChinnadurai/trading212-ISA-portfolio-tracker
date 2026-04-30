# Design System — Codex Scrapbook

**Register:** product  
**Theme:** Dual — warm paper (light) / dark paper (dark)

---

## Color Palette

### Light theme (default)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#f5f2eb` | Page background — warm cream |
| `--bg-card` | `#fffefc` | Card / panel surface |
| `--bg-sidebar` | `#ebe7dd` | Sidebar surface |
| `--bg-row-alt` | `#ebe7dd` | Table alternate row |
| `--bg-hover` | `#e2decb` | Hover state |
| `--border` | `#2a2a2a` | High-contrast ink border |
| `--border-bright` | `#000000` | Focus / emphasis border |
| `--accent` | `#7b61ff` | Primary accent — warm purple |
| `--accent-dim` | `#5a42e6` | Accent pressed / gradient start |
| `--accent-glow` | `rgba(123,97,255,.15)` | Glow / tinted bg |
| `--accent-secondary` | `#4d7cfe` | Blue semantic (buys, UK, links) |
| `--accent-tertiary` | `#f3a444` | Amber semantic (warnings, divs) |
| `--green` | `#2d8659` | Gain / positive |
| `--red` | `#c0392b` | Loss / negative |
| `--amber` | `#f3a444` | Warning |
| `--purple` | `#7b61ff` | Same as accent |
| `--teal` | `#4d7cfe` | Same as accent-secondary |
| `--text-primary` | `#2a2a2a` | Body text |
| `--text-secondary` | `#4a4a4a` | Secondary labels |
| `--text-muted` | `#7a7a7a` | Timestamps, metadata |

### Dark theme overrides

| Token | Value |
|---|---|
| `--bg` | `#1c1c1a` |
| `--bg-card` | `#262624` |
| `--bg-sidebar` | `#161614` |
| `--bg-row-alt` | `#161614` |
| `--bg-hover` | `#2a2a28` |
| `--border` | `#dcdcdc` |
| `--border-bright` | `#ffffff` |
| `--accent` | `#9d8aff` |
| `--accent-dim` | `#7b61ff` |
| `--accent-glow` | `rgba(157,138,255,.25)` |
| `--accent-secondary` | `#6f9fff` |
| `--accent-tertiary` | `#f5b356` |
| `--green` | `#3dcc78` |
| `--red` | `#ff5e57` |
| `--text-primary` | `#dcdcdc` |
| `--text-secondary` | `#a0a0a0` |
| `--text-muted` | `#888888` |

---

## Typography

| Role | Family | Size | Weight |
|---|---|---|---|
| Numbers / financial values | JetBrains Mono | inherit | 400–500 |
| Body / labels | Inter | 0.875rem | 400 |
| Headings / panel titles | Inter | 0.95rem–1.15rem | 700–800 |
| Decorative / scrapbook accents | PT Serif (italic) | vary | 400–700 |

---

## Shape & Spacing

- `--radius: 2px` — deliberately sharp, scrapbook feel  
- `--radius-sm: 1px`  
- Shadows: `4px 4px 0px` offset (flat, ink-stamp style)  
- Cards: `6px 6px 0px` offset shadow

---

## Semantic Color Map

| Signal | Light | Dark |
|---|---|---|
| Gain / buy | `#2d8659` / `var(--green)` | `#3dcc78` |
| Loss / sell | `#c0392b` / `var(--red)` | `#ff5e57` |
| Dividend / income | `var(--accent-tertiary)` amber | same (brighter) |
| UK equity (badge/bar) | `var(--accent-secondary)` | `var(--accent-secondary)` |
| FR equity | `#8b5cf6` purple | same |
| US equity | `#f43f5e` red | same |
| DE equity | `#eab308` yellow | same |
| Pre-market | `var(--accent-secondary)` | `var(--accent-secondary)` |
| Buy event | `var(--accent-secondary)` | `var(--accent-secondary)` |

---

## Anti-patterns (never)

- Cobalt blues `#0058be` / `#2170e4` — old theme remnant
- Navy backgrounds `#0f1629` / `#1e2d4a` — old theme remnant  
- `#000` or `#fff` unmodified  
- Gradient text (`background-clip: text`)  
- Side-stripe `border-left` accent cards  
- Glassmorphism as decoration
