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

## Attendance from Hospital Roster (shipped)

Hospital **Daily Attendance** loads students from the monthly **Hospital Roster** grid when a matching roster exists:

| Match on | Field posting | Hospital roster |
|---|---|---|
| Batch + Year | schedule.batchId / yearId | roster.batchId / yearId |
| Month | attendance date BS `YYYY-MM-DD` | roster.monthBs `YYYY-MM` |
| Day | day of month from date | cell.day |
| Hospital (preferred) | schedule site name | FieldHospital name |
| Shift | MORNING / DAY / … | DutyShift codes (M→Morning, E→Evening, N→Night, OD/OPD/W→Day) |

- **Off** cells are excluded (not on duty).
- **Leave** cells appear with status pre-filled as Leave.
- Coordinator marks Present / Absent / Late / Leave only; change who is on duty in the roster builder.
- If no matching roster exists, attendance falls back to the previous free pick list.

## Planned next phases
1. Full A3 landscape print CSS matching hospital sheet (logo, prepared/approved signatures)
2. Copy previous week / bulk assign tools
3. Excel/CSV export
4. Notifications (roster published, attendance pending)
5. Dashboard widgets for roster metrics

## How to use
1. Restart backend (new models + routes).
2. Open **Field Management → Hospital Roster**.
3. Add hospitals → (defaults load for depts/shifts) → Create roster → Open builder → assign cells → Save → Lock → Print / Duty Summary.
4. Create a **Hospital Posting** for the same batch, year, and hospital site (name should match).
5. Open **Hospital Posting → Daily Attendance** → pick date + shift → students load from the roster for that day → mark P/A/L → Save.
