# Field Management — Hospital Roster Upgrade (Phase 1)

## Non-breaking guarantee

- **Community / PHC Posting**, **Hospital Posting**, **Attendance**, **Reports**, and **Admin Monitoring** use the existing `FieldDutySchedule` + `FieldDutyAttendance` pipeline and were **not** modified.
- Hospital Roster is **additive**: new collections and routes under `/field-duty/*` only.

## What shipped (Phase 1)

### Data model
| Collection | Purpose |
|---|---|
| `FieldHospital` | Multi-hospital registry (name, address, contact, coordinator, status) |
| `HospitalDepartment` | ER, OPD, ICU, Lab, … (seeded defaults) |
| `DutyShift` | M/E/N/OD with times + hours (seeded defaults) |
| `HospitalRoster` | Monthly roster header + student list + cell grid |

### API (all under `/field-duty`)
- `GET/POST/PUT/DELETE /hospitals`
- `GET/POST/PUT/DELETE /departments`
- `GET/POST/PUT/DELETE /shifts`
- `GET/POST/PUT/DELETE /hospital-rosters`
- `PUT /hospital-rosters/:id/students`
- `PUT /hospital-rosters/:id/cells` (full replace or merge)
- `POST /hospital-rosters/:id/lock|unlock`
- `GET /hospital-rosters/:id/summary` (duty summary + clinical record)
- `GET /hospital-rosters/:id/day-assignments?day=N` (for attendance integration)

### UI
New tab **Hospital Roster** on Field Management with:
- Hospitals / Departments / Shifts managers
- Create roster (auto-loads batch+year students)
- Roster builder (student × day grid, cell editor, fill/clear row, lock, print)
- Duty summary + clinical duty record tables

## Planned next phases
1. Full A3 landscape print CSS matching hospital sheet (logo, prepared/approved signatures)
2. Copy previous week / bulk assign tools
3. Attendance from roster day-assignments (coordinator marks Present/Absent only)
4. Excel/CSV export
5. Notifications (roster published, attendance pending)
6. Dashboard widgets for roster metrics

## How to use
1. Restart backend (new models + routes).
2. Open **Field Management → Hospital Roster**.
3. Add hospitals → (defaults load for depts/shifts) → Create roster → Open builder → assign cells → Save → Lock → Print / Duty Summary.
