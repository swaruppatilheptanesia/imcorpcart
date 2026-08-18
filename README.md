# imcorpcart

A B2B **corporate Employee Purchase Program (EPP) commerce platform** — employees of enrolled companies buy
phones, accessories, and bags at negotiated corporate rates. Four role surfaces (Super Admin, Company/HR,
Reseller, Storefront) are served by a single API, with JWT auth (optional OTP 2FA), a public pre-login catalog,
and Razorpay checkout.

## Monorepo layout

```
backend/    Express + TypeScript REST API, Prisma ORM, PostgreSQL
frontend/   Vite + React + TypeScript SPA (four portals + public storefront)
```

The two apps are independent npm packages — run commands from inside each folder.

## Tech stack

- **Backend:** Node.js, Express 5, TypeScript, Prisma (multi-file schema), PostgreSQL, Zod, JWT, Razorpay.
- **Frontend:** React 18, Vite, TypeScript, React Router. No CSS framework — bespoke, token-driven styling.

## Getting started

### Prerequisites
- Node.js 18+ and npm
- A local PostgreSQL instance

### Backend (`cd backend`)

```bash
cp .env.example .env      # set DATABASE_URL, JWT_SECRET, Razorpay keys, etc.
npm install
npm run migrate:deploy    # apply database migrations
npm run db:seed           # seed the Super Admin (and optionally: npx ts-node prisma/test-data.ts)
npm run dev               # start the API on http://localhost:4000 (/api prefix)
```

Build for production:

```bash
npm run build && npm run start
```

Useful scripts: `npm run migrate:dev` (create + apply a migration), `npm run studio` (Prisma Studio),
`npm run prisma:validate` / `npm run prisma:format`.

### Frontend (`cd frontend`)

```bash
npm install
npm run dev        # Vite dev server on http://localhost:5173 (proxies /api and /uploads to the backend)
npm run build      # typecheck + production build to dist/
npm run typecheck  # tsc --noEmit
```

The frontend needs the backend running — all four portals talk to the API through the Vite dev proxy.

## Configuration notes

- Environment is read from `backend/.env` (never committed). See `backend/.env.example` for the full list.
- `OTP_ENABLED` toggles the password→OTP 2FA step; `CHECKOUT_ENABLED` gates online ordering.
- Razorpay is the only checkout gateway — set `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` (blank disables
  checkout while the API still boots).

## License

Proprietary — all rights reserved.
