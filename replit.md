# Workspace

## Overview

pnpm workspace monorepo using TypeScript. IT Asset Management (ITAM) system with role-based access control.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Frontend**: React + Vite (Wouter routing, TanStack Query, shadcn/ui)
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **Authentication**: JWT (bcryptjs + jsonwebtoken)
- **API codegen**: Orval (from OpenAPI spec)

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server
│   └── itam/               # IT Asset Management React frontend
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## ITAM Application

### User Roles
- **General User** - view own assigned assets, create/view own tickets
- **Support Staff** - view all assets, manage all tickets (claim, update, comment)
- **Administrator** - full access, user management, categories, system settings

### Demo Accounts (password: "password")
- admin@itam.com (Administrator)
- staff@itam.com (Support Staff)
- user@itam.com (General User)
- jane@itam.com (General User)

### API Routes
- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Register
- `GET /api/auth/me` - Get current user
- `GET/POST /api/assets` - List/create assets
- `GET/PUT/DELETE /api/assets/:id` - Asset CRUD
- `GET/POST /api/tickets` - List/create tickets
- `GET/PUT /api/tickets/:id` - Ticket detail/update
- `POST /api/tickets/:id/comments` - Add comment
- `GET/PUT /api/users` - User management (admin)
- `PUT /api/users/profile` - Update own profile
- `GET/POST /api/categories` - Category management
- `GET /api/dashboard/stats` - Dashboard statistics

### Database Schema
- `users` - User accounts with roles
- `assets` - IT assets with categories and statuses
- `tickets` - Support tickets with priority/status
- `ticket_comments` - Ticket comments thread
- `categories` - Dynamic dropdown values

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Auth via JWT (bcryptjs). All routes require authentication except /auth/login and /auth/register.

### `artifacts/itam` (`@workspace/itam`)

React + Vite frontend. Auth state managed via AuthContext. Routes protected by role. Token stored in localStorage.

### `lib/db` (`@workspace/db`)

Drizzle ORM with PostgreSQL. Schema: users, assets, tickets, ticket_comments, categories.

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI 3.1 spec for the ITAM API. Run codegen: `pnpm --filter @workspace/api-spec run codegen`
