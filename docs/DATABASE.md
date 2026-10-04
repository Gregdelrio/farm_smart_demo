# FarmSmart database, table by table

> Status: planned schema, **not installed yet** on Supabase. The script runs once, at the same time as the updated tile code goes live.

Backup: before changing anything, the script copies every old table untouched into a separate `backup_001` schema (not reachable from the app). Delete it with `drop schema backup_001 cascade;` once the new app has run fine for a while.

Source: [001_simplified_schema.sql](../supabase/migrations/001_simplified_schema.sql). PK = primary key (what uniquely identifies a row). FK = foreign key (a column pointing to a row of another table; the database rejects a link to a row that does not exist).

## 1. Tables and columns

### companies: the client company
| Column | Meaning |
|---|---|
| `id` | PK, automatic unique id (UUID) |
| `name` | Name: Moloney Sharefarming Trust |
| `state` | Australian state (VIC): picks the public holidays |
| `xero_tenant_id` | Xero organisation id, set when Xero is connected |
| `pay_anchor` | A Monday that starts a pay fortnight (2026-09-14) |
| `ot_threshold_hours` | Overtime threshold: 152 h |
| `cycle_days` | Overtime cycle length: 28 days |
| `weekly_days_off` | Roster: days off per week |
| `couple_shared_day_off` | Roster: couples share their day off |
| `created_at`, `updated_at` | Creation and last-change times |

### farms: the farms
| Column | Meaning |
|---|---|
| `id` | PK |
| `company_id` | FK → companies: which company owns the farm |
| `code` | Readable short name (`maguires`), unique within the company |
| `name` | Display name |
| `farm_type` | Dairy by default |
| `owner_first_name` | Landowner's first name (Peter, John, Damian) |
| `herd_size` | Herd size |
| `road_name` | Road (Road Crossing tile) |
| `lat`, `lng` | GPS position of the farm centre (Shift Clock, Farm Plan) |
| `color` | Colour in the Roster |
| `min_staff`, `ideal_staff`, `max_staff` | Roster: minimum, ideal and maximum staff. Check: min ≤ ideal ≤ max |
| `exempt_from_minimum` | Roster: the farm may go below its minimum |
| `sort_order` | Display order |
| `active` | False = retired farm (never deleted) |
| `updated_at` | Last change |

### employees: the employees
| Column | Meaning |
|---|---|
| `id` | PK |
| `company_id` | FK → companies |
| `code` | Readable short name (`greg`), unique within the company |
| `preferred_name` | Displayed first name |
| `partner_id` | FK → employees: their partner, if they also work here |
| `employment_type` | `casual` or `permanent` (only accepted values) |
| `classification` | Award level (FLH1) |
| `xero_employee_id` | Their Xero id, unique |
| `app_role` | Role in the app (kept from the old table) |
| `start_date` | First day; today by default |
| `end_date` | Last day worked; empty = still employed. Check: after `start_date` |
| `cycle_start` | A Monday that starts their 4-week overtime cycle |
| `sort_order` | Display order |
| `updated_at` | Last change |

### employee_farms: who is trained on which farm
| Column | Meaning |
|---|---|
| `employee_id` | FK → employees |
| `farm_id` | FK → farms |

PK = both together: the same farm cannot be listed twice for one employee.

### roster_shifts: the roster (who SHOULD work)
| Column | Meaning |
|---|---|
| `employee_id` | FK → employees |
| `work_date` | The day |
| `farm_id` | FK → farms. Empty = day off. No row = not planned yet |
| `updated_at` | Last change |

PK = employee + day: one assignment per person per day.

### timesheet_shifts: days actually worked (who DID work)
| Column | Meaning |
|---|---|
| `id` | PK |
| `employee_id` | FK → employees (never cascade-deleted: pay history is protected) |
| `farm_id` | FK → farms: where they worked that day |
| `work_date` | The day. Unique with `employee_id`: one row per person per day |
| `hours` | Day total, only when the exact clock times are unknown |
| `status` | `on` (working), `break` (on a break) or `complete` (finished) |
| `gps_checks` | GPS positions captured at each clock action |
| `source` | Where the row comes from: `clock` (Shift Clock), `import`, `manual` or `demo` |
| `note` | Free note |
| `updated_at` | Last change |

### timesheet_segments: stretches of work within a day
| Column | Meaning |
|---|---|
| `shift_id` | FK → timesheet_shifts: the day it belongs to |
| `start_time` | Start of the stretch |
| `end_time` | End of the stretch; empty = still working. Check: after the start |
| `end_reason` | Why the stretch ended: `rest_break`, `meal_break` or `end_of_day` (only accepted values). Empty only while the stretch is still running |

PK = day + start time. Breaks are the gaps between stretches, and `end_reason` says what kind: 04:30–10:15 (`meal_break`) then 13:00–16:20 (`end_of_day`) = a meal break from 10:15 to 13:00. Under the Pastoral Award (clause 12), the 10-minute morning rest break is paid and the meal break is unpaid. A day can have only one stretch still running. Imported hours have their gaps recorded as meal breaks. Known limit: work past midnight is not supported.

### timesheet_approvals: approved fortnights
| Column | Meaning |
|---|---|
| `employee_id` | FK → employees |
| `fortnight_start` | The Monday the fortnight starts |
| `approved_at` | Approval time |
| `sent_at` | Time sent to Xero |

PK = employee + fortnight.

### public_holidays: public holidays
| Column | Meaning |
|---|---|
| `holiday_date` | The day |
| `state` | The state (VIC) |
| `name` | Holiday name |

PK = day + state.

### farm_plans: each farm's plan photo
| Column | Meaning |
|---|---|
| `farm_id` | PK and FK → farms: one plan per farm |
| `image_path` | Photo URL |
| `img_w`, `img_h` | Photo width and height in pixels |
| `updated_at` | Last change |

### farm_plan_refs: GPS reference points used to calibrate the plan
| Column | Meaning |
|---|---|
| `id` | PK |
| `farm_id` | FK → farm_plans |
| `name` | Point name |
| `lat`, `lng` | Real GPS position |
| `u`, `v` | Position of the same point on the photo |
| `updated_at` | Last change |

### farm_plan_paddocks: paddocks placed on the plan
| Column | Meaning |
|---|---|
| `id` | PK |
| `farm_id` | FK → farm_plans |
| `name` | Paddock name |
| `status` | Paddock status (free text entered in Farm Plan) |
| `last_grazed` | Last grazing date |
| `notes` | Notes |
| `u`, `v` | Position on the photo |
| `updated_at` | Last change |

## 2. How the tables link

```
companies ──< farms ──────────< farm_plans ──< farm_plan_refs
    │           │                    └──────< farm_plan_paddocks
    │           ├──< employee_farms >──┐
    │           ├──< roster_shifts >───┤
    │           └──< timesheet_shifts >┤ ──< timesheet_segments
    └──< employees ────────────────────┘
             ├──< timesheet_approvals
             └── partner_id → employees (itself)
public_holidays: linked to companies through the state (VIC), not by an FK
```

`A ──< B` means "one row of A, many rows of B". Each arrow is an FK: for example, the database rejects a roster entry for an employee who does not exist.

## 3. Normal forms, as a reminder

- **1NF (first normal form)**: each cell holds **one value**, not a list. Not allowed: "trained farms = laang, vickers" in a single cell.
- **2NF**: 1NF, and when the key is made of several columns, every other column depends on the **whole** key, not part of it. Not allowed: the employee's name in `roster_shifts`, whose key is employee + day: the name depends on the employee only.
- **3NF**: 2NF, and no column depends on **another non-key column**. Not allowed: the farm name in `employees` next to the farm id: the name depends on the farm, not on the employee.

## 4. Verdict

**2NF and 3NF: met.** Tables with a two-column key (`employee_farms`, `roster_shifts`, `timesheet_segments`, `timesheet_approvals`, `public_holidays`) only hold columns that depend on the whole key. No information is copied from one table to another: a farm's name lives only in `farms`, an employee's only in `employees`.

**1NF: met, with one deliberate exception.** Clock times have their own table (`timesheet_segments`), where the database rejects an invalid time or an end before its start. The exception is `gps_checks`, a small log of positions in `timesheet_shifts`: it is only displayed, never searched, so keeping it as one block is reasonable.

**Two things to watch, without breaking 3NF:**
- A couple is stored on both sides (Ani → Junior and Junior → Ani). The app must always update both records together.
- With the single "Approve and send to Xero" button, `approved_at` and `sent_at` will hold the same time once Xero is connected. Both stay until then, since a fortnight can be approved without being sent.
