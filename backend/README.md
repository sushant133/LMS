# Nepal School ERP

Nepal School ERP is a Nepal-specific, multi-tenant school management system built with a TypeScript MERN stack. It supports Bikram Sambat workflows, bilingual English/Nepali UI, Nepal GPA grading, NPR fee handling, Nepal address hierarchy, and isolated data per school tenant.

## What Changed

- Multi-tenant architecture with `School` as the tenant root
- `SUPER_ADMIN` can create and switch between multiple schools
- `SCHOOL_ADMIN` manages only their own school
- Tenant isolation is enforced in backend middleware and every tenant-bound collection has `schoolId`
- Auth flow now uses:
  - JWT http-only cookie for session
  - http-only active-school cookie for superadmin school context
- First super admin is created with a seed script
- Public self-registration is limited to parent accounts and requires selecting a school

## Stack

- Backend: Node.js, Express, TypeScript, MongoDB, Mongoose, Zod, JWT, http-only cookies
- Frontend: Vite, React 18, TypeScript, Tailwind CSS v4, TanStack Query v5, React Router v6
- Shared package (`backend/shared`): tenant-aware types, Zod schemas, Nepal address dataset, GPA helpers
- Nepal date packages:
  - Frontend: `@munatech/nepali-datepicker`
  - Backend: `nepali-date-converter`

## Tenant Model

- `SUPER_ADMIN`
  - no fixed school
  - can create schools
  - can switch active school context
- `SCHOOL_ADMIN`
  - belongs to one school
  - manages students, teachers, academics, fees, notices, settings, exams, and attendance for that school only
- `TEACHER`, `STUDENT`, `PARENT`
  - belong to exactly one school

Each tenant-bound collection stores `schoolId`, including:

- users except superadmin
- students
- teachers
- classes
- sections
- subjects
- attendance
- exams
- results
- fee structures
- fee collections
- notices
- settings

## Project Layout

```text
school/
├── backend/
│   ├── shared/          # types, schemas, Nepal data (used by frontend + backend)
│   ├── scripts/         # dev helpers (e.g. MongoDB replica-set setup)
│   ├── docs/
│   ├── src/
│   └── ...
└── frontend/
    └── ...
```

## Prerequisites

- Node.js 20+
- npm 10+
- MongoDB 7+ running locally or MongoDB Atlas

> **Important:** This project uses MongoDB transactions. Your MongoDB instance **must** be running as a Replica Set (even in development).
> See [docs/MONGODB-SETUP.md](docs/MONGODB-SETUP.md) for detailed setup instructions.

## Setup

1. Install dependencies in each app:

```bash
cd backend && npm install
cd ../frontend && npm install
```

PowerShell:

```powershell
cd backend; npm install
cd ..\frontend; npm install
```

2. Copy environment files:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

PowerShell:

```powershell
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env
```

3. Configure `backend/.env`:

- `MONGODB_URI` — Must include `?replicaSet=rs0` (see MongoDB setup guide)
- `JWT_SECRET`
- `COOKIE_SECRET`
- `CORS_ORIGINS`
- `DEFAULT_USER_PASSWORD`
- `SUPER_ADMIN_NAME`
- `SUPER_ADMIN_EMAIL`
- `SUPER_ADMIN_PASSWORD`

4. Seed the first super admin:

```bash
cd backend && npm run seed:superadmin
```

5. Start development servers (in separate terminals):

```bash
cd backend && npm run dev
cd frontend && npm run dev
```

Apps:

- Backend: `http://localhost:5000`
- Frontend: `http://localhost:5173`

## Authentication Notes

- Super admins are not created through the public register form.
- Parents can self-register after selecting an active school.
- When a super admin creates a school, the initial school admin is created automatically.
- When a school admin creates students or teachers, those linked user accounts use `DEFAULT_USER_PASSWORD` and are marked to change password later.

## Super Admin Bootstrap Flow

1. Seed super admin
2. Log in as super admin
3. Open `Schools`
4. Create a school with:
   - school information
   - Nepal address
   - initial school admin details
5. Select that school from the top-bar school context selector
6. Start managing tenant-specific data

## Scripts

Backend (`cd backend`):

- `npm run dev`
- `npm run build`
- `npm run typecheck`
- `npm run seed:superadmin`
- `npm run seed:demo`

Frontend (`cd frontend`):

- `npm run dev`
- `npm run build`
- `npm run typecheck`

## API Overview

Base URL: `http://localhost:5000/api`

Auth:

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `POST /auth/active-school`

Schools:

- `GET /schools/public`
- `GET /schools/accessible`
- `GET /schools`
- `POST /schools`

Tenant-scoped modules:

- `GET|POST|PUT|DELETE /students`
- `GET|POST|PUT|DELETE /teachers`
- `GET|POST|PUT|DELETE /academics/classes`
- `GET|POST|PUT|DELETE /academics/sections`
- `GET|POST|PUT|DELETE /academics/subjects`
- `GET|POST /attendance`
- `GET|POST|PUT|DELETE /exams`
- `GET /exams/results/all`
- `POST /exams/results`
- `GET /exams/results/:examId/:studentId/marksheet`
- `GET|POST|PUT|DELETE /fees/structures`
- `GET|POST|DELETE /fees/collections`
- `GET|POST|PUT|DELETE /notices`
- `GET|PUT /settings`
- `GET /dashboard`
- `GET /addresses`

## Cookie and CORS Notes

- Session cookie name is controlled by `COOKIE_NAME`
- Active school context cookie name is controlled by `ACTIVE_SCHOOL_COOKIE_NAME`
- Allowed browser origins are controlled by `CORS_ORIGINS`
- For cross-site HTTPS deployments, set:
  - `COOKIE_SAME_SITE=none`
  - `COOKIE_SECURE=true`

## Nepal-Specific Notes

- Academic year format: `2083/2084`
- BS date format: `YYYY-MM-DD`
- Academic workflows assume Baisakh-based session handling
- GPA grading:
  - `A+`, `A`, `B+`, `B`, `C+`, `C`, `D`, `E`
- NPR currency formatting is used in the UI
- Full Nepal province, district, municipality, and ward dataset is bundled in the shared package

## Verification

From each app directory:

```bash
cd backend && npm run typecheck && npm run build
cd frontend && npm run typecheck && npm run build
```

## Future Enhancements

Research-backed upgrade areas include:
- Nepal IEMIS/EMIS (Flash Reports) compliance requirements from CEHRD/MoEST
- Continuous Assessment System (CAS) expectations from CDC
- Digital payment integration (eSewa + Khalti school solutions)
- Feature sets from Fedena, Gibbon, openSIS and leading Nepali school ERPs

Key high-value upgrade areas identified:
- IEMIS auto-export & rich demographic/infrastructure tracking
- CAS (Continuous Assessment) support beyond exams
- Native eSewa/Khalti fee payments
- Timetable, Homework, Admissions workflow, Library, Transport
- Rich parent portals + document management
- Offline capability (critical for rural Nepal)

Previously noted items (still valid):
- printable PDF receipts and marksheets
- parent-student relationship mapping
- audit logging per tenant
- database-level reporting and analytics per school
