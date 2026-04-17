# Pendora — Digital Downloads for Shopify

> Sell downloadable files directly from your Shopify store. Attach PDFs, ZIPs, MP3s, videos, and more to any product. Customers receive secure download links on the Thank You page and via automated email — no third-party delivery service needed.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Database Schema](#database-schema)
- [Checkout Extension](#checkout-extension)
- [Email Delivery System](#email-delivery-system)
- [Security](#security)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

---

## Overview

Pendora is an embedded Shopify app that bridges the gap between Shopify's physical-product infrastructure and digital product delivery. Merchants can:

1. Attach one or more downloadable files to any existing Shopify product.
2. Store files securely in Shopify's own file storage (via staged uploads).
3. Automatically deliver download links to customers on the post-purchase Thank You page.
4. Send automated download emails when an order is paid.
5. Manage all uploaded files, replace them, and notify previous purchasers of updates.

---

## Features

### Merchant Dashboard — Digital Products (`/app`)
- **First-Run Setup Guide** — New merchants land on a 3-step onboarding card (Create your first digital product → Customize your delivery email → Your first customer delivery). Step completion is auto-derived from the app's own data (no flags to toggle); the card is dismissible, collapsible, and celebrates with a "You're all set" variant when all 3 are complete. Follows Shopify's [Setup Guide composition pattern](https://shopify.dev/docs/api/app-home/patterns/compositions/setup-guide).
- **Product Card List** — All digital products displayed as cards with file name, type badge, size, and edit/delete options.
- **Dashboard Search** — Live filter on the dashboard by product title. Shows `"X of Y products"` count while filtering, with a graceful no-match card and a ✕ clear button. Purely client-side — the full list is already in loader data.
- **3-Step Wizard** — Create a digital product by choosing a Shopify product, uploading files (or reusing existing ones), and reviewing before saving.
- **Infinite-Scroll Product Picker** — Wizard step 1 loads 20 Shopify products at a time with server-side pagination. Next 20 fetched automatically as the user scrolls close to the end — scales to stores with thousands of products without a performance hit.
- **Server-Side Product Search** — Typing in the wizard's product search bar (300ms debounced) queries Shopify's admin GraphQL `products(query:)` directly, so matching is correct even across un-loaded pages.
- **Use Existing Files** — Attach already-uploaded files to new products instantly — no re-upload needed.
- **Detail View** — Click "Edit" on any product card to upload more files, preview, or delete.
- **Clean Single-Column Layout** — Digital Products heading, product count, and Add Product button sit together in a single row at the top of the dashboard.

### File Manager (`/app/files`)
- **Deduplicated File List** — Same file used across multiple products shows as one entry with "Used in X products" count.
- **Accordion Details** — Click "View Details" to expand file metadata (upload date, MIME type, assigned products).
- **Search, Filter, Sort** — Search by name, filter by type (Documents, Images, Video, Audio, Archives), sort by date/name/size/type.
- **Storage Summary** — Header shows total unique files and total size.
- **Smart Delete** — Single product: direct confirm. Multiple products: product picker popup with warning about impact.
- **Replace File** — Upload replacement file for a specific product. Previous purchasers of that product are automatically notified via email with fresh download links. If the update email fails, a `failed` row is recorded in the delivery log with a friendly error message.
- **Type-Specific Icons** — Different icons for documents, images, video, audio, and archives.

### Email & Deliverables (`/app/email`)
- **Automated Order Emails** — When an order is marked as paid (`orders/paid` webhook), customers receive a download email automatically.
- **Email Template Editor** — Merchants customize subject, greeting, body, footer, and button color with live preview.
- **Smart Save Button** — The "Save Template" button is disabled until the user actually changes something. Re-enables after any edit; greys out again after a successful save.
- **Dynamic Variables** — `{{customer_name}}`, `{{order_number}}`, `{{shop_name}}` auto-replaced at send time.
- **Paginated Delivery Log** — 10 emails per page with Prev/Next controls. Server-side pagination via Prisma `skip`/`take` + `count` — scales to tens of thousands of logs without loading them all.
- **Delivery Log Search** — Single search bar matches against customer name, customer email, product title, AND file names (display name or original filename). Debounced 300 ms, resets to page 1 on each new query, clears with a ✕ button.
- **Smart Resend** — Click "Resend" to open a popup with: custom email address (for customer requests), file selection checkboxes, and optional custom message. Deleted files are hidden from the list with an inline note — the popup never shows raw file IDs.
- **Resent Tag** — Resent emails show a "RESENT" badge in both the email itself and the delivery log.
- **Friendly Error Messages** — SMTP failures (wrong credentials, timeouts, blocked sender, etc.) are translated into plain-English messages both in the UI toast and in the delivery-log `error` column. Raw SMTP codes never leak to the merchant.
- **Custom SMTP Mailer** — Zero third-party email packages. Pure Node.js `net`/`tls` SMTP client connecting to Gmail SMTP.

### Customer Experience
- **Thank You Page** — Download cards with file type badge, clean file name, "Your file is ready to download" text, and prominent Download button.
- **Automated Email** — Professional HTML email with shop branding, product sections, file type badges, and download buttons. Mobile-responsive stacked layout.
- **Secure Downloads** — Every download link is protected by HMAC-SHA256 signed tokens.
- **No Login Required** — Customers click and download — no account needed.

### Technical
- **Chunked Parallel Uploads** — Files over 50 MB are split into 25 MB chunks uploaded via 6 concurrent connections (up to 5 GB supported).
- **Just-in-Time Staging** — Each chunk gets a fresh pre-signed URL immediately before upload.
- **Auto-Retry with Resume** — Failed chunks retry up to 3 times. Resume cache in localStorage is shape-validated before use and survives page refreshes.
- **Upload Integrity Checks** — Stage response is validated for target-count parity; chunk arrays are checked for holes before the save call. A partial upload is rejected with a clear error instead of being silently corrupted.
- **Chunked Downloads with Retry** — Large files streamed back via `ReadableStream` concatenation. Each chunk fetch retries up to 3 times (500 ms backoff) before bytes hit the wire — transient CDN 5xx no longer breaks downloads.
- **Shopify CDN Storage** — Files uploaded directly to Shopify's CDN; app server never handles raw file bytes.
- **Centralized Metafield Sync** — Single `syncProductFilesMetafield` helper owns all writes to `pendora.files` product metafields. `userErrors` from the GraphQL response are logged (no longer silently swallowed) so drift between DB and checkout extension is observable.
- **Corruption-Safe Chunk Parsing** — All `JSON.parse(chunkUrls)` paths are wrapped in try/catch with a safe null fallback, so a malformed DB row can't crash a background sync task.
- **Defensive Checkout Extension** — Metafield parsing filters out entries missing `fileId` and tolerates `null` metafield values, so a stale or partial sync never blanks the thank-you page.
- **GDPR Compliance** — Handles `customers/data_request`, `customers/redact`, and `shop/redact` webhooks.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [React Router v7](https://reactrouter.com/) |
| Shopify Integration | [@shopify/shopify-app-react-router](https://shopify.dev/docs/api/shopify-app-react-router) |
| UI Components | Shopify Polaris Web Components (`s-page` / `s-section` / `s-button` / `s-app-nav`) for routing shells, nav, and list pages + custom inline styles (Shopify-matched navy/amber theme) on the design-heavy dashboard/file-manager/email pages |
| Checkout Extension | [@shopify/ui-extensions-react/checkout](https://shopify.dev/docs/api/checkout-ui-extensions) |
| Database ORM | [Prisma](https://prisma.io/) |
| Database | SQLite (dev) — swappable to PostgreSQL/MySQL for production |
| Email | Custom SMTP client (Node.js `net`/`tls` — zero npm packages) |
| Encryption | AES-256-GCM for sensitive data, HMAC-SHA256 for tokens |
| Build Tool | [Vite](https://vitejs.dev/) |
| Language | JavaScript (JSX) |
| Runtime | Node.js >= 20.19 |

### Shopify design-guideline compliance
- **Navigation:** `<s-app-nav>` + `<s-link>` — integrates with Shopify admin sidebar.
- **Routing shells:** `<s-page heading=...>` + `<s-section>` in `/app/new-product`, `/app/products`, `/app/product/:id`, `auth.login`.
- **Onboarding:** Matches [Shopify's Setup Guide composition](https://shopify.dev/docs/api/app-home/patterns/compositions/setup-guide) — 3 steps, per-step CTA, progress counter, dismissible.
- **Theming:** Custom pages use a single navy/amber token set (`t.surface`, `t.active`, `t.accent`, `t.success`, `t.danger`) for visual consistency across `/app`, `/app/files`, `/app/email`.
- **Accessibility:** Role-labelled regions on interactive cards, keyboard-operable dismiss/collapse buttons, ARIA labels on icon-only controls.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Shopify Admin                          │
│                  (Embedded App iFrame)                      │
│                                                             │
│   ┌──────────────────────────────────────────────────────┐  │
│   │  Sidebar Navigation                                  │  │
│   │  ├── Digital Products (/app)                         │  │
│   │  ├── Files (/app/files)                              │  │
│   │  └── Email & Deliverables (/app/email)               │  │
│   └──────────────────────────────────────────────────────┘  │
└───────────────────────────────────┬─────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────┐
│                    App Backend (Node.js)                    │
│                                                             │
│   /api/stage          → Shopify Staged Upload API          │
│   /api/files/:id      → Preview (token-verified)           │
│   /api/download/:id   → App Proxy download (HMAC-verified) │
│   /api/file-actions   → Delete + Replace (with notify)     │
│   /api/clone-file     → Attach existing file to product    │
│   /api/email-template → Template CRUD                      │
│   /api/email-resend   → Resend with custom email/message   │
│   /webhooks/*         → Shopify Webhook handlers           │
└───────┬──────────────────┬──────────────────┬───────────────┘
        │                  │                  │
        ▼                  ▼                  ▼
 ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
 │ Shopify CDN  │  │ SQLite/Prisma│  │ SMTP (Gmail)     │
 │ File Storage │  │ 5 tables     │  │ Custom mailer    │
 └──────────────┘  └──────┬───────┘  │ (net/tls)        │
                          │          └──────────────────┘
                          ▼
                 ┌─────────────────┐
                 │ Shopify Product │
                 │ Metafield Sync  │
                 │ pendora.files   │
                 └────────┬────────┘
                          │
                          ▼
                 ┌─────────────────┐
                 │ Thank You Page  │
                 │ Checkout Ext.   │
                 └─────────────────┘
```

---

## Project Structure

```
pendora-test/
│
├── app/
│   ├── routes/
│   │   ├── app.jsx                         # Layout — sidebar nav + AppProvider
│   │   ├── app._index.jsx                  # Digital Products (cards + wizard + detail)
│   │   ├── app.files.jsx                   # File Manager (accordion + search/filter)
│   │   ├── app.email.jsx                   # Email & Deliverables (template + log)
│   │   │
│   │   ├── api.stage.jsx                   # Staged upload (stage + save)
│   │   ├── api.files.$fileId.jsx           # File preview (token-verified)
│   │   ├── api.download.$fileId.jsx        # App Proxy download (HMAC-verified)
│   │   ├── api.file-actions.jsx            # Delete + Replace (with email notify)
│   │   ├── api.clone-file.jsx              # Clone existing file to new product
│   │   ├── api.email-template.jsx          # Email template CRUD
│   │   ├── api.email-resend.jsx            # Resend email (custom email/message/files)
│   │   ├── api.downloads.jsx               # Checkout extension file list
│   │   ├── api.products.jsx                # Shopify products (cached 5 min)
│   │   │
│   │   ├── webhooks.orders-paid.jsx        # orders/paid → auto email
│   │   ├── webhooks.app.uninstalled.jsx    # Cleanup on uninstall
│   │   ├── webhooks.app.scopes_update.jsx  # Scope changes
│   │   ├── webhooks.customers.data-request.jsx  # GDPR data request
│   │   ├── webhooks.customers.redact.jsx        # GDPR customer redact
│   │   └── webhooks.shop.redact.jsx             # GDPR shop redact
│   │
│   ├── components/
│   │   └── OnboardingGuide.jsx             # First-run Setup Guide card (dismissible)
│   │
│   ├── utils/
│   │   ├── token.server.js                 # HMAC tokens (1h dashboard + 7d email)
│   │   ├── mailer.server.js                # Custom SMTP client (net/tls) + friendlyMailError
│   │   ├── email.server.js                 # Email engine (template render + send)
│   │   ├── metafield.server.js             # Central pendora.files metafield sync + buildFilesPayload
│   │   └── crypto.server.js                # AES-256-GCM encrypt/decrypt
│   │
│   ├── shopify.server.js                   # Shopify app config + auth
│   ├── db.server.js                        # Prisma client singleton
│   └── root.jsx                            # HTML shell
│
├── extensions/
│   └── thank-you-downloads/
│       ├── src/Checkout.jsx                # Thank You page UI extension
│       └── shopify.extension.toml
│
├── prisma/
│   └── schema.prisma                       # 5 models: Session, ProductFile,
│                                           # EmailTemplate, EmailLog, SmtpConfig
├── shopify.app.toml                        # Scopes, webhooks, proxy config
└── vite.config.js
```

---

## API Reference

### `POST /api/stage`

Two-phase upload endpoint. Client sends file metadata, receives pre-signed CDN URLs, uploads directly to Shopify CDN, then notifies the app to save records.

**Phase 1 — Stage** (`intent: "stage"`)
```json
{ "intent": "stage", "files": [{ "filename": "guide.pdf", "mimeType": "application/pdf", "fileSize": 204800 }] }
```

**Phase 2 — Save** (`intent: "save"`)
```json
{ "intent": "save", "productId": "gid://shopify/Product/123", "productTitle": "My eBook", "files": [{ "resourceUrl": "https://cdn.shopify.com/...", "filename": "guide.pdf", "mimeType": "application/pdf", "fileSize": 204800 }] }
```

### `POST /api/file-actions`

- `_action: "delete"` — Delete file, sync metafield, handle last-file-in-product cleanup.
- `_action: "replace"` — Replace file content, sync metafield, notify previous purchasers via email.

### `POST /api/clone-file`

Attach existing files to a new product (no re-upload). Creates new DB records pointing to same CDN URLs.

### `POST /api/email-template`

Save/load merchant's email template (subject, heading, body, footer, button color).

### `POST /api/email-resend`

Resend email with options: custom recipient email, specific file selection, custom message. Errors are returned through `friendlyMailError` — the client receives a human-readable message instead of raw SMTP output.

### `GET /api/files/:fileId?token=<token>`

Token-verified file preview/download. Token expires in 1 hour. Checks `downloadEnabled` flag. Chunked files stream through with per-chunk fetch retry; error responses are generic (no `err.message` leakage).

### `GET /apps/pendora/api/download/:fileId` *(App Proxy)*

Customer download endpoint. HMAC signature verified by Shopify proxy + shop ownership check + `downloadEnabled` check + CDN URL validation. Per-chunk fetch retry (3× with 500ms backoff) before any bytes are streamed, so transient CDN 5xx no longer aborts the download.

### `GET /api/products`

Cursor-paginated Shopify products list (used by the wizard's product picker).

| Query param | Default | Max | Notes |
|---|---|---|---|
| `first` | 20 | 50 | Page size |
| `after` | — | — | Cursor from previous response's `pageInfo.endCursor` |
| `search` | — | — | Free-text query passed through to Shopify admin GraphQL |

**Response:**
```json
{ "products": [ { "id": "gid://...", "title": "...", "status": "...", "featuredImage": { "url": "..." } } ], "pageInfo": { "hasNextPage": true, "endCursor": "..." } }
```

The default call (`first=20`, no cursor, no search) is cached per-shop for 5 minutes. Paginated and search calls bypass the cache.

### `GET /app/email?page=<n>&q=<text>`

Same route loader that renders the Email page also serves paginated/filtered delivery-log data via `useFetcher.load(...)`. Returns `{ template, logs, fileMap, pagination: { page, totalPages, total, perPage, q } }`. Search matches against customer name, customer email, product title, and file names (joined through the ProductFile table).

---

## Database Schema

```prisma
model ProductFile {
  id              String   @id @default(cuid())
  shop            String
  productId       String            // Shopify Product GID
  productTitle    String?
  fileName        String
  fileUrl         String?           // CDN URL (null for chunked)
  chunkUrls       String?           // JSON array of chunk CDN URLs
  mimeType        String?
  fileSize        BigInt?
  displayName     String?
  downloadEnabled Boolean  @default(true)
  status          String   @default("ready")  // pending | ready | failed
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model EmailTemplate {
  id          String   @id @default(cuid())
  shop        String   @unique
  subject     String   @default("Your digital files from {{shop_name}}")
  heading     String   @default("Hi {{customer_name}},")
  body        String
  footer      String
  buttonColor String   @default("#1B2B44")
}

model EmailLog {
  id            String   @id @default(cuid())
  shop          String
  orderId       String
  orderNumber   String
  customerName  String
  customerEmail String
  productId     String
  productTitle  String
  fileIds       String            // JSON array
  status        String            // sent | failed | resent
  error         String?
  tokenExpiry   DateTime
  createdAt     DateTime @default(now())
}

model SmtpConfig {
  id        String   @id @default(cuid())
  shop      String   @unique
  host      String
  port      Int      @default(587)
  secure    Boolean  @default(false)
  user      String
  pass      String                 // AES-256-GCM encrypted
  fromName  String
  fromEmail String
  enabled   Boolean  @default(false)
}
```

---

## Checkout Extension

**Extension:** `thank-you-downloads`
**Target:** `purchase.thank-you.block.render`

Each purchased product's digital files are displayed as individual cards with:
- File type badge (e.g. `PDF`, `WEBP`, `MP4`)
- Clean file name (special characters replaced with spaces, extension removed)
- "Your file is ready to download" subtitle
- Prominent Download button (`kind="primary"`)

The extension reads `pendora.files` product metafields using `useAppMetafields` — pre-synced by the backend, so **zero HTTP requests** at render time.

---

## Email Delivery System

### Flow

```
Customer purchases product
  → Shopify fires orders/paid webhook
  → webhooks.orders-paid.jsx receives it
  → email.server.js matches line items → finds digital files in DB
  → Renders HTML email using merchant's template + dynamic variables
  → mailer.server.js sends via raw SMTP (Gmail)
  → Creates EmailLog entry (sent/failed)
  → Merchant sees it in Delivery Log tab
```

### Email Types

| Type | Trigger | Tag |
|------|---------|-----|
| **Order email** | `orders/paid` webhook | None |
| **Resent email** | Merchant clicks "Resend" in delivery log | `RESENT` badge |
| **File update email** | Merchant replaces a file in File Manager | `Updated file available` subject |

### Custom SMTP Mailer

`app/utils/mailer.server.js` — Pure Node.js, zero npm packages:
1. TCP connect to `smtp.gmail.com:587`
2. EHLO → STARTTLS → TLS upgrade
3. AUTH LOGIN (base64 credentials)
4. MAIL FROM → RCPT TO → DATA → email body → QUIT

Credentials stored in `.env` (`MAIL_USER`, `MAIL_PASS`).

---

## Security

### Download Tokens
- **HMAC-SHA256** signed with `SHOPIFY_API_SECRET`
- **Dashboard tokens** — 1 hour expiry
- **Email tokens** — 7 day expiry
- **File-scoped** — token for file-A cannot access file-B
- **Timing-safe** — `crypto.timingSafeEqual` comparison

### App Proxy Download
- Shopify HMAC signature verification
- Shop ownership check (`file.shop === requestShop`)
- `downloadEnabled` flag enforcement
- CDN URL whitelist validation (`.shopifycdn.com`, `.shopify.com`, `.googleapis.com`)

### CORS
- Origin validated with `new URL(origin).hostname.endsWith(".myshopify.com")`
- Origin-shop match to prevent cross-shop access

### MIME Type Validation
- Server-side allowlist of accepted MIME types
- Unknown types replaced with `application/octet-stream`

### GDPR Compliance
- `customers/data_request` — Returns all stored customer data
- `customers/redact` — Deletes all customer email logs
- `shop/redact` — Deletes all shop data (files, templates, logs, configs)

---

## Getting Started

### Prerequisites

- Node.js >= 20.19
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli/getting-started)
- A Shopify Partner account + development store
- Gmail account with App Password (for email delivery)

### Local Setup

```bash
# Clone
git clone <repo-url>
cd pendora-test

# Install dependencies
npm install

# Create database + push schema
npx prisma db push

# Start dev server
shopify app dev
```

### Email Setup

1. Generate a Gmail App Password: Google Account → Security → 2-Step Verification → App passwords
2. Add to `.env`:
```env
MAIL_USER=your-email@gmail.com
MAIL_PASS=your-16-char-app-password
```

### Protected Customer Data (for orders/paid webhook)

1. Shopify Partner Dashboard → Your App → API access
2. "Protected customer data access" → Request access
3. Select: Customer service + App functionality
4. Protected fields: Select Name + Email

---

## Environment Variables

| Variable | Description |
|---|---|
| `SHOPIFY_API_KEY` | App client ID from Partner Dashboard |
| `SHOPIFY_API_SECRET` | App secret — signs download tokens |
| `MAIL_USER` | SMTP username (e.g. `gourav@pumper.run`) |
| `MAIL_PASS` | SMTP password (Gmail App Password) |

`SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` are injected automatically by `shopify app dev`.

---

## Deployment

### Build

```bash
npm run build
npm start
```

### Deploy Extension

```bash
shopify app deploy
```

### Switching from SQLite to PostgreSQL

Update `prisma/schema.prisma`:
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Then:
```bash
npx prisma migrate deploy
```

---

## Troubleshooting

**`The table main.Session does not exist`**
```bash
npx prisma db push
```

**`orders/paid webhook not firing`**
Ensure protected customer data access is approved in Partner Dashboard. Restart dev server after TOML changes.

**"Email service is not configured correctly (authentication failed)"** *(in the UI / delivery log)*
Server-side this is a `SMTP 535: Username and Password not accepted` — the raw error is in `console.error` for the developer, but `friendlyMailError()` in [app/utils/mailer.server.js](app/utils/mailer.server.js) translates it for the merchant. Fix: use a Gmail App Password, not your regular password. Generate at: Google Account → Security → 2-Step Verification → App passwords.

**`Connection timeout to smtp.gmail.com`**
Ensure port 587 is not blocked by your firewall/network. Test with: `telnet smtp.gmail.com 587`

**`Email sent but not received`**
Check spam folder. Add SPF record to your sending domain's DNS for better deliverability.

**Download links returning 401**
Dashboard tokens expire in 1 hour. Email tokens expire in 7 days. For customer downloads, always use the App Proxy URL.

---

## Recent Changes

### Scale & UX
- First-run **Setup Guide** on `/app` — 3-step onboarding card (Create product → Customize email → First delivery). Auto-completes from app data, dismissible via localStorage, matches Shopify's Setup Guide composition pattern.
- **Dashboard search bar** on `/app` — live filter of existing digital products by title, with `X of Y` count and a no-match card.
- Wizard product picker → server-side cursor pagination (20 at a time, infinite scroll, ~5 rows early preload).
- Server-side product search via Shopify admin GraphQL `products(query:)`.
- Delivery log → server-side pagination (10/page) + multi-field search (customer name / email / product / file name).
- Dashboard navbar removed; Add Product button lives next to the Digital Products heading.
- Files page: redundant per-type size badges removed from the header.

### Reliability & Safety
- New `syncProductFilesMetafield` helper centralizes all seven metafield-sync call sites. `userErrors` are now logged instead of silently swallowed by `.catch(() => {})`.
- `JSON.parse(chunkUrls)` is safe everywhere — corrupt DB rows can no longer crash background sync tasks.
- Download endpoints retry chunk fetches 3× with 500 ms backoff before the response stream starts. Internal error text no longer leaks to clients.
- `friendlyMailError` maps raw SMTP failures (535, 534, 550, timeouts, ECONNREFUSED, etc.) to merchant-friendly strings in both the UI and `emailLog.error`.
- Stage upload response is validated for target-count parity; chunked uploads detect holes before saving.
- Checkout extension defensively parses metafield values — null values and entries missing `fileId` are dropped instead of crashing the thank-you page.
- Resend popup filters out deleted files and shows a clear message if every file from an email has been deleted.
- "Save Template" button is properly dirty-tracked — greys out when nothing has changed and re-enables after any edit.

---

## License

Private — all rights reserved.
