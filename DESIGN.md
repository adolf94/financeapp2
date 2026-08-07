---
name: Personal Finance App
description: A clean, operate-focused financial tracking application.
colors:
  primary: "#6366f1"
  primary-deep: "#4f46e5"
  neutral-bg: "#f8fafc"
  neutral-text: "#0f172a"
  success: "#10b981"
  danger: "#f43f5e"
  journal: "#9333ea"
  transfer: "#3b82f6"
typography:
  display:
    fontFamily: "Inter, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
  body:
    fontFamily: "Inter, sans-serif"
    fontSize: "14px"
    fontWeight: 400
rounded:
  sm: "4px"
  md: "8px"
  full: "9999px"
spacing:
  sm: "8px"
  md: "16px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  card:
    backgroundColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "16px"
---

# Design System: Personal Finance App

## Overview

**Creative North Star: "The Crisp Ledger"**

A functional, operate-centric design focused on clarity and data legibility. Density is moderate, preferring whitespace to separate information over heavy borders. The UI uses the standard Tailwind Slate palette for structure, allowing semantic colors (Emerald for income, Rose for expense, Blue for transfers, Purple for journals) to stand out clearly.

**Key Characteristics:**
- Utilitarian and legible.
- High contrast for data points.
- Semantic color coding for transaction types.
- Mobile-first layouts with bottom navigation.

## Colors

A clean Slate foundation with bright, unambiguous semantic accents.

### Primary
- **Indigo Accent** (#6366f1): Used sparingly for primary actions, active states, and linking badges.

### Semantic
- **Emerald Income** (#10b981): Incoming funds and positive balances.
- **Rose Expense** (#f43f5e): Outgoing funds and negative balances.
- **Blue Transfer** (#3b82f6): Internal movement of money.
- **Purple Journal** (#9333ea): Journal entries and splits.

### Neutral
- **Slate Canvas** (#f8fafc): Page backgrounds.
- **Slate Ink** (#0f172a): Primary text.
- **Slate Subdued** (#94a3b8): Secondary text, timestamps, and icons.

## Typography

**Display Font:** Inter (with sans-serif)
**Body Font:** Inter (with sans-serif)

**Character:** Neutral, legible, and optimized for data density.

### Hierarchy
- **Headline** (600, 1.25rem, 1.2): Section titles and totals.
- **Body** (400, 14px, 1.5): Standard data and lists.
- **Label** (600, 0.75rem, normal): Small uppercase labels, taxonomy badges.

## Layout

A mobile-optimized single-column layout prioritizing vertical scrolling. Elements use a standard 4px/8px rhythm.

## Elevation & Depth

Mostly flat with tonal layering rather than heavy shadows.

### Shadow Vocabulary
- **Ambient Low** (`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)`): For cards and interactive elements at rest.

## Shapes

Soft but precise geometry.

- **Standard Radius:** 8px for cards and buttons.
- **Pills:** Fully rounded for badges and avatars.

## Components

### Buttons
- **Shape:** 8px radius.
- **Primary:** Indigo background, white text.
- **Secondary:** Slate background or outline for lower-priority actions.

### Cards
- **Corner Style:** 8px radius.
- **Background:** White (light mode) or Slate-800 (dark mode).
- **Shadow Strategy:** Ambient low.

### Badges / Chips
- **Style:** Tonal background (10-20% opacity of the accent color) with full saturation text.

## Do's and Don'ts

### Do:
- **Do** consistently color-code transaction types.
- **Do** align numerical values to the right where possible for easy scanning.

### Don't:
- **Don't** use decorative emojis in the UI.
- **Don't** use heavy shadows for structure.
