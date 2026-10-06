---
name: MOZKAN
description: Simple web screen for operating event reservations through the MOZKAN API.
colors:
  page-bg: '#f3f5f8'
  surface: '#fff'
  text: '#243247'
  heading: '#1e3152'
  brand: '#263c63'
  action: '#315f9c'
  action-hover: '#284e82'
  secondary-text: '#53657b'
  muted: '#68788b'
  border: '#dce2ea'
  control-border: '#bbc7d5'
  focus: '#a7c4ed'
  info-bg: '#e8f0fb'
  info-text: '#294e80'
  error-bg: '#fbe9e9'
  error-text: '#9d2e36'
  success-bg: '#e7f5ec'
  success-text: '#24643c'
typography:
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: '16px'
    fontWeight: 400
    lineHeight: 1.45
  heading:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: 'clamp(1.9rem, 4vw, 2.7rem)'
    fontWeight: 700
    lineHeight: 1.15
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: '0.88rem'
    fontWeight: 650
    lineHeight: 1.45
rounded:
  xs: '3px'
  sm: '4px'
  md: '5px'
  lg: '8px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '12px'
  lg: '16px'
  xl: '20px'
  section: '18px'
  shell-top: '28px'
components:
  button-primary:
    backgroundColor: '{colors.action}'
    textColor: '{colors.surface}'
    rounded: '{rounded.md}'
    padding: '9px 13px'
  button-primary-hover:
    backgroundColor: '{colors.action-hover}'
    textColor: '{colors.surface}'
    rounded: '{rounded.md}'
    padding: '9px 13px'
  button-secondary:
    backgroundColor: '{colors.surface}'
    textColor: '#31527f'
    rounded: '{rounded.md}'
    padding: '9px 13px'
  card:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    rounded: '{rounded.lg}'
    padding: '20px'
  field:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
    rounded: '{rounded.md}'
    padding: '9px 10px'
---

# Design System: MOZKAN

## Overview

**Creative North Star: "The Practical Reservation Desk"**

MOZKAN is a compact, code-led operations screen. Its visual language keeps the reservation API easy to read: a pale neutral page, white bordered sections, dark text, and one restrained blue action color. The system uses familiar browser forms and tables so the interface stays functional and legible.

The layout gives authentication a short introductory panel, then moves the signed-in workspace through organization selection, available events, and personal reservations. Content stacks on small screens, while data tables retain their readable columns through horizontal scrolling.

**Key Characteristics:**

- Light neutral page background with white, lightly bordered cards.
- System UI typography with modest heading scale and compact labels.
- Blue primary actions, outlined secondary actions, and visible keyboard focus.
- Native forms, simple tables, inline status messages, and no decorative imagery.

## Colors

The palette is quiet and operational: cool neutrals carry structure, while blue marks actions and informational feedback.

### Primary

- **Restrained Action Blue** (`#315f9c`): Primary buttons and actionable controls.
- **Action Blue Hover** (`#284e82`): Darker hover state for primary buttons.

### Neutral

- **Pale Page** (`#f3f5f8`): Overall page background.
- **White Surface** (`#fff`): Header, cards, fields, and secondary buttons.
- **Deep Slate Text** (`#243247`): Default body and field text.
- **Navy Heading** (`#1e3152`): Main page headings.
- **Brand Navy** (`#263c63`): MOZKAN wordmark.
- **Cool Border** (`#dce2ea`): Header and card borders.
- **Control Border** (`#bbc7d5`): Inputs and compact controls.
- **Muted Slate** (`#68788b`): Supporting text and hints.

### Named Rules

**The One Accent Rule.** Use the restrained blue family for actions, links, and feedback while neutral surfaces carry most of the screen.

## Typography

**Display Font:** System UI (`system-ui, -apple-system, 'Segoe UI', sans-serif`)
**Body Font:** System UI (`system-ui, -apple-system, 'Segoe UI', sans-serif`)

**Character:** Familiar system typography keeps the small operational interface fast to scan. Headings are moderately sized, labels are compact and semibold, and table headings use uppercase with slight tracking.

### Hierarchy

- **Heading** (bold, `clamp(1.9rem, 4vw, 2.7rem)`, `1.15`): Intro and primary view headings.
- **Section title** (regular, `1.15rem`): Card and form headings.
- **Body** (regular, `16px`, `1.45`): Main interface copy and fields.
- **Label** (650, `0.88rem`, `1.45`): Form labels and organization controls.
- **Table label** (regular, `0.78rem`, uppercase, `0.04em` tracking): Column headings.

## Layout

The content shell is centered at a maximum width of `1050px`, with `20px` horizontal padding. The desktop shell uses `28px` top and `56px` bottom padding. Cards use `20px` internal padding and the recurring grid gap is `18px`.

Authentication and the event/member form groups use two equal columns. At `720px` and below, these grids become one column; the header, organization controls, and app heading also stack vertically. Mobile cards reduce their padding to `16px`, and the shell top padding becomes `20px`. Tables keep a `680px` minimum width inside an `overflow-x: auto` wrapper so their columns remain usable.

## Elevation & Depth

The interface is flat and uses tonal separation instead of shadows. White cards sit against the pale page background with a `1px` cool border; status panels use soft tinted backgrounds. No box-shadow is implemented.

## Shapes

The form language uses small, practical corners: cards use `8px`, buttons and fields use `5px`, pagination controls use `4px`, and inline code uses `3px`. Borders are one pixel and controls remain rectangular enough to preserve the code-led, utility feel.

## Components

### Buttons

- **Shape:** Small rounded corners (`5px`) with compact `9px 13px` padding and semibold system text.
- **Primary:** Restrained action blue with white text and matching border.
- **Hover / Focus:** Primary hover darkens to action blue hover; all buttons receive the shared `3px` light blue focus outline.
- **Secondary:** White fill, cool blue-gray border, and blue text; hover fills with a very pale blue-gray.
- **Disabled:** Reduced to `0.5` opacity with a not-allowed cursor.

### Cards / Containers

- **Corner Style:** Gently rounded (`8px`).
- **Background:** White surface against the pale page.
- **Shadow Strategy:** No shadows; depth comes from a one-pixel border and tonal contrast.
- **Border:** `1px` cool border.
- **Internal Padding:** `20px` desktop, `16px` on small screens.

### Inputs / Fields

- **Style:** Native input and select controls with white fill, `1px` control border, `5px` radius, and `9px 10px` padding.
- **Focus:** A `3px` light blue outline with `1px` offset, shared with buttons and links.
- **Behavior:** Native email, password, date-time, number, and select controls are used; disabled controls are dimmed.

### Navigation

- **Style:** A short white header with a bottom border, centered within the same `1050px` shell. The MOZKAN wordmark is bold navy with a muted descriptor; the API documentation link is blue.
- **Mobile:** Header contents stack under `720px`, with compact vertical padding.

### Tables

- **Style:** Simple collapsed tables with `10px 8px` cells and one-pixel row separators.
- **Responsive behavior:** A `680px` minimum table width is preserved inside a horizontal scrolling wrapper.

### Status Messages

- **Style:** Inline live-region messages use `5px` corners and `10px 12px` padding. Informational, error, and success states use pale blue, red, and green fills with corresponding dark text.

## Do's and Don'ts

### Do:

- **Do** keep the page light, white, and cool-neutral with blue reserved for action and feedback.
- **Do** use system UI typography and the observed compact spacing rhythm.
- **Do** preserve visible keyboard focus with the light blue `3px` outline.
- **Do** keep tables horizontally scrollable on narrow screens instead of collapsing their columns.
- **Do** make empty, loading, success, and error states understandable through text and status regions.

### Don't:

- **Don't** add decorative imagery, gradients, or shadows to this functional screen.
- **Don't** replace the native form controls with a visually heavy custom treatment.
- **Don't** introduce extra accent colors that compete with the restrained blue action color.
- **Don't** hide table content or force dense columns into an unreadable mobile layout.
