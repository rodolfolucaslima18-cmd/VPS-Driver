---
name: Auth migration — Clerk → self-hosted
description: VPS Drive auth system replaced; how session auth works now.
---

Auth was fully migrated from Clerk to self-hosted email+password.

**Stack:** express-session + connect-pg-simple (sessions table) + bcryptjs. No external auth services.

**Why:** Project requirement for fully self-hosted operation without Clerk API keys.

**How to apply:**
- Backend routes use `req.session.userId` and `req.session.role` (typed in `express-session.d.ts`)
- `requireAuth` middleware checks `req.session.userId`; `requireMaster` checks `req.session.role === "master"`
- Frontend uses `AuthProvider` + `useAuth()` hook from `src/lib/auth.tsx` (calls `/api/auth/me`)
- Admin panel creates users via POST `/api/admin/users` (name+email+password); no invite system
- Master user is identified by `role === "master"` in DB (not by array index or Clerk ID)
- SESSION_SECRET env var is required; defaults to hardcoded string in dev
