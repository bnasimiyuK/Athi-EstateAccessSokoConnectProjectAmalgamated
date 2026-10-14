# Athi Soko Connect - Design System & Architecture

**Project:** Athi Highway Estate - Resident Service Directory
**Stack:** HTML + CSS + Vanilla JS (frontend) | Node.js + Express + SQL Server (backend)
**Author:** Beverly Kong'ani
**Course:** CSC429 Computer Project I
**Last updated:** October 2026

---

## 1. Purpose

Athi Soko Connect is a resident-to-resident service directory for Athi Highway Estate. It allows verified residents to list themselves as service providers (plumbers, cleaners, errand runners, tutors, etc.), and allows other residents to discover, contact and book them without relying on chaotic WhatsApp groups.

The system also provides estate admins with tools to approve listings, moderate content, manage billing, publish estate notices, and maintain a clean service taxonomy.

---

## 2. Design Philosophy

The visual language is built on three principles:

1. **Noticeboard, not SaaS.** The palette and typography evoke a physical estate noticeboard or a neighbourhood market - warm paper tones, dark ink text, and a single ochre accent that does the work of every call-to-action.
2. **Trust through structure.** Navy ink anchors the layout. Verification (teal) and alerts (clay) are the only other colours used, and each has a single meaning so residents learn the vocabulary quickly.
3. **Left-aligned, asymmetric, serif-led.** Display type (Fraunces) carries personality on hero headings and card titles; body type (Inter) stays quiet and functional everywhere else. Layouts lean left, not centred.

---

## 3. Colour Tokens

Defined once at `:root` in `css/styles.css`. Never hardcode hex values elsewhere.

| Token | Value | Purpose |
|---|---|---|
| `--ink` | `#16233f` | Primary text, primary buttons, active nav pill |
| `--ink-70` | `#4a5670` | Secondary text, muted labels |
| `--ink-40` | `#8791a3` | Tertiary text, hints, placeholders |
| `--paper` | `#fbfaf7` | Page background, card fills |
| `--paper-dim` | `#f0eee7` | Subtle surfaces, pill containers, table headers |
| `--line` | `#dcd8cd` | Borders, dividers, dashed separators |
| `--ochre` | `#c8862a` | The one accent - CTAs, active focus, notices |
| `--ochre-dark` | `#a86c1c` | Hover state for ochre elements |
| `--teal` | `#2f6f5e` | Verified, approved, success |
| `--teal-tint` | `#e3efe9` | Background for verified badges |
| `--clay` | `#b0472e` | Errors, destructive actions, low ratings |
| `--clay-tint` | `#f7e6e0` | Background for error badges |
| `--amber-tint` | `#f5ecd9` | Pending / warning backgrounds |

**Usage rule:** every colour carries exactly one meaning. Ochre = action. Teal = verified. Clay = danger. Never mix.

---

## 4. Typography

Two families, both loaded from Google Fonts.

- **Display - Fraunces** (serif). Used on `h1`, `h2`, `h3` and card titles. Weight 600-700. Optical sizing enabled (`opsz 9..144`).
- **Body - Inter** (sans). Used for UI, forms, tables, meta text. Weights 400-700.

### Type scale

| Element | Size | Weight | Family |
|---|---|---|---|
| `h1` | `clamp(2rem, 4vw, 2.9rem)` | 700 | Fraunces |
| `h2` | `1.6rem` | 600 | Fraunces |
| `h3` | `1.15rem` | 600 | Fraunces |
| Body | `1rem` | 400 | Inter |
| Labels | `0.85rem` | 600 | Inter |
| Meta / hints | `0.72-0.78rem` | 400-600 | Inter |
| Tiles (values) | `2.1rem` | 700 | Fraunces |

### Line height

- Headings: `1.1`
- Body: `1.5`
- UI text: `1.2`

---

## 5. Spacing & Radii

| Token | Value | Use |
|---|---|---|
| Gap small | `8px` | Inline button gaps, form rows |
| Gap medium | `16px` | Grid gaps, card padding inner |
| Gap large | `24-28px` | Section gaps, container padding |
| Gap extra | `40-48px` | Between major page sections |
| Radius S | `4px` | Buttons, badges |
| Radius M | `8px` | Cards, inputs |
| Radius L | `14-16px` | Tiles, dropdowns, hero stats |
| Radius pill | `999px` | Pills, status badges, filter chips |

---

## 6. Core Components

### Buttons

| Class | Purpose |
|---|---|
| `.btn--primary` | Dark navy - main CTA on light surfaces |
| `.btn--accent` | Ochre - vendor/approval actions |
| `.btn--ghost` | Outlined - secondary actions |
| `.btn--danger` | Clay outline - destructive actions |
| `.btn--small` | Compact size for tables and cards |

### Badges

| Class | Meaning |
|---|---|
| `.badge--verified` | Teal - approved residents/vendors |
| `.badge--pending` | Amber - awaiting review |
| `.badge--declined` | Clay - rejected |

### Cards & Tiles

- `.card` - provider cards on older layouts.
- `.dx-card` - Discover provider cards (rounded 16px, hover lifts 2px).
- `.admin-tile` - Dashboard stat tiles with left accent bar.
- `.dx-tile` - Discover category tiles with icon top-left, count top-right.

### Forms

- `.field` - standard label + input block.
- `.input-group` - Resident signup variant with icon prefix.
- Focus state: `outline: 2px solid var(--ochre)`.

### Modals

- `.modal-backdrop` - full-screen dim, `.is-open` to show.
- `.modal` - 440px max-width card, header + body + actions.
- Used for: Gate Rules, Reports, Compose Notice, Add/Edit Category.

### Toasts

- `.toast` - fixed bottom centre, ink background, fades in with `.toast--visible`.
- Fires on any successful or failed action across the app.

---

## 7. Page Layouts

### Header - canonical (all pages)

- Navy square logo (SVG inline, no external file).
- Pill container with `--paper-dim` background and 14px radius.
- Active pill: `--ink` background, white text.
- User chip only when logged in. `Log in` button only when logged out.
- Bell icon only when logged in.

### Discover page (`index.html`)
Hero: left copy + right stats] -> [Search bar] -> [Quick filters]
-> [Category tiles grid] -> [Provider results grid]

### Admin dashboard (`admin.html`)
[Hero with export buttons] -> [Users tiles] -> [Bookings tiles]
-> [Quality / Health / Engagement split] -> [Charts grid]
-> [Needs-attention alerts] -> [Work queue tabs]
### Notices page (`notices.html`)
[Hero with compose button] -> [Filter bar] -> [Notice list] -> [Pagination]

text

### Categories management (`admin-categories.html`)
[Heading + Add button] -> [Table: Icon / Label / Vendors / Actions]

text

---

## 8. Responsive Breakpoints

| Breakpoint | Behaviour |
|---|---|
| `> 900px` | Full desktop layout - nav pills inline, split cards side-by-side |
| `640-900px` | Nav wraps to a second row, cards stack, filters re-flow |
| `< 640px` | Everything single column, buttons full-width, tables scroll horizontally |

Mobile rule: the nav always remains visible (it never hides behind a hamburger - residents on phones still need quick access).

---

## 9. Role-Based Access Control

Three roles exist:

| Role | Permissions |
|---|---|
| **Resident** | Read all public content, submit bookings and reports, register as vendor |
| **Admin** | Approve/unverify residents and vendors, mark reports reviewed, manage house numbers, invoices, payments |
| **Super admin** | Everything Admin can do, plus: permanently delete vendors/residents, manage other admins, manage service categories |

### Enforcement

- **Backend** - `middleware/auth.js` exposes `requireAuth` and `requireRole(...)`. Routes use `requireRole("admin", "super")` for shared actions, `requireRole("super")` for delete/manage actions.
- **Frontend** - `getCurrentRole()` reads the JWT payload; UI hides buttons a user can't use. But the frontend only hides - the server always enforces.
- **JWT payload** carries `{ id, role, name }`. Role is signed and cannot be tampered with client-side.

---

## 10. Data Flow
Browser (HTML + JS)
|
| fetch() with Bearer token
v
Express API (localhost:4050)
|
| mssql connection pool
v
SQL Server - AthiSokoConnect

text

Every API call goes through `js/api.js` which:

- Attaches the JWT from `localStorage`.
- Parses JSON responses.
- Throws a uniform `Error(message)` with the server's `{ error }` field so every catch block in the frontend can show the same message style.

Key endpoints:

| Endpoint | Method | Who |
|---|---|---|
| `/api/providers` | GET | Public |
| `/api/providers` | POST | Any verified resident |
| `/api/providers/:id` | PATCH | Admin / super |
| `/api/providers/:id` | DELETE | Super only |
| `/api/residents` | GET | Public |
| `/api/residents/:id` | PATCH | Admin / super |
| `/api/residents/:id` | DELETE | Super only |
| `/api/announcements` | GET | Public |
| `/api/announcements` | POST | Admin / super |
| `/api/announcements/:id` | PATCH | Admin / super |
| `/api/announcements/:id` | DELETE | Admin / super |
| `/api/categories` | GET | Public |
| `/api/categories` | POST | Super only |
| `/api/categories/:id` | PATCH | Super only |
| `/api/categories/:id` | DELETE | Super only |
| `/api/admins` | any | Super only |

---

## 11. File Structure
Athi Soko Connect Project/
|-- backend/
| |-- server.js
| |-- db.js
| |-- middleware/
| | -- auth.js | |-- routes/ | | |-- auth.js | | |-- admin.js | | |-- admins.js | | |-- announcements.js | | |-- categories.js | | |-- providers.js | | |-- residents.js | | |-- reports.js | | |-- reviews.js | | |-- bookings.js | | |-- invoices.js | | |-- payments.js | | |-- house-numbers.js | |-- estate.js
| -- utils/ |-- mailer.js
|
|-- frontend/
| |-- index.html
| |-- register.html
| |-- residents.html
| |-- dashboard.html
| |-- provider.html
| |-- provider-dashboard.html
| |-- provider-profile.html
| |-- admin.html
| |-- admin-providers.html
| |-- admin-residents.html
| |-- admin-admins.html
| |-- admin-categories.html
| |-- admin-house-numbers.html
| |-- admin-invoices.html
| |-- admin-payments.html
| |-- admin-reviews.html
| |-- pending.html
| |-- notices.html
| |-- change-password.html
| |-- login.html
| |-- social-callback.html
| |-- css/
| | |-- styles.css
| | |-- register.css
| | |-- admin.css
| | -- notices.css |-- js/
| |-- auth.js
| |-- api.js
| |-- main.js
| |-- announcements.js
| |-- home.js
| |-- register.js
| |-- residents.js
| |-- dashboard.js
| |-- provider.js
| |-- notices.js
| |-- admin.js
| |-- admin-categories.js
| |-- admin-admins.js
| |-- admin-providers.js
| |-- admin-residents.js
| |-- admin-house-numbers.js
| |-- admin-invoices.js
| |-- admin-payments.js
| |-- admin-reviews.js
| |-- pending.js
| |-- login.js
| |-- social-auth.js
| -- social-callback.js |-- design.md

text

---

## 12. Conventions

### CSS

- Design tokens live in `:root`, one source of truth.
- Specificity is kept low. `!important` is used only when fighting legacy rules.
- Every page-specific override lives in its own CSS file (`register.css`, `admin.css`, `notices.css`) loaded after `styles.css`.
- Class names use BEM-ish prefixes: `.dx-*` for Discover, `.admin-*` for admin dashboard, `.pv-*` for provider detail, `.ann-*` for announcements.

### JavaScript

- Each page has one entry JS file, plus shared helpers.
- `api.js` is the only place that calls `fetch()`.
- Errors are thrown as `new Error(messageFromServer)` so every catch block can just `toast(err.message)`.
- No frameworks. Plain DOM APIs everywhere.

### Git

- Feature-per-commit. Commit messages start with an imperative verb: "Add...", "Fix...", "Remove...", "Refactor...".
- Never bulk-replace HTML across multiple files - one file at a time, verify in browser, then commit.

---

## 13. Recurring Patterns

### Toast feedback on every action

Every API call that mutates data shows a toast on success and failure.

### Confirm before destructive actions

`confirm()` for quick prompts; custom modal for multi-line warnings.

### Cascade-safe deletes

Deleting a provider or resident runs child-table deletes first (Reports -> Reviews -> Bookings -> Providers/Residents) to satisfy FK constraints.

### Duplicate-safe creates

Categories, residents and providers all run a case-insensitive duplicate check before insert, returning `409 Conflict` with a user-facing message.

### Role-aware UI

Buttons that a user can't use are hidden or rendered disabled with a tooltip. The server independently returns `403` if the request is forced.

---

## 14. Accessibility

- All form inputs have associated `<label>` elements.
- Modals use `role="dialog"` and `aria-modal="true"`.
- Focus states use `outline: 2px solid var(--ochre)` with offset.
- `prefers-reduced-motion` disables transitions.
- Icons that are decorative have `aria-hidden="true"`.
- Colour contrast: `--ink` on `--paper` passes AA. Ochre on paper is used for non-essential elements only (icons, borders, active states).

---

## 15. Future Work

- Real-time updates via polling on the notices page.
- Soft-delete (`deleted_at` column) instead of hard delete.
- Reviews UI on the provider detail page (schema exists, UI pending).
- Email notification on new notices via the existing mailer.
- S3 or local upload for provider avatars.

---

*End of document.*
