# PHIT ERP — Library Management Module  
## Phase 1: Complete Technical & Functional Audit Report

| Field | Value |
|-------|--------|
| **Institution** | Public Himal Institute of Technology (PHIT) |
| **Module** | Library Management |
| **Scope** | HA College library — integrated ERP audit |
| **Audit date** | 2026-07-13 |
| **Codebase inspected** | `backend/src`, `backend/shared/src`, `frontend/src` |
| **Approach** | Evidence-based only — no assumed features |

---

## 1. Executive Summary

The Library module **exists and is operational** as a **basic quantity-based catalog + issue/return** system. It is **not** a full college library management system for a Health Assistant (HA) program.

### Maturity snapshot

| Area | Maturity | Verdict |
|------|----------|---------|
| Catalog (quantity inventory) | Partial | Works, but **violates** mandatory one-physical-book rule |
| Issue / Return | Partial | Core flows work; fines, scan, staff borrow incomplete |
| Student / Teacher linkage | Partial | Uses ERP IDs; no member table (good); weak search/UX |
| Staff (CollegeStaff) borrow | Missing | Not supported |
| Authors / Publishers / Categories / Vendors as entities | Missing | Free-text only (or Accounting Vendor only) |
| Barcode / Book Code | Missing | Not in schema |
| Renewal / Reservation | Missing | — |
| Fine engine + Accounting post | Missing | Manual field exists; UI hard-codes fine to 0 |
| Reports (PDF/Excel/Print) | Missing | — |
| Library clearance (TC/graduation) | Missing | — |
| Audit log for library mutations | Missing | `recordAudit` not used in library controller |
| Roles (Librarian vs Assistant) | Partial | Single `LIBRARY_STAFF` role |

**Strategic recommendation:** Extend and refactor the existing module (reuse issue/return, notifications, student profile tab, module access). Do **not** replace the whole module. **Must redesign book inventory** from quantity-based titles to **one physical book = one record**.

---

## 2. What Exists (Verified Inventory)

### 2.1 Backend surface

| Path | Purpose |
|------|---------|
| `backend/src/models/LibraryBook.ts` | `LibraryBook` + `LibraryIssue` Mongoose models |
| `backend/src/controllers/libraryController.ts` | Dashboard, books CRUD, issues, return, my-books, staff CRUD |
| `backend/src/routes/libraryRoutes.ts` | REST routes under `/library` |
| `backend/src/utils/libraryNotifications.ts` | Due-soon / due-today / overdue status + notifications |
| `backend/src/utils/libraryInventoryAccess.ts` | Admin toggle for inventory write by staff |
| `backend/src/utils/inventory.ts` | Stock status enrichment (`AVAILABLE` / `LOW_STOCK` / …) |
| `backend/shared/src/module-schemas.ts` | Zod: `libraryBookSchema`, `libraryIssueSchema`, `libraryReturnSchema` |
| `backend/shared/src/module-types.ts` | Shared TypeScript types |
| `backend/shared/src/module-access.ts` | Module key `library` + `inventory` |

### 2.2 Frontend surface

| Path | Purpose |
|------|---------|
| `frontend/src/pages/LibraryPage.tsx` | Admin/staff library page |
| `frontend/src/pages/MyLibraryPage.tsx` | Student/Teacher portal |
| `frontend/src/features/library/LibraryManager.tsx` | Dashboard, inventory, issue, staff tabs |
| `frontend/src/features/library/LibraryReturnsPanel.tsx` | Returns + history |
| `frontend/src/features/library/LibraryPortal.tsx` | Borrower self-view |
| `frontend/src/features/library/libraryUtils.ts` | Active status helpers + client search |
| `frontend/src/features/library/StockStatusBadge.tsx` | Stock badge UI |
| `frontend/src/features/students/StudentProfileView.tsx` | Library tab on student profile |
| Routes in `App.tsx` | `/library`, `/my-library` |
| Nav in `AppLayout.tsx` | Library for admins + `LIBRARY_STAFF`; My Library for student/teacher |

### 2.3 API endpoints (verified)

| Method | Endpoint | Roles | Function |
|--------|----------|-------|----------|
| GET | `/library/dashboard` | COLLEGE_ADMIN, LIBRARY_STAFF (+ SUPER_ADMIN bypass) | Totals + recent issues |
| GET/PUT | `/library/inventory-access` | GET: admin/staff; PUT: institution admin | Freeze inventory writes |
| GET/POST | `/library/books` | Admin/staff | List / create books |
| PUT/DELETE | `/library/books/:id` | Admin/staff | Update / delete (block if active issues) |
| GET | `/library/issues?status=` | Admin/staff | List issues (`active` / `returned` / all) |
| POST | `/library/issues` | Admin/staff | Issue book |
| PUT | `/library/issues/:id/return` | Admin/staff | Return book |
| GET | `/library/my-books` | STUDENT, TEACHER | Own issues + reminder side-effects |
| GET/POST/PUT/DELETE | `/library/staff` | Institution admin | Library staff user accounts |

### 2.4 Data models (as implemented)

**LibraryBook**

- `schoolId`, `title`, `author` (string), `isbn` (optional), `category` (string), `totalCopies`, `availableCopies`, `shelfLocation` (optional)
- Timestamps
- **No** book code, barcode, publisher, edition, subject, language, year, pages, description, purchase metadata, vendor, rack, condition, source, cover, status (lost/damaged/etc.)

**LibraryIssue**

- `schoolId`, `bookId`, `borrowerType` (`STUDENT` | `TEACHER`), `studentId`, `teacherId`
- `issuedDateBs`, `dueDateBs`, `returnedDateBs`, `fineNpr`, `status` (`ISSUED` | `RETURNED` | `OVERDUE`)
- **No** remarks, renewal count, reservation link, fine payment status, staff borrower, damage/lost flags

---

## 3. Current Features — Working

These were verified in code and are considered **working for their current scope**.

### 3.1 Catalog / inventory (quantity model)

1. Create book with title, author, category, optional ISBN, total copies  
2. Update book fields and adjust total copies (cannot set total below currently issued)  
3. Delete book only when no active issues  
4. List inventory with computed `issuedCopies` and stock status badge  
5. Admin **inventory access freeze** for library staff (`libraryInventoryAccess.enabled`, default **false**)  
6. Per-user module access: `library` and `inventory` READ_ONLY / WRITE  

### 3.2 Issue books

1. Select available title (by remaining `availableCopies`)  
2. Borrower type: Student or Teacher  
3. Link to existing `Student` / `Teacher` records (no separate library member table)  
4. Nepali BS issue & due dates  
5. Decrements `availableCopies`  
6. In-app (+ SMS stub) notifications to borrower; parents notified for students  

### 3.3 Return books

1. List active issues; select and confirm return with BS date  
2. Client search by book title or borrower name  
3. Return history list  
4. Blocks return date before issue date  
5. Increments `availableCopies`  
6. Prevents double-return (only `ISSUED`/`OVERDUE` can be returned)  
7. Notifications on return  

### 3.4 Overdue handling & reminders

1. Status sync: marks overdue when today BS > due date  
2. Reminders: day-before due, due today, overdue  
3. Deduped per reminder type via notification metadata  
4. Triggered on dashboard, issue lists, and my-books  

### 3.5 Dashboard (library staff)

1. Widgets: Total Books (sum of copies), Available, Issued, Overdue  
2. Recently issued table (last 8) with student name links  

### 3.6 Borrower portals

1. **My Library** (`/my-library`): students and teachers see current borrows + history  
2. **Student profile Library tab**: pending count, fine total, issue history (view-only for library staff/admins/student/parent)  

### 3.7 Library staff accounts

1. Admins create `LIBRARY_STAFF` users with credentials email flow  
2. Deactivate staff (`isActive: false`)  
3. List staff accounts  

### 3.8 Cross-module hygiene

1. Cascade delete of issues when student/teacher/school deleted  
2. Tenant scoping on queries (`schoolId`)  
3. Auth: JWT + role authorize; SUPER_ADMIN bypass  
4. Zod validation on book/issue/return payloads  
5. Module access guard on writes  

### 3.9 Accounting scaffold only (not wired to fines)

1. Chart of accounts includes **Library Fee Income** system account  
2. Expense category map includes `"Library"` → general expense  
3. **No** library fine posting to ledger found  

---

## 4. Incomplete Features

| Feature | Exists as | Gap |
|---------|-----------|-----|
| Book registration | Title-level quantity | Must become **one physical copy = one record**; many registration fields missing |
| Category | Free-text string | No Category master CRUD; no HA medical taxonomy |
| Author | Free-text string | No Author master, profile, or multi-author link |
| Shelf location | Schema field | **Not exposed** in Add/Edit book form UI |
| Fine on return | `fineNpr` in schema + API | Returns UI **always sends `fineNpr: 0`**; no calculation UI |
| Fine on student profile | Sum of `fineNpr` | No payment status; unpaid vs paid not tracked |
| Student selection on issue | Dropdown of names | No search by Student ID, roll, reg no, phone; no photo/profile panel |
| Teacher selection | Name dropdown | No employee ID / department search; no photo panel |
| Inventory statuses | Stock quantity only | No Lost / Damaged / Reserved / Maintenance book states |
| Dashboard | 4 counters + recent | Missing reserved, lost, damaged, fine collection, monthly stats |
| Staff management UI | Create + list | Update password/profile UI incomplete vs API; no soft role split |
| Notifications | In-app + SMS stub | Channel `"BOTH"` does not send email; SMS is stub |
| Search | Client filter on returns only | No catalog search by code/ISBN/author/publisher; no server-side indexes for search |
| Reports | None | Issue/return/fine/inventory reports and export missing |
| Student profile library | Read-only history | No issue/return/renew actions from profile |
| Module roles | Single LIBRARY_STAFF | No Assistant Librarian; Teacher/Student only self-view |

---

## 5. Missing Features

### 5.1 Mandatory inventory rule (critical gap)

**Required:** One physical book = one record; manual unique Book Code/Barcode; per-copy status and history.  

**Actual:** Quantity model (`totalCopies` / `availableCopies`). Demo seed: one title with 5 copies, one issue against the title — **not** five physical records.

### 5.2 Book registration fields (missing unless noted)

| Field | Status |
|-------|--------|
| Book Title | Present |
| Author | Present (string only) |
| Category | Present (string only) |
| ISBN | Present (optional) |
| Shelf Number | Partial (`shelfLocation`, no UI) |
| Subtitle | Missing |
| Manual Book Code / Barcode | Missing |
| Publisher | Missing |
| Edition | Missing |
| Subject | Missing |
| Language | Missing |
| Publication Year | Missing |
| Number of Pages | Missing |
| Description | Missing |
| Purchase Date | Missing |
| Price | Missing |
| Vendor | Missing (Accounting has Vendor model, not linked) |
| Rack Number | Missing |
| Condition | Missing |
| Source (Purchased/Donation) | Missing |
| Status (Available/Issued/Lost/…) | Missing at copy level |
| Book Cover Image | Missing |

### 5.3 Master data

- Author management (CRUD, profile, book links)  
- Publisher management  
- Category management (HA examples: Anatomy, Physiology, Pharmacology, …)  
- Vendor management **for library purchases** (Accounting vendors are separate and not library-linked)  
- Purchase history per book/vendor  

### 5.4 Identification & scanning

- Manual barcode storage  
- Uniqueness validation for book code/barcode  
- USB barcode scanner flow  
- Camera scanner  
- Issue/return by scanning book code  

### 5.5 Circulation

- Staff (CollegeStaff) as borrower  
- Issue remarks  
- Prevent issue to inactive/suspended/blocked students (configurable)  
- Prevent duplicate active issue of same physical book (N/A under quantity model; still no “same title multiple times” policy)  
- Book renewal + limits + renewal history  
- Reservation, waiting queue, cancel, availability notification  

### 5.6 Fines

- Daily fine rate config  
- Grace period  
- Lost book fine  
- Damage fine  
- Manual adjustment with reason  
- Fine payment status  
- Auto post to student fee/ledger  
- Payment via Accounting  
- Printable fine receipts  
- Sync library records after payment  

### 5.7 Inventory views

- Available / Issued / Reserved / Lost / Damaged / Maintenance **as first-class states**  
- Per-copy lifecycle  

### 5.8 Reports

- Issue, Return, Fine, Inventory, Lost Book, Student, Teacher reports  
- PDF / Excel / Print  

### 5.9 Dashboard widgets (missing)

- Reserved, Lost, Damaged counts  
- Fine collection total  
- Monthly statistics / charts  

### 5.10 Student integration enhancements

- Search by Student ID, Roll, Registration No, Full Name, Phone  
- After select: photo, IDs, program/batch/year/section, academic status  
- Side panel: current issues, history, overdue, outstanding fines, reservations  
- Configurable block on inactive/blocked students  

### 5.11 Teacher & Staff integration

- Teacher: employee ID, department search, photo, designation, history  
- College Staff borrow integration (model only supports STUDENT/TEACHER)  

### 5.12 Student profile actions

- Issue / Return / Renew from profile  
- Lost / Damaged / Reserved book views  

### 5.13 Library clearance

- Block Transfer Certificate when books outstanding (configurable)  
- Block graduation clearance with dues (configurable)  
- Show pending dues in final clearance  

### 5.14 Notifications gaps

- Reservation available  
- Fine notifications as dedicated fine events  
- Email delivery for library events (if configured)  

### 5.15 Roles

- Distinct Assistant Librarian vs Librarian permissions  
- Student/Teacher self-service limited as specified (portal exists; no reservation self-service)  

### 5.16 Audit log

- No `recordAudit` calls in `libraryController` for create/update/delete/issue/return/fine  

---

## 6. Bugs & Issues

### 6.1 Logic bugs

| ID | Severity | Description |
|----|----------|-------------|
| L-01 | **Critical** | **Quantity inventory** conflicts with mandatory one-physical-book rule; issue history is per title, not per copy. |
| L-02 | High | **Race on issue:** read `availableCopies` → decrement → save is not atomic; concurrent issues can oversell stock. |
| L-03 | High | **No due ≥ issue validation** on issue create (only return date ≥ issue date on return). |
| L-04 | Medium | **No academicStatus check** when issuing to students (SUSPENDED/WITHDRAWN/etc. can still receive books). |
| L-05 | Medium | **Fines never applied from UI** (`fineNpr: 0` hardcoded in `LibraryReturnsPanel`). |
| L-06 | Medium | **Fine total on profile** sums all historical `fineNpr` with no paid/unpaid distinction. |
| L-07 | Medium | **Overdue reminder on every sync** for overdue books is deduped by type once, but `syncSchoolLibraryOverdueStatuses` runs on many GET endpoints — performance cost, not duplicate spam (dedupe helps). Parent notify paths may not share the same metadata dedupe as borrower reminders. |
| L-08 | Low | **`availableCopies` can exceed `totalCopies`** if data is manually corrupted (no DB constraint); return only increments. |
| L-09 | Low | Issue create does not use Mongo transactions; partial failure after decrement could desync counts. |

### 6.2 UI bugs / UX issues

| ID | Severity | Description |
|----|----------|-------------|
| U-01 | Medium | `shelfLocation` in API/schema but **no form field** to set it. |
| U-02 | Medium | Issue student/teacher selectors are **unsearchable full lists** — unusable at college scale. |
| U-03 | Medium | No loading / empty / error states on main inventory tables beyond raw query defaults. |
| U-04 | Low | Return history omits fine and status columns. |
| U-05 | Low | Dashboard does not show inventory freeze status to non-admins clearly on first tab. |
| U-06 | Low | Delete book has no confirmation dialog. |

### 6.3 API bugs / gaps

| ID | Severity | Description |
|----|----------|-------------|
| A-01 | Medium | `listBooks` / `listIssues` load **entire collections** — no pagination, no server-side filter. |
| A-02 | Medium | `formatIssue` leaves populated `bookId` object in response while type says string — clients must tolerate both. |
| A-03 | Low | Staff update/delete APIs exist but staff UI only creates/lists. |
| A-04 | Low | No API for renew, reserve, fine adjust, reports, barcode lookup. |

### 6.4 Validation issues

| ID | Severity | Description |
|----|----------|-------------|
| V-01 | Medium | Category free-text — typos create fragmented inventory. |
| V-02 | Medium | ISBN not unique and not format-validated. |
| V-03 | High (vs policy) | No book code uniqueness (field absent). |
| V-04 | Low | `totalCopies` min 1 but no max; large bulk quantity hides individual tracking. |

### 6.5 Security issues

| ID | Severity | Description |
|----|----------|-------------|
| S-01 | Medium | **No library mutation audit trail** (compliance gap vs other modules using `recordAudit`). |
| S-02 | Low–Med | Inventory freeze is settings-based; admins always write — OK. Module READ_ONLY is enforced globally — OK. |
| S-03 | Low | Zod + Mongoose reduce injection risk; ensure any future free-text search uses parameterized queries (current Mongo ODM usage is fine). |
| S-04 | Low | Cover/upload security N/A until cover images added — design must reuse existing upload middleware. |
| S-05 | Info | Tenant scope consistently applied — good. |

### 6.6 Performance issues

| ID | Severity | Description |
|----|----------|-------------|
| P-01 | High | Dashboard loads **all books** and **all active issues** into memory to compute sums. |
| P-02 | High | `syncSchoolLibraryOverdueStatuses` on dashboard / list issues / my-books can N+1 process issues with notifications. |
| P-03 | Medium | Issue form loads **all students** and **all teachers** for dropdowns. |
| P-04 | Medium | No compound indexes on `LibraryIssue` for `(schoolId, status)`, `(schoolId, studentId)`, `(schoolId, bookId)`. |
| P-05 | Low | Client-side only filter on returns. |

---

## 7. Database Review

### 7.1 Current design assessment

| Practice | Assessment |
|----------|------------|
| Tenant isolation | Good — `schoolId` required + indexed on both models |
| Normalization | Poor for library domain — author/category as strings; quantity conflates title and copies |
| Relationships | Partial — `bookId`, `studentId`, `teacherId` refs exist; no author/publisher/vendor refs |
| Constraints | Weak — no unique book code; no check `availableCopies ≤ totalCopies`; issue borrower XOR not DB-enforced (only Zod) |
| Indexes | Insufficient — only `schoolId` on books/issues; seed calls `syncIndexes()` but no compound indexes defined |
| Duplicate data | Author names duplicated per title; categories inconsistent free text |
| Soft delete | Not used on books (hard delete) |

### 7.2 Recommended schema direction (preserve data; migrate carefully)

**Keep** multi-tenant `schoolId` pattern used across PHIT ERP.

**Introduce (conceptually):**

1. **`LibraryTitle` (or keep metadata on first copy + title group)**  
   - Shared bibliographic data: title, subtitle, ISBN, authors[], publisher, edition, subject, categoryId, language, year, pages, description, coverUrl  

2. **`LibraryBookCopy` (physical unit — mandatory)**  
   - `titleId`, **manual `bookCode` unique per school**, optional `barcode` unique  
   - `shelfNo`, `rackNo`, `condition`, `source`, `purchaseDateBs`, `priceNpr`, `vendorId`  
   - `status`: `AVAILABLE` | `ISSUED` | `RESERVED` | `LOST` | `DAMAGED` | `MAINTENANCE`  
   - One issue points to **copyId**, not title quantity  

3. **Masters**  
   - `LibraryCategory`, `LibraryAuthor`, `LibraryPublisher` (or reuse Accounting `Vendor` for vendors only)  

4. **`LibraryIssue` enhancements**  
   - `copyId`, `remarks`, `renewalCount`, `fineStatus` (`NONE`|`PENDING`|`PAID`|`WAIVED`), `borrowerType` include `STAFF`, `staffId`  

5. **`LibraryReservation`**, **`LibraryFine`**, **`LibraryRenewal`** as needed  

6. **Indexes**  
   - `{ schoolId: 1, bookCode: 1 }` unique  
   - `{ schoolId: 1, barcode: 1 }` unique sparse  
   - `{ schoolId: 1, status: 1 }` on copies and issues  
   - `{ schoolId: 1, studentId: 1, status: 1 }` on issues  
   - Text indexes if Mongo Atlas Search / text index on title, author  

### 7.3 Migration note

Existing quantity titles must be expanded: for each book with `totalCopies = N`, create N copy records with librarian-entered codes (or temporary migration codes + force re-label). Historical issues map to one arbitrary copy or remain title-level legacy — prefer **cutover with librarian verification** for HA college data integrity.

---

## 8. UI/UX Improvements

1. **Redesign Inventory** around physical copies: register one copy at a time; bulk-register with multiple manual codes in one form (still N records).  
2. **Searchable borrower picker** (typeahead) with photo, IDs, program, status.  
3. **Barcode-first issue/return** (USB scanner focuses input; Enter submits).  
4. **Fine panel** on return: calculated suggestion + override + reason.  
5. **Catalog filters**: category, status, author, shelf, availability.  
6. **Consistent empty/loading/error** states; confirm destructive actions.  
7. **Expose shelf/rack** and condition on forms.  
8. **Reports tab** with date range + export buttons (mirror Academic/Accounting patterns).  
9. **Mobile-friendly** tables (card layout on small screens) for issue/return on counter devices.  
10. **Accessibility**: labels on selects, focus management after scan, color not sole status indicator (already partially using badges).  

---

## 9. Security Recommendations

1. Call **`recordAudit`** on every library mutation (book CRUD, issue, return, fine change, status change).  
2. Enforce **authorization matrix** for Assistant Librarian (e.g. no delete catalog, no staff admin).  
3. On issue: validate student `academicStatus` and user `isActive` (configurable settings).  
4. Keep **tenant guards** on all new endpoints.  
5. Unique indexes on book codes to prevent duplicate physical IDs.  
6. Cover image uploads: reuse existing upload validation (type, size, tenant path).  
7. Rate-limit scan endpoints if added for public kiosks.  
8. Never trust client-only fine amount without server rules (allow override with audit).  

---

## 10. Performance Improvements

1. Replace full-collection dashboard with **aggregations** (`$group` on copies by status; count issues by status).  
2. Move overdue sync to a **scheduled job** (or single admin-triggered job), not every GET.  
3. Paginate books, issues, history.  
4. Server-side search with indexes.  
5. Borrower typeahead API (`/students?q=`) instead of loading all.  
6. Atomic stock updates: `findOneAndUpdate({ availableCopies: { $gt: 0 } }, { $inc: { availableCopies: -1 } })` until copy-level redesign.  
7. After redesign: issue only if copy status is `AVAILABLE`, set `ISSUED` atomically.  

---

## 11. ERP Integration Review

| Module | Current state | Required improvement |
|--------|---------------|----------------------|
| **Students** | Issues reference `studentId`; profile Library tab; no separate members | Rich search + status gate + actions from profile; no duplicate members (already OK) |
| **Teachers** | `teacherId` borrow + My Library | Employee ID / department display; history on teacher profile |
| **College Staff** | Not integrated | Add `STAFF` borrower type → `CollegeStaff` |
| **Accounting** | COA has Library Fee Income; no auto post | Post fines to student receivable / fine income; pay via fees; receipt; mark fine paid |
| **Authentication** | Roles + module access | Split librarian permissions; ensure STUDENT cannot hit staff APIs (already blocked) |
| **Notifications** | Issue/return/overdue | Add reservation + fine; wire email if channel supports it; keep parent notify |
| **Dashboard (global)** | Link to Library Management | Optional global widgets for admins |
| **Settings** | Inventory freeze + infra libraryBooks count (IEMIS) | Fine rates, grace period, clearance flags, max books per student |
| **Academic / Documents** | TC document type exists elsewhere | Hook clearance checks before TC / graduation |
| **Audit** | Used widely elsewhere | Library must adopt same pattern |
| **Vendors** | Accounting vendors | Link purchase source for books |

**Positive:** No separate library membership registration — design already aligns with mandatory ERP student/teacher linkage.

---

## 12. Feature Checklist (Requirement Traceability)

| Requirement area | Status |
|------------------|--------|
| One physical book = one record | **Fail** (quantity model) |
| Manual unique book code | **Missing** |
| Book registration field set | **Partial** (~4/20+ fields) |
| Category CRUD | **Missing** (free text) |
| Author management | **Missing** |
| Publisher management | **Missing** |
| Vendor management (library) | **Missing** |
| Multi-field search | **Missing** |
| Barcode scan | **Missing** |
| Issue student/teacher | **Partial** |
| Issue staff | **Missing** |
| Return + history | **Partial** (works; fines weak) |
| Fine calculation | **Missing** |
| Renewal | **Missing** |
| Reservation | **Missing** |
| Inventory statuses | **Partial** (qty stock only) |
| Reports PDF/Excel | **Missing** |
| Dashboard widgets | **Partial** |
| Student integration | **Partial** |
| Teacher/staff integration | **Partial / Missing** |
| Profile library section | **Partial** (read-only) |
| Library clearance | **Missing** |
| Accounting integration | **Missing** (COA placeholder only) |
| Notifications | **Partial** |
| Roles & permissions | **Partial** |
| Audit log | **Missing** for library actions |

---

## 13. Priority-wise Action Plan

### High priority

1. **Redesign inventory to physical copies** (manual book code, unique barcode optional, one record per copy).  
2. **Data migration strategy** for existing quantity-based books + historical issues.  
3. **Atomic issue/return** against copy status.  
4. **Server-side overdue job** + stop heavy sync on every GET (or heavily cache).  
5. **Borrower typeahead** + academic status gate for students.  
6. **Fine engine (basic):** daily rate + grace + manual override on return; show fine in UI.  
7. **`recordAudit`** on all library mutations.  
8. **Indexes** for schoolId+status, schoolId+bookCode, schoolId+studentId.  

### Medium priority

1. Category / Author masters (start with Category + free-text author multi-select later).  
2. Extended bibliographic & purchase fields; shelf/rack UI; cover image.  
3. Staff borrower support.  
4. Student profile library actions (issue/return/renew).  
5. Reports: issue, return, inventory, overdue (Excel first, then PDF).  
6. Dashboard: lost/damaged/fine collection (after statuses exist).  
7. Accounting post for unpaid fines + payment reconciliation.  
8. Barcode USB scan UX on issue/return.  
9. Assistant Librarian permission split via module access or sub-roles.  

### Low priority

1. Reservation queue + auto notify when available.  
2. Renewal limits & history.  
3. Camera barcode scanner.  
4. Publisher master + vendor purchase history reports.  
5. Monthly statistics charts.  
6. Library clearance hooks for TC / graduation.  
7. Email channel for library notifications.  
8. Advanced accessibility polish and mobile counter mode.  

---

## 14. Implementation Roadmap (Safe Sequence)

Goal: **do not break** existing issue/return while moving to physical copies.

### Phase A — Stabilize (no schema break)

1. Add compound indexes; paginate list APIs.  
2. Fix due-date ≥ issue-date validation.  
3. Atomic `$inc` for availableCopies.  
4. Expose shelf field; stop hardcoding fine to 0; add optional fine input.  
5. Audit logging.  
6. Extract overdue processing to background/cron.  
7. Student/teacher typeahead endpoints reuse.  

### Phase B — Physical copy model (core redesign)

1. Add `LibraryBookCopy` (or rename model carefully) with `bookCode` unique per school.  
2. Keep old `LibraryBook` as **title/metadata** or rename to `LibraryTitle`; migrate fields.  
3. Dual-write period optional: new issues prefer copyId; read APIs return both until UI cutover.  
4. Librarian tooling: “Split title into N copies” wizard requiring manual codes.  
5. Switch issue UI to pick/scan copy; hide quantity create path.  
6. Backfill migration script + report of incomplete codes.  

### Phase C — Circulation depth

1. Fine rules in Settings; auto-calculate on return.  
2. Renewal API with limits.  
3. Lost/Damaged status workflows.  
4. Staff borrowers.  
5. Profile-side actions.  

### Phase D — Integration & compliance

1. Post fines to Accounting; payment webhook/status sync.  
2. Clearance checks for TC/graduation (feature flags).  
3. Reports PDF/Excel/Print.  
4. Reservations + notifications.  
5. Role matrix for Assistant Librarian.  

### Phase E — Polish

1. Camera scan, advanced search, dashboard analytics, HA category seed pack.  

**Dependencies:** Phase C fines/accounting depend on copy-level identity (Phase B). Clearance depends on accurate outstanding issue query (B). Reports can start on current schema (A) but should target copy model (B).

---

## 15. Reuse Guidance (Do Not Rewrite Unnecessarily)

| Keep & extend | Replace / redesign |
|---------------|-------------------|
| `LibraryIssue` workflow + statuses | Quantity fields as source of truth |
| Notification helpers | — |
| Inventory access freeze pattern | — |
| Module access keys `library` / `inventory` | — |
| Student profile library tab | Expand with actions |
| My Library portal | Expand with fines/reservations later |
| Staff account management | Role split later |
| Shared Zod + types pattern | Expand schemas |
| UI kit (PageHeader, tables, NepaliDateField) | New forms for copy registration |
| Tenant + auth middleware | — |

---

## 16. Evidence Index (Primary Files)

| Concern | File |
|---------|------|
| Models | `backend/src/models/LibraryBook.ts` |
| Controller | `backend/src/controllers/libraryController.ts` |
| Routes | `backend/src/routes/libraryRoutes.ts` |
| Schemas | `backend/shared/src/module-schemas.ts` |
| Types | `backend/shared/src/module-types.ts` |
| Notifications | `backend/src/utils/libraryNotifications.ts` |
| Inventory access | `backend/src/utils/libraryInventoryAccess.ts` |
| Stock helper | `backend/src/utils/inventory.ts` |
| Manager UI | `frontend/src/features/library/LibraryManager.tsx` |
| Returns UI | `frontend/src/features/library/LibraryReturnsPanel.tsx` |
| Portal | `frontend/src/features/library/LibraryPortal.tsx` |
| Student profile | `frontend/src/features/students/StudentProfileView.tsx`, `backend/src/controllers/studentProfileController.ts` |
| Seed example | `backend/src/seed/demoSchool.ts` (quantity book + one issue) |
| Module access | `backend/shared/src/module-access.ts` |
| Accounting COA | `backend/shared/src/accounting-constants.ts` |
| Audit utility (unused by library) | `backend/src/utils/audit.ts` |

---

## 17. Conclusion

The PHIT Library module is a **working MVP**: multi-tenant catalog with quantity stock, student/teacher issue-return, overdue reminders, basic dashboard, staff accounts, and student profile visibility.

It is **not yet suitable** as the centralized HA college library system described in the product requirements. The **single most important architectural change** is abandoning quantity-based physical inventory in favor of **one record per physical book with librarian-entered unique book codes**, then layering fines, accounting, clearance, reports, and advanced circulation on that foundation.

**Recommended next step after this audit:** Phase A stabilization PR, then a short design note for Phase B schema + migration, approved before any mass data rewrite.

---

*End of Phase 1 Audit Report — generated from codebase inspection only.*
