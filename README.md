# Athi Soko Connect

A full client-server prototype of the web-based home & errand
service booking platform for Athi Highway Estate: a plain
HTML/CSS/JS frontend talking to a Node.js/Express REST API backend
with JSON-file storage.

## Project structure

```
athi-soko-connect/
├── frontend/                    Static site - served by the backend
│   ├── index.html                 Discover - search, filter, browse
│   ├── provider.html               Provider profile, booking, reviews, report
│   ├── register.html                Provider self-registration form
│   ├── dashboard.html              Resident bookings - status tracking + reviews
│   ├── admin.html                  Verification queue + report review
│   ├── css/
│   │   └── styles.css               Shared design system
│   └── js/
│       ├── api.js                    Fetch wrapper - the ONLY file that talks to the backend
│       ├── main.js                    Shared UI helpers (badges, stars, toast, nav)
│       ├── home.js                     Discover page logic
│       ├── provider.js                 Profile + booking + report logic
│       ├── register.js                 Registration form logic
│       ├── dashboard.js                Bookings + review logic
│       └── admin.js                    Verification + report review logic
│
└── backend/                     Node.js / Express REST API
    ├── server.js                  App entry point - mounts routes, serves frontend/
    ├── package.json
    ├── data/
    │   └── db.json                 Seed data + persisted state (acts as the "database")
    ├── utils/
    │   └── db.js                    Read/write helpers for db.json
    └── routes/
        ├── categories.js            GET /api/categories
        ├── providers.js             GET/POST/PATCH/DELETE /api/providers
        ├── reviews.js                GET/POST /api/reviews
        ├── bookings.js               GET/POST/PATCH /api/bookings
        └── reports.js                 GET/POST/PATCH /api/reports
```

## Running it

```bash
cd backend
npm install
npm start
```

Then open **http://localhost:3000** - the backend serves the frontend
files directly, so there's only one server to run and no CORS
workarounds needed.

## API reference

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/categories` | List service categories |
| GET | `/api/providers?q=&category=&zone=` | Search/filter providers |
| GET | `/api/providers/:id` | Get one provider |
| POST | `/api/providers` | Register a new provider (`verified: false`) |
| PATCH | `/api/providers/:id` | Update a provider (e.g. admin verifies it) |
| DELETE | `/api/providers/:id` | Remove a provider |
| GET | `/api/reviews/provider/:providerId` | Reviews for a provider |
| POST | `/api/reviews` | Add a review (recomputes the provider's rating) |
| GET | `/api/bookings` | List all bookings |
| POST | `/api/bookings` | Create a booking (`status: "requested"`) |
| PATCH | `/api/bookings/:id` | Update a booking's status/`reviewed` flag |
| GET | `/api/reports` | List all reports |
| POST | `/api/reports` | File a report (`status: "open"`) |
| PATCH | `/api/reports/:id` | Mark a report reviewed |

## Data & persistence

`backend/data/db.json` is the database. `backend/utils/db.js` reads
the whole file into memory and writes it back after each change -
simple and dependency-free, good enough for a course-project
prototype. To move to a real database later, only `utils/db.js`
needs to change; every route handler and the entire frontend stay
the same, since they only ever call `readDB()`/`writeDB()` or `Api.*`.

## How the prototype maps to the brief

| Scope item | Where it lives |
|---|---|
| Search/filter by category, location, price, availability | `frontend/index.html` + `home.js` → `GET /api/providers` |
| Standardized provider profiles (services, pricing, hours, verification, ratings) | `frontend/provider.html` + `provider.js` → `GET /api/providers/:id` |
| Provider self-registration | `frontend/register.html` + `register.js` → `POST /api/providers` |
| Booking with status tracking (requested → confirmed → completed) | `provider.js` (create) + `dashboard.html`/`dashboard.js` (track) → `/api/bookings` |
| Ratings, reviews, referrals | `dashboard.js` review flow, shown on `provider.html` → `/api/reviews` |
| Reporting poor service / suspicious providers | Report modal in `provider.html`, reviewed in `admin.html` → `/api/reports` |
| Admin verification workflow | `admin.html` + `admin.js` → `PATCH /api/providers/:id` |

## Out of scope (matches the project boundaries)

- No online payment - booking only requests a service; payment is
  arranged directly between resident and provider.
- No delivery/courier tracking.
- No dispute resolution beyond logging a report for admin review.
- No integration with the AHE Access Management System.
- Web only - no native mobile app.
- No authentication yet - bookings/reports aren't tied to a signed-in
  resident. Adding login (e.g. a `users` collection + session/JWT
  middleware in `backend/`) is a natural next step before real
  deployment, noted here rather than built, to keep the prototype
  focused on the core booking/verification workflow.

## Design notes

Palette and type are deliberately not a generic SaaS look: ink-navy
structure, an ochre accent reserved for booking/CTA actions, teal for
verification, and a warm paper background - closer to a noticeable
estate noticeboard than a template dashboard. Headings use Fraunces
(serif, loaded from Google Fonts); UI text uses Inter.
