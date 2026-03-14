# Pendora — Digital Downloads for Shopify

> Sell downloadable files directly from your Shopify store. Attach PDFs, ZIPs, MP3s, videos, and more to any product. Customers receive secure, time-limited download links on the Thank You page after purchase.

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
3. Automatically deliver download links to customers on the post-purchase Thank You page — no email, no third-party, no friction.

The app uses a **Shopify Checkout UI Extension** on `purchase.thank-you.block.render` to show download buttons directly in the Shopify checkout flow.

---

## Features

### Merchant Dashboard
- **3-Step Wizard** — Create a digital product by choosing a Shopify product, uploading files, and reviewing before saving.
- **Sidebar Product List** — All digital products listed with file counts; click to view and manage.
- **File Management** — Upload additional files to existing products, preview files, or delete them.
- **Display Names** — Each file can have a custom display name shown to customers (e.g. "User Guide PDF").
- **Day / Night Mode** — Toggle between *Serene Nature Tones* (light) and *Black & Gold Elegance* (dark) themes.

### Customer Experience
- **Automatic Delivery** — Download buttons appear on the Thank You page immediately after purchase.
- **Secure Downloads** — Each download link is protected by a signed, HMAC-SHA256 token that expires in 1 hour.
- **No Login Required** — Customers click and download — no account needed.

### Technical
- **Shopify Staged Uploads** — Files are uploaded directly to Shopify's CDN via pre-signed PUT URLs; the app server never handles raw file bytes.
- **Metafield Sync** — File metadata is synced to `pendora.files` product metafields after every upload or delete, keeping the checkout extension up to date without any HTTP calls at render time.
- **Webhook Handling** — Listens to `app/uninstalled` and `app/scopes_update` webhooks for clean lifecycle management.
- **App Proxy** — Download endpoint is exposed via Shopify App Proxy (`/apps/pendora/api/download/:fileId`) for stable, shop-authenticated URLs.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [React Router v7](https://reactrouter.com/) (formerly Remix) |
| Shopify Integration | [@shopify/shopify-app-react-router](https://shopify.dev/docs/api/shopify-app-react-router) |
| UI Components | Custom inline styles (Day/Night theme system) |
| Checkout Extension | [@shopify/ui-extensions-react/checkout](https://shopify.dev/docs/api/checkout-ui-extensions) |
| Database ORM | [Prisma](https://prisma.io/) |
| Database | SQLite (dev) — swappable to PostgreSQL / MySQL for production |
| Session Storage | [@shopify/shopify-app-session-storage-prisma](https://github.com/Shopify/shopify-api-js) |
| Build Tool | [Vite](https://vitejs.dev/) |
| Language | JavaScript (JSX) |
| Runtime | Node.js >= 20.19 |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Shopify Admin                          │
│                  (Embedded App iFrame)                      │
│                                                             │
│   ┌──────────────┐        ┌──────────────────────────────┐  │
│   │   Sidebar    │        │        Main Panel            │  │
│   │  Products    │◄──────►│  Wizard / File Manager       │  │
│   └──────────────┘        └──────────────────────────────┘  │
└───────────────────────────────────┬─────────────────────────┘
                                    │ fetch /api/stage
                                    ▼
┌─────────────────────────────────────────────────────────────┐
│                    App Backend (Node.js)                    │
│                                                             │
│   /api/stage       →  Shopify Staged Upload API            │
│   /api/files/:id   →  Preview endpoint (token-verified)    │
│   /api/download/:id → App Proxy download (HMAC-verified)   │
│   /webhooks/*      →  Shopify Webhook handlers             │
└───────────────┬─────────────────────────┬───────────────────┘
                │                         │
                ▼                         ▼
      ┌──────────────────┐     ┌─────────────────────┐
      │  Shopify Files   │     │   SQLite / Prisma   │
      │  (CDN Storage)   │     │   ProductFile table │
      └──────────────────┘     └─────────┬───────────┘
                                         │ Metafield Sync
                                         ▼
                               ┌─────────────────────┐
                               │  Shopify Product    │
                               │  Metafield          │
                               │  pendora.files      │
                               └─────────┬───────────┘
                                         │
                                         ▼
                               ┌─────────────────────┐
                               │  Thank You Page     │
                               │  Checkout Extension │
                               │  (Download Buttons) │
                               └─────────────────────┘
```

---

## Project Structure

```
pendora-test/
│
├── app/
│   ├── routes/
│   │   ├── app._index.jsx              # Main dashboard (product list + file manager)
│   │   ├── app.products.jsx            # Products listing page
│   │   ├── app.product.$productId.jsx  # Single product detail
│   │   ├── app.new-product.jsx         # New product creation
│   │   ├── app.additional.jsx          # Additional settings
│   │   │
│   │   ├── api.stage.jsx               # Staged upload handler (stage + save intents)
│   │   ├── api.files.$fileId.jsx       # File preview (token-verified)
│   │   ├── api.download.$fileId.jsx    # App Proxy download endpoint
│   │   ├── api.downloads.jsx           # Bulk downloads handler
│   │   ├── api.upload.jsx              # Direct upload handler
│   │   │
│   │   ├── auth.$.jsx                  # Shopify OAuth catch-all
│   │   ├── auth.login/                 # Login route
│   │   ├── webhooks.app.uninstalled.jsx
│   │   └── webhooks.app.scopes_update.jsx
│   │
│   ├── utils/
│   │   ├── token.server.js             # HMAC-SHA256 token generation + verification
│   │   └── parseMultipart.server.js    # Multipart form data parser
│   │
│   ├── shopify.server.js               # Shopify app config + auth
│   ├── db.server.js                    # Prisma client singleton
│   └── root.jsx                        # App root layout
│
├── extensions/
│   └── thank-you-downloads/
│       ├── src/
│       │   └── Checkout.jsx            # Thank You page UI extension
│       └── shopify.extension.toml
│
├── prisma/
│   └── schema.prisma                   # DB schema (Session + ProductFile)
│
├── shopify.app.toml                    # Scopes, webhooks, metafields, proxy config
└── vite.config.js
```

---

## API Reference

### `POST /api/stage`

Two-phase upload endpoint used by the frontend. The client never sends file bytes to the app server — files go directly from the browser to Shopify's CDN.

**Phase 1 — Stage** (`intent: "stage"`)

Request pre-signed upload URLs from Shopify.

```json
{
  "intent": "stage",
  "files": [
    { "filename": "guide.pdf", "mimeType": "application/pdf", "fileSize": 204800 }
  ]
}
```

Response:
```json
{
  "targets": [
    { "url": "https://...", "resourceUrl": "https://cdn.shopify.com/..." }
  ]
}
```

The client then PUTs the file bytes to `target.url` directly.

**Phase 2 — Save** (`intent: "save"`)

After the PUT completes, save the file record and sync metafields.

```json
{
  "intent": "save",
  "productId": "gid://shopify/Product/123",
  "productTitle": "My eBook",
  "files": [
    {
      "resourceUrl": "https://cdn.shopify.com/...",
      "filename": "guide.pdf",
      "mimeType": "application/pdf",
      "fileSize": 204800,
      "displayName": "Complete User Guide"
    }
  ]
}
```

---

### `GET /api/files/:fileId?token=<token>`

Merchant-facing file preview. Requires a valid signed download token (generated server-side on each dashboard load). Token expires in **1 hour**.

---

### `GET /apps/pendora/api/download/:fileId` *(App Proxy)*

Customer-facing download endpoint. Routed through the Shopify App Proxy — Shopify verifies the request HMAC before forwarding to the app. Used by the Thank You page extension.

---

## Database Schema

```prisma
model Session {
  id           String    @id
  shop         String
  accessToken  String
  // ... standard Shopify session fields
}

model ProductFile {
  id              String   @id @default(cuid())
  shop            String            // myshopify domain
  productId       String            // Shopify Product GID
  productTitle    String?
  fileName        String            // original filename
  fileUrl         String            // Shopify CDN URL
  mimeType        String?
  fileSize        Int?              // bytes
  displayName     String?           // customer-facing label
  downloadEnabled Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([shop, productId])
}
```

---

## Checkout Extension

**Extension:** `thank-you-downloads`
**Target:** `purchase.thank-you.block.render`
**API Version:** `2025-07`

The extension reads `pendora.files` product metafields using `useAppMetafields`. These metafields are pre-synced by the app backend on every file upload or delete — so the extension renders with **zero additional HTTP requests**.

```
Thank You Page
│
└── Pendora Digital Downloads          ← Extension block
    │
    ├── [Product Name]
    ├── Your file "guide.pdf" is ready to download
    └── [↓ Download your file]         ← App Proxy URL
```

Each download button links to the App Proxy endpoint which redirects to the Shopify CDN file URL after validation.

---

## Security

### Download Token System

Every file link generated in the merchant dashboard is signed with **HMAC-SHA256**:

```
payload = base64url({ fileId, exp })
token   = payload + "." + HMAC_SHA256(payload, SHOPIFY_API_SECRET)
```

- **File-scoped** — a token for `file-A` cannot access `file-B`.
- **Time-limited** — expires after 1 hour.
- **Timing-safe** — signature comparison uses `crypto.timingSafeEqual` to prevent timing attacks.

### App Proxy

Customer download requests at `/apps/pendora/...` are validated by Shopify's App Proxy HMAC before reaching the app — ensuring only genuine Shopify-originated requests are served.

### Shopify OAuth Scopes

```
write_metaobject_definitions  write_metaobjects
write_products                read_products
write_files                   read_files
read_orders
```

---

## Getting Started

### Prerequisites

- Node.js >= 20.19
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli/getting-started)
- A Shopify Partner account + development store

### Local Setup

```bash
# Clone
git clone https://github.com/gourav-a11y/pendora-shopify-app
cd pendora-shopify-app

# Install dependencies
npm install

# Create the database and run migrations
npm run setup

# Start dev server (opens tunnel + connects to Shopify)
npm run dev
```

Press **P** in the terminal to get the app URL, then install it on your development store.

### Deploy the Extension

```bash
npm run deploy
```

This deploys both the app config (`shopify.app.toml`) and the checkout extension to Shopify.

---

## Environment Variables

`shopify app dev` injects these automatically. Set them manually for production:

| Variable | Description |
|---|---|
| `SHOPIFY_API_KEY` | App client ID from Partner Dashboard |
| `SHOPIFY_API_SECRET` | App secret — also used to sign download tokens |
| `SHOPIFY_APP_URL` | Public URL of the deployed app |
| `DATABASE_URL` | Prisma DB connection string |
| `NODE_ENV` | Set to `production` for production builds |

> `SHOPIFY_API_SECRET` is the signing key for download tokens. Rotate it if compromised — existing tokens will instantly become invalid.

---

## Deployment

### Build

```bash
npm run build
npm run start
```

### Recommended Platforms

| Platform | Notes |
|---|---|
| [Google Cloud Run](https://shopify.dev/docs/apps/launch/deployment/deploy-to-google-cloud-run) | Best documented path for this stack |
| [Fly.io](https://fly.io/docs/js/shopify/) | Fast CLI deploy, single machine |
| [Render](https://render.com/docs/deploy-shopify-app) | Docker-based, works well with SQLite |
| [Railway](https://railway.app/) | Easy PostgreSQL setup |

### Switching from SQLite to PostgreSQL

Update `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Then run:
```bash
npx prisma migrate deploy
```

---

## Troubleshooting

**`The table main.Session does not exist`**
```bash
npm run setup
```

**`Unable to require query_engine-windows.dll.node` (Windows ARM64)**
```bash
PRISMA_CLIENT_ENGINE_TYPE=binary npm run dev
```

**Webhooks failing HMAC validation**
Do not create webhooks from the Shopify Admin UI. Always declare them in `shopify.app.toml` and deploy with `npm run deploy`.

**Download links returning 401 after purchase**
Tokens expire in 1 hour by design. New tokens are generated on every dashboard page load. For customer-facing downloads, always use the App Proxy URL (`/apps/pendora/api/download/:fileId`), not the dashboard preview URL.

**Embedded app navigation breaking**
- Use `Link` from `react-router` — not `<a>`
- Use `redirect` from `authenticate.admin` — not from `react-router`
- Use `useSubmit` from `react-router` for form submissions

---

## License

Private — all rights reserved.
