---
name: frontend-design
description: Improve and redesign existing frontend interfaces with a clean, restrained, cohesive and human-designed visual language. Use when creating, simplifying, or visually refining React/Tailwind screens and components, especially when the current UI feels generic, over-designed, inconsistent, or AI-generated.
compatibility: opencode
metadata:
  project: diabetic-retinopathy-system
  focus: ui-ux
---

# Frontend Design

## Purpose

Improve the visual quality of the existing frontend without turning the
application into a generic "AI-generated" interface.

The goal is to produce interfaces that feel:

- simple
- clear
- intentional
- consistent
- information-focused
- professional
- visually calm

Prioritize usability and visual hierarchy over decoration.

## When to Use This Skill

Use this skill when the user asks to:

- improve the visual appearance of a screen
- simplify a UI
- redesign a page or component
- improve spacing, typography, hierarchy, or layout
- make a screen feel more polished
- reduce a generic or AI-generated visual appearance
- make a form, dashboard, table, modal, or workflow easier to scan

Do not use this skill for backend changes, API changes, database work,
authentication logic, or purely functional bug fixes unless the task also
requires a visual change.

## First Rule: Inspect Before Designing

Before modifying a UI:

1. Inspect the existing page and its nearby components.
2. Inspect related screens to identify existing visual patterns.
3. Reuse existing components, styles, spacing conventions, and visual tokens
   whenever possible.
4. Identify what is causing the visual problem before changing it.
5. Avoid introducing a new visual language for a single screen.

Do not redesign blindly from the user's description.

The existing application should be treated as the starting design system.

## Design Direction

Favor a restrained interface suitable for a clinical decision-support system.

Prefer:

- clear hierarchy
- generous but purposeful spacing
- readable typography
- subtle borders
- restrained shadows
- consistent radii
- neutral surfaces
- limited accent colors
- strong alignment
- predictable interaction patterns
- compact but readable information density

Avoid decorative elements that do not improve comprehension.

The interface should feel like a professional clinical system, not a marketing
landing page or an AI product showcase.

## Avoid Generic AI UI Patterns

Do not add visual decoration simply to make a screen look "modern".

Avoid unnecessary use of:

- gradients
- glassmorphism
- excessive blur
- oversized headings
- excessive rounded cards
- excessive floating elements
- decorative badges
- excessive shadows
- random accent colors
- unnecessary icons
- excessive animations
- large empty hero sections
- card grids where a simpler layout is clearer

Do not turn every section into a separate card.

Use visual grouping only when it improves comprehension.

## Layout and Hierarchy

Prefer a clear visual hierarchy:

1. page purpose
2. primary information
3. primary action
4. supporting information
5. secondary actions

For information-heavy screens:

- align related fields
- group information logically
- avoid unnecessary nesting
- keep actions close to the content they affect
- preserve consistent spacing between sections
- avoid excessive visual fragmentation

For forms:

- keep labels visually connected to their inputs
- use clear grouping
- minimize unnecessary decorative containers
- make required actions obvious
- preserve a predictable reading order

For tables and clinical information:

- prioritize scanability
- preserve alignment
- distinguish headers from content clearly
- avoid excessive row decoration
- use color only when it communicates meaning

## Typography

Use a restrained typographic hierarchy.

Prefer:

- one primary font family already used by the project
- a small number of text sizes
- clear distinction between headings, labels, body text, and supporting text
- readable line height
- consistent font weights

Do not create a new typography system for a single screen.

## Color

Preserve the application's existing color language.

Use accent colors primarily for:

- primary actions
- important states
- selected elements
- meaningful status indicators

Do not introduce additional colors without a clear semantic reason.

Status colors must remain consistent throughout the application.

Do not rely on color alone to communicate important information.

## Components

Prefer composition from existing components over creating duplicates.

Before creating a new component:

1. Search for an existing equivalent.
2. Determine whether the existing component can be reused or extended.
3. Create a new component only when reuse would make the existing component
   less coherent.

Do not create visually different versions of the same component for individual
screens without a clear reason.

## Responsive Behavior

Every visual change must preserve reasonable behavior across:

- desktop
- tablet
- smaller screens

Do not solve a desktop layout problem by creating fixed-width elements that
break smaller screens.

Prefer flexible layouts using the project's existing responsive utilities.

## Accessibility

Maintain or improve accessibility.

Check:

- semantic HTML
- readable contrast
- visible focus states
- keyboard accessibility
- labels for form controls
- meaningful button text
- appropriate ARIA usage when needed

Do not remove accessible labels or states just to simplify the visual design.

## Interaction and Motion

Use motion sparingly.

Animations should communicate:

- state change
- transition
- feedback
- loading

Avoid decorative animation.

Do not add animation to every component simply because the interface feels
static.

## Implementation Rules

- Preserve the current frontend architecture.
- Preserve existing business logic.
- Do not modify API contracts for visual work.
- Do not introduce UI libraries or dependencies unless explicitly requested.
- Prefer existing utility classes and components.
- Keep changes local to the requested screen when possible.
- Avoid unrelated refactors.
- Preserve existing functionality while improving presentation.

## Before Finalizing

After implementing a visual change, verify:

- the page still behaves correctly
- spacing is consistent
- hierarchy is clear
- no unnecessary visual elements were introduced
- existing components remain visually coherent
- responsive behavior was not broken
- accessibility was not degraded

When useful, compare the modified screen with neighboring screens and adjust
the design so they feel like parts of the same application.

## Design Principle

The goal is not to make the interface look impressive.

The goal is to make the interface feel like it was deliberately designed by a
product designer who understands the workflow.

## Design Judgment

Separate implementation facts from design recommendations.

When identifying a visual or UX issue:

- describe the observable implementation fact first
- explain the usability or visual consequence
- treat design preferences as recommendations, not business or clinical rules
- do not infer clinical priority without evidence from the application workflow