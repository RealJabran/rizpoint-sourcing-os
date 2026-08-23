# RizPoint product experience

## Experience principles

RizPoint is a research operating system: calm, precise, evidence-led, and dense
enough for professional sourcing work. The interface uses a warm neutral canvas,
pine surfaces, teal actions, slate typography, restrained borders, and small
amounts of motion. Color never carries status alone.

Normal workflows use human labels rather than database identifiers. Technical
references remain available only where they are useful as evidence or support
context. Mock, live Amazon, stored Amazon, licensed provider, user input, and
derived values retain distinct labels.

## Information architecture

The navigation intentionally reduces equal-weight destinations:

- **Home** is the command center.
- **Sourcing** contains supplier scans, analysis, shortlists, and purchase
  orders.
- **Research** contains product research, Product Explorer, opportunities,
  categories, and keywords.
- **Intelligence** contains markets, brands, sellers, reviews, and adjacent
  evidence tools.
- **Projects** is the evidence-backed decision hub.
- **Monitoring** contains product and keyword tracking plus alerts.
- **Launch** contains listing, differentiation, economics, compliance, and
  planning workflows.
- **Settings** contains Amazon, provider, marketplace, cache, and system state.

Every route from the prior shell remains reachable. Groups remember their
expanded state locally and the sidebar can collapse without changing route
behavior.

## Design-system layers

The web design system is split by responsibility under
`apps/web/app/styles/`:

- `tokens.css`: typography, spacing, radii, surfaces, status colors, elevation,
  light/dark themes, and motion policy.
- `primitives.css`: controls, cards, badges, alerts, tabs, tooltips, skeletons,
  tables, drawers, toasts, and evidence freshness.
- `shell.css`: desktop sidebar, mobile drawer, top bar, command palette, and
  global controls.
- `workspaces.css`: dashboard and representative domain workspace layouts.
- `responsive.css`: deliberate 1440, 1280, 1024, 768, and 390-pixel behavior.

Reusable React primitives live in `apps/web/src/components/ui.tsx`. Lucide icons
provide a consistent accessible icon set; icons remain decorative when adjacent
text already names the action.

## Shared research-page contract

Major research routes use breadcrumbs, a clear title and description, primary
and secondary actions, bounded filters or saved views, summary metrics, a main
data surface, and visible source/freshness context. Tables use sticky headers,
aligned numeric cells, bounded horizontal scrolling, selection states, and
explicit loading, empty, error, partial, and provider-required states.

The product workspace renders only evidence families that are present. Missing
history and keyword intelligence are explained as provider requirements rather
than represented by empty charts or synthetic values.

## Responsive and theme behavior

Desktop remains primary. At tablet widths, controls wrap and dense surfaces
scroll within their own containers. Below 840 pixels, the sidebar becomes a
modal drawer with a scrim and the top bar prioritizes command/search, connection
state, and current action. At 390 pixels, cards, forms, tab strips, and action
rows stack without causing document-level horizontal overflow.

Dark mode is implemented through the same semantic tokens and remembered in
local storage. Motion honors `prefers-reduced-motion`.

## Visual acceptance

`tests/browser/visual-experience.spec.ts` captures desktop and mobile evidence
for Dashboard, Amazon Integrations, Wholesale Analysis, Product Explorer,
Product Detail, Research Project, Differentiation, and mobile navigation. The
test also rejects document-level horizontal overflow. These screenshots are a
review aid, not a pixel-lock: assertions continue to focus on usability and
accessible product structure.
