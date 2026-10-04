-- =====================================================================
-- FarmSmart — migration 001: simplified multi-company schema + Timesheet
-- ---------------------------------------------------------------------
-- Run ONCE in Supabase → SQL Editor, and deploy the matching app code
-- right after: the old code reads tables this script removes.
--
-- One transaction: if any check fails, nothing is changed.
--
-- Principles:
--   • Every farm and employee has a UUID id plus a readable `code`
--     ('maguires', 'greg'), unique within its company.
--   • Everything belongs to a company, directly or through a farm or an
--     employee, so more clients can be added later.
--   • Nothing is deleted: employees get an end_date, farms go inactive.
--   • Pay rates live in Xero only; FarmSmart stores hours.
--
-- Tables after migration (12):
--   companies, farms, employees, employee_farms, roster_shifts,
--   timesheet_shifts, timesheet_segments, timesheet_approvals, public_holidays,
--   farm_plans, farm_plan_refs, farm_plan_paddocks
-- Removed (data copied): roster_farms, roster_employees, roster_settings.
-- Every old table is first copied as-is into the backup_001 schema.
--
-- DEMO ONLY: every table is open to the anon key. Close before real use
-- (see A-FAIRE-AVANT-PRODUCTION.md).
-- =====================================================================

begin;

-- ---------- 0. Checks ----------------------------------------------------
do $$
begin
  if to_regclass('public.roster_farms') is null or to_regclass('public.roster_employees') is null then
    raise exception 'roster_farms / roster_employees not found: migration already run?';
  end if;
  if to_regclass('public.companies') is not null or to_regclass('public.farms') is not null
     or to_regclass('public.employees') is not null then
    raise exception 'companies / farms / employees already exist: migration already run?';
  end if;
  if exists (select 1 from roster_employees where id in ('greg', 'violette')) then
    raise exception 'greg / violette already exist in roster_employees';
  end if;
  if exists (select 1 from roster_shifts s where not exists (select 1 from roster_employees e where e.id = s.employee_id))
     or exists (select 1 from roster_shifts s where s.assignment <> 'off'
                and not exists (select 1 from roster_farms f where f.id = s.assignment)) then
    raise exception 'roster_shifts points to an unknown employee or farm';
  end if;
  if exists (select 1 from farm_plans p where not exists (select 1 from roster_farms f where f.id = p.farm_id)) then
    raise exception 'farm_plans points to an unknown farm';
  end if;
  if exists (select 1 from roster_farms
             where not (0 <= coalesce(min_staff, 0) and coalesce(min_staff, 0) <= coalesce(ideal_staff, 0)
                        and coalesce(ideal_staff, 0) <= coalesce(max_staff, 0))) then
    raise exception 'A farm has staff rules out of order (min <= ideal <= max): fix them in the Roster first';
  end if;
end $$;

-- Backup: an untouched copy of every old table, outside the API-exposed
-- public schema. To restore, copy back from backup_001; once the new app
-- has run fine for a while: drop schema backup_001 cascade;
create schema backup_001;
create table backup_001.roster_farms       as table roster_farms;
create table backup_001.roster_employees   as table roster_employees;
create table backup_001.roster_settings    as table roster_settings;
create table backup_001.roster_shifts      as table roster_shifts;
create table backup_001.farm_plans         as table farm_plans;
create table backup_001.farm_plan_refs     as table farm_plan_refs;
create table backup_001.farm_plan_paddocks as table farm_plan_paddocks;

-- These four keep their names, so the old versions step aside first.
alter table roster_shifts      rename to old_roster_shifts;
alter table farm_plans         rename to old_farm_plans;
alter table farm_plan_refs     rename to old_farm_plan_refs;
alter table farm_plan_paddocks rename to old_farm_plan_paddocks;

-- ---------- 1. Tables ----------------------------------------------------
create table companies (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  state                 text not null default 'VIC',   -- picks the public holidays
  xero_tenant_id        text,                          -- set when Xero is connected
  pay_anchor            date not null,                 -- a Monday that starts a pay fortnight
  ot_threshold_hours    numeric not null default 152 check (ot_threshold_hours > 0),
  cycle_days            int     not null default 28  check (cycle_days > 0),
  weekly_days_off       int     not null default 2   check (weekly_days_off between 0 and 7),
  couple_shared_day_off boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table farms (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id),
  code                text not null,
  name                text not null,
  farm_type           text not null default 'Dairy',
  owner_first_name    text,
  herd_size           int,
  road_name           text,
  lat                 double precision,
  lng                 double precision,
  color               text not null default '#3B82C4',
  min_staff           int not null default 0,
  ideal_staff         int not null default 0,
  max_staff           int not null default 0,
  exempt_from_minimum boolean not null default false,
  sort_order          int not null default 0,
  active              boolean not null default true,
  updated_at          timestamptz not null default now(),
  unique (company_id, code),
  check (0 <= min_staff and min_staff <= ideal_staff and ideal_staff <= max_staff)
);

create table employees (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id),
  code             text not null,
  preferred_name   text not null,
  partner_id       uuid references employees(id) deferrable initially deferred,
  employment_type  text check (employment_type in ('casual', 'permanent')),
  classification   text,
  xero_employee_id text unique,
  app_role         text,
  start_date       date default current_date,
  end_date         date,                  -- last day worked; null = still employed
  cycle_start      date,                  -- a Monday that starts their 4-week overtime cycle
  sort_order       int not null default 0,
  updated_at       timestamptz not null default now(),
  unique (company_id, code),
  check (end_date is null or start_date is null or end_date >= start_date)
);

-- Which farms an employee is trained on.
create table employee_farms (
  employee_id uuid not null references employees(id) on delete cascade,
  farm_id     uuid not null references farms(id) on delete cascade,
  primary key (employee_id, farm_id)
);

-- Planned work. One row = a decision for that day: farm_id set = works
-- there, farm_id null = day off. No row = not planned yet.
create table roster_shifts (
  employee_id uuid not null references employees(id) on delete cascade,
  work_date   date not null,
  farm_id     uuid references farms(id),
  updated_at  timestamptz not null default now(),
  primary key (employee_id, work_date)
);

-- A day actually worked, one row per employee per day. Its clock times
-- are in timesheet_segments; hours = day total, only when they are unknown.
-- No cascade on employees: pay history must survive.
create table timesheet_shifts (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  farm_id     uuid not null references farms(id),
  work_date   date not null,
  hours       numeric check (hours >= 0),
  status      text not null default 'complete' check (status in ('on', 'break', 'complete')),
  gps_checks  jsonb,
  source      text not null default 'clock' check (source in ('clock', 'import', 'manual', 'demo')),
  note        text,
  updated_at  timestamptz not null default now(),
  unique (employee_id, work_date)
);

-- One continuous stretch of work within a day; breaks are the gaps.
-- end_time null = still working. end_reason = why the stretch ended, so
-- the gap after it is a rest break, a meal break, or the end of the day.
-- Known limit: no shift past midnight.
create table timesheet_segments (
  shift_id   uuid not null references timesheet_shifts(id) on delete cascade,
  start_time time not null,
  end_time   time check (end_time > start_time),
  end_reason text check (end_reason in ('rest_break', 'meal_break', 'end_of_day')),
  primary key (shift_id, start_time),
  check ((end_time is null) = (end_reason is null))
);
-- At most one open segment per day.
create unique index timesheet_segments_one_open_idx on timesheet_segments (shift_id) where end_time is null;

create table timesheet_approvals (
  employee_id     uuid not null references employees(id),
  fortnight_start date not null,
  approved_at     timestamptz,
  sent_at         timestamptz,       -- sent to Xero as a draft timesheet
  primary key (employee_id, fortnight_start)
);

create table public_holidays (
  holiday_date date not null,
  state        text not null,
  name         text not null,
  primary key (holiday_date, state)
);

create table farm_plans (
  farm_id    uuid primary key references farms(id),
  image_path text,
  img_w      int,
  img_h      int,
  updated_at timestamptz not null default now()
);

create table farm_plan_refs (
  id         text primary key,
  farm_id    uuid not null references farm_plans(farm_id) on delete cascade,
  name       text,
  lat        double precision,
  lng        double precision,
  u          double precision,
  v          double precision,
  updated_at timestamptz not null default now()
);

create table farm_plan_paddocks (
  id          text primary key,
  farm_id     uuid not null references farm_plans(farm_id) on delete cascade,
  name        text,
  status      text,
  last_grazed date,
  notes       text,
  u           double precision,
  v           double precision,
  updated_at  timestamptz not null default now()
);

-- Foreign keys Postgres does not index by itself, used for filtering.
create index farms_company_idx              on farms (company_id);
create index employees_company_idx          on employees (company_id);
create index employee_farms_farm_idx        on employee_farms (farm_id);
create index roster_shifts_date_idx         on roster_shifts (work_date);
create index timesheet_shifts_date_idx      on timesheet_shifts (work_date);
create index farm_plan_refs_farm_idx        on farm_plan_refs (farm_id);
create index farm_plan_paddocks_farm_idx    on farm_plan_paddocks (farm_id);

-- ---------- 2. Copy the current data -------------------------------------
insert into companies (name, state, pay_anchor, weekly_days_off, couple_shared_day_off)
select 'Moloney Sharefarming Trust', 'VIC', date '2026-09-14',
       coalesce(s.weekly_days_off, 2), coalesce(s.couple_shared_day_off, true)
from (select 1) one
left join roster_settings s on s.id = 'global';

insert into farms (company_id, code, name, color, min_staff, ideal_staff, max_staff, exempt_from_minimum, sort_order)
select c.id, f.id, f.name, coalesce(f.color, '#3B82C4'),
       coalesce(f.min_staff, 0), coalesce(f.ideal_staff, 0), coalesce(f.max_staff, 0),
       coalesce(f.exempt_from_minimum, false), coalesce(f.sort_order, 0)
from roster_farms f cross join companies c;

-- Until now hard-coded in core.js.
update farms set owner_first_name = 'Peter',  herd_size = 355, road_name = 'Thorburns Road', lat = -38.361, lng = 142.814 where code = 'laang';
update farms set owner_first_name = 'John',   herd_size = 557, road_name = 'Maguires Road',  lat = -38.300, lng = 142.780 where code = 'maguires';
update farms set owner_first_name = 'Damian', herd_size = 992, road_name = 'Vickers Road',   lat = -38.333, lng = 142.733 where code = 'vickers';

insert into employees (company_id, code, preferred_name, employment_type, classification,
                       xero_employee_id, app_role, sort_order)
select c.id, e.id, coalesce(e.preferred_name, e.id), e.employment_type, e.classification,
       e.xero_employee_id, e.app_role, coalesce(e.sort_order, 0)
from roster_employees e cross join companies c;

update employees n set partner_id = p.id
from roster_employees o join employees p on p.code = o.partner_id
where o.id = n.code;

insert into employee_farms (employee_id, farm_id)
select n.id, f.id
from roster_employees o
cross join jsonb_array_elements_text(coalesce(o.trained_farms, '[]'::jsonb)) t(code)
join employees n on n.code = o.id
join farms f on f.code = t.code;

-- Else / Carolina: start and cycle dates are made up for the demo.
update employees set employment_type = 'casual',    classification = 'FLH1', start_date = '2025-10-06', cycle_start = '2026-02-02' where code = 'else';
update employees set employment_type = 'casual',    classification = 'FLH1', start_date = '2026-09-22', cycle_start = '2026-09-21' where code = 'ani';
update employees set employment_type = 'casual',    classification = 'FLH1', start_date = '2026-09-28', cycle_start = '2026-09-28' where code = 'junior';
update employees set employment_type = 'permanent', classification = 'FLH1', start_date = '2025-06-16', cycle_start = '2026-02-16' where code = 'carolina';

-- Greg and Violette left on Sunday 27/09/2026; kept for pay and Xero.
insert into employees (company_id, code, preferred_name, employment_type, classification,
                       start_date, end_date, cycle_start, sort_order)
select c.id, v.code, v.name, 'casual', 'FLH1', '2026-05-31', '2026-09-27', '2026-05-25', v.sort_order
from companies c,
     (values ('greg', 'Greg', 10), ('violette', 'Violette', 11)) as v(code, name, sort_order);
insert into employee_farms (employee_id, farm_id)
select e.id, f.id
from (values ('greg', 'vickers'), ('violette', 'maguires')) as v(emp_code, farm_code)
join employees e on e.code = v.emp_code
join farms f on f.code = v.farm_code;

insert into roster_shifts (employee_id, work_date, farm_id, updated_at)
select e.id, s.work_date, f.id, coalesce(s.updated_at, now())
from old_roster_shifts s
join employees e on e.code = s.employee_id
left join farms f on f.code = s.assignment;   -- 'off' matches no farm → null

insert into farm_plans (farm_id, image_path, img_w, img_h, updated_at)
select f.id, p.image_path, p.img_w, p.img_h, coalesce(p.updated_at, now())
from old_farm_plans p join farms f on f.code = p.farm_id;
insert into farm_plan_refs (id, farm_id, name, lat, lng, u, v, updated_at)
select r.id, f.id, r.name, r.lat, r.lng, r.u, r.v, coalesce(r.updated_at, now())
from old_farm_plan_refs r join farms f on f.code = r.farm_id;
insert into farm_plan_paddocks (id, farm_id, name, status, last_grazed, notes, u, v, updated_at)
select d.id, f.id, d.name, d.status, d.last_grazed, d.notes, d.u, d.v, coalesce(d.updated_at, now())
from old_farm_plan_paddocks d join farms f on f.code = d.farm_id;

-- Check the partner links now rather than at commit: later ALTERs
-- refuse to run while a deferred check is pending.
set constraints all immediate;

-- Nothing may be lost in the copy.
do $$
begin
  if (select count(*) from roster_shifts)      <> (select count(*) from old_roster_shifts)
  or (select count(*) from farm_plans)         <> (select count(*) from old_farm_plans)
  or (select count(*) from farm_plan_refs)     <> (select count(*) from old_farm_plan_refs)
  or (select count(*) from farm_plan_paddocks) <> (select count(*) from old_farm_plan_paddocks)
  or (select count(*) from employees)          <> (select count(*) from roster_employees) + 2 then
    raise exception 'Copy incomplete: row counts differ from the old tables';
  end if;
end $$;

drop table old_roster_shifts, old_farm_plan_refs, old_farm_plan_paddocks, old_farm_plans,
           roster_employees, roster_farms, roster_settings;

-- ---------- 3. Public holidays and hours ---------------------------------
-- Victoria 2026 (business.vic.gov.au). Add each new year.
insert into public_holidays (holiday_date, state, name) values
  ('2026-01-01', 'VIC', 'New Year''s Day'),
  ('2026-01-26', 'VIC', 'Australia Day'),
  ('2026-03-09', 'VIC', 'Labour Day'),
  ('2026-04-03', 'VIC', 'Good Friday'),
  ('2026-04-04', 'VIC', 'Saturday before Easter'),
  ('2026-04-05', 'VIC', 'Easter Sunday'),
  ('2026-04-06', 'VIC', 'Easter Monday'),
  ('2026-04-25', 'VIC', 'ANZAC Day'),
  ('2026-06-08', 'VIC', 'King''s Birthday'),
  ('2026-09-25', 'VIC', 'Friday before AFL Grand Final'),
  ('2026-11-03', 'VIC', 'Melbourne Cup Day'),
  ('2026-12-25', 'VIC', 'Christmas Day'),
  ('2026-12-26', 'VIC', 'Boxing Day'),
  ('2026-12-28', 'VIC', 'Boxing Day (additional holiday)');

-- Greg & Violette: real hours (source 'import', 31/05 → 30/08/2026).
-- Others: demo hours (source 'demo'); remove later with
--   delete from timesheet_shifts where source = 'demo';
-- Each day is listed as alternating start/end times, then split into
-- one segment per start/end pair. Gaps are meal breaks (Greg's call);
-- the last segment ends the day.
create temporary table imported_hours on commit drop as
select v.emp_code, v.work_date::date as work_date, v.farm_code, v.times::time[] as times, v.note, v.source
from (values
  ('greg', '2026-05-31', 'maguires', array['05:00', '11:10', '13:00', '16:45']::text[], null, 'import'),
  ('greg', '2026-06-01', 'maguires', array['05:00', '10:38', '13:00', '16:24']::text[], null, 'import'),
  ('greg', '2026-06-02', 'maguires', array['05:00', '09:46', '12:58', '16:15']::text[], null, 'import'),
  ('greg', '2026-06-04', 'maguires', array['04:31', '10:32', '12:59', '16:34']::text[], null, 'import'),
  ('greg', '2026-06-05', 'maguires', array['04:30', '10:15', '13:00', '16:21']::text[], null, 'import'),
  ('greg', '2026-06-07', 'maguires', array['04:32', '10:52', '12:58', '16:48']::text[], null, 'import'),
  ('greg', '2026-06-09', 'maguires', array['04:29', '09:31', '12:59', '16:20']::text[], null, 'import'),
  ('greg', '2026-06-10', 'maguires', array['04:28', '08:48', '12:58', '16:15']::text[], null, 'import'),
  ('greg', '2026-06-11', 'maguires', array['04:29', '10:04', '12:58', '16:17']::text[], null, 'import'),
  ('greg', '2026-06-12', 'maguires', array['04:28', '10:15', '12:58', '17:13']::text[], null, 'import'),
  ('greg', '2026-06-14', 'maguires', array['04:31', '11:26', '12:59', '16:23']::text[], null, 'import'),
  ('greg', '2026-06-16', 'maguires', array['04:30', '10:42', '12:57', '16:20']::text[], null, 'import'),
  ('greg', '2026-06-17', 'maguires', array['04:30', '10:36', '12:59', '16:12']::text[], null, 'import'),
  ('greg', '2026-06-18', 'maguires', array['04:30', '09:38', '13:18', '16:27']::text[], null, 'import'),
  ('greg', '2026-06-19', 'maguires', array['04:29', '09:32', '13:17', '16:23']::text[], null, 'import'),
  ('greg', '2026-06-20', 'maguires', array['04:30', '10:08', '12:59', '16:28']::text[], null, 'import'),
  ('greg', '2026-06-22', 'maguires', array['04:29', '10:52', '12:59', '16:42']::text[], null, 'import'),
  ('greg', '2026-06-23', 'maguires', array['04:29', '10:01', '13:00', '16:35']::text[], null, 'import'),
  ('greg', '2026-06-24', 'maguires', array['04:29', '10:32', '12:59', '16:48']::text[], null, 'import'),
  ('greg', '2026-06-25', 'maguires', array['04:30', '10:42', '13:01', '17:19']::text[], null, 'import'),
  ('greg', '2026-06-26', 'maguires', array['04:32', '10:18', '13:03', '16:55']::text[], null, 'import'),
  ('greg', '2026-06-29', 'maguires', array['04:30', '09:14', '13:00', '16:40']::text[], null, 'import'),
  ('greg', '2026-06-30', 'maguires', array['04:30', '09:27', '12:56', '17:20']::text[], null, 'import'),
  ('greg', '2026-07-01', 'maguires', array['04:28', '10:07', '12:57', '16:46']::text[], null, 'import'),
  ('greg', '2026-07-02', 'maguires', array['04:30', '09:40', '13:00', '16:57']::text[], null, 'import'),
  ('greg', '2026-07-03', 'maguires', array['04:29', '10:16', '13:01', '17:23']::text[], null, 'import'),
  ('greg', '2026-07-06', 'maguires', array['04:29', '09:33', '13:01', '17:04']::text[], null, 'import'),
  ('greg', '2026-07-07', 'maguires', array['04:28', '09:32', '13:03', '17:15']::text[], null, 'import'),
  ('greg', '2026-07-10', 'maguires', array['04:29', '09:16', '12:58', '17:35']::text[], null, 'import'),
  ('greg', '2026-07-11', 'maguires', array['04:28', '09:57', '13:30', '17:52']::text[], null, 'import'),
  ('greg', '2026-07-12', 'maguires', array['04:29', '09:21', '12:57', '17:02']::text[], null, 'import'),
  ('greg', '2026-07-13', 'maguires', array['04:29', '09:24', '12:58', '17:14']::text[], null, 'import'),
  ('greg', '2026-07-14', 'maguires', array['04:29', '09:06', '12:59', '17:19']::text[], null, 'import'),
  ('greg', '2026-07-16', 'maguires', array['04:29', '09:14', '13:27', '17:55']::text[], null, 'import'),
  ('greg', '2026-07-17', 'maguires', array['04:29', '08:47', '13:28', '18:02']::text[], null, 'import'),
  ('greg', '2026-07-18', 'maguires', array['04:23', '10:31', '13:00', '17:34']::text[], 'Morning at Damian''s', 'import'),
  ('greg', '2026-07-20', 'maguires', array['04:27', '10:54', '12:59', '16:53']::text[], 'Morning at Damian''s', 'import'),
  ('greg', '2026-07-21', 'maguires', array['04:22', '09:27', '12:57', '16:54']::text[], null, 'import'),
  ('greg', '2026-07-24', 'maguires', array['04:20', '10:16', '13:00', '17:33']::text[], null, 'import'),
  ('greg', '2026-07-25', 'maguires', array['04:21', '10:10', '12:59', '16:58']::text[], null, 'import'),
  ('greg', '2026-07-26', 'maguires', array['04:21', '10:41', '12:57', '17:49']::text[], null, 'import'),
  ('greg', '2026-07-27', 'maguires', array['04:20', '10:06', '12:57', '17:31']::text[], null, 'import'),
  ('greg', '2026-07-28', 'maguires', array['04:20', '09:48', '12:59', '17:25']::text[], null, 'import'),
  ('greg', '2026-07-31', 'maguires', array['04:21', '10:00', '13:28', '17:26']::text[], null, 'import'),
  ('greg', '2026-08-01', 'maguires', array['04:19', '10:31', '12:33', '13:11', '13:29', '17:28']::text[], '2 meal breaks', 'import'),
  ('greg', '2026-08-02', 'maguires', array['04:19', '10:16', '12:59', '16:56']::text[], null, 'import'),
  ('greg', '2026-08-03', 'maguires', array['04:19', '09:48', '12:59', '17:54']::text[], null, 'import'),
  ('greg', '2026-08-06', 'maguires', array['04:20', '10:41', '12:13', '13:02', '13:25', '17:07']::text[], '2 meal breaks', 'import'),
  ('greg', '2026-08-07', 'maguires', array['04:19', '10:41', '12:58', '17:27']::text[], null, 'import'),
  ('greg', '2026-08-08', 'maguires', array['04:15', '09:40', '12:59', '17:50']::text[], null, 'import'),
  ('greg', '2026-08-09', 'maguires', array['04:16', '09:22', '13:12', '17:02']::text[], null, 'import'),
  ('greg', '2026-08-10', 'maguires', array['04:19', '09:54', '13:30', '17:29']::text[], null, 'import'),
  ('greg', '2026-08-11', 'maguires', array['04:21', '09:58', '12:44', '17:36']::text[], null, 'import'),
  ('greg', '2026-08-13', 'maguires', array['04:20', '10:02', '13:14', '17:16']::text[], null, 'import'),
  ('greg', '2026-08-14', 'maguires', array['04:11', '09:25', '13:14', '17:03']::text[], null, 'import'),
  ('greg', '2026-08-15', 'maguires', array['04:16', '09:38', '12:59', '17:10']::text[], null, 'import'),
  ('greg', '2026-08-17', 'maguires', array['04:20', '09:15', '12:59', '17:29']::text[], null, 'import'),
  ('greg', '2026-08-18', 'maguires', array['04:18', '09:07', '12:59', '17:16']::text[], null, 'import'),
  ('greg', '2026-08-21', 'maguires', array['04:20', '09:21', '13:29', '17:17']::text[], null, 'import'),
  ('greg', '2026-08-22', 'maguires', array['04:17', '09:35', '13:29', '17:18']::text[], null, 'import'),
  ('greg', '2026-08-23', 'maguires', array['04:22', '08:52', '12:56', '17:16']::text[], null, 'import'),
  ('greg', '2026-08-24', 'maguires', array['04:20', '09:26', '13:29', '17:14']::text[], null, 'import'),
  ('greg', '2026-08-25', 'maguires', array['04:18', '09:33', '12:58', '17:02']::text[], null, 'import'),
  ('greg', '2026-08-28', 'maguires', array['04:30', '07:42', '10:12', '11:16', '12:32', '16:44']::text[], 'Morning at John''s', 'import'),
  ('greg', '2026-08-29', 'maguires', array['04:24', '10:12', '12:59', '17:37']::text[], null, 'import'),
  ('greg', '2026-08-30', 'maguires', array['03:52', '08:38', '12:58', '17:05']::text[], null, 'import'),
  ('violette', '2026-05-31', 'maguires', array['05:00', '11:10', '13:00', '16:45']::text[], null, 'import'),
  ('violette', '2026-06-01', 'maguires', array['05:00', '10:38', '13:00', '16:24']::text[], null, 'import'),
  ('violette', '2026-06-02', 'maguires', array['05:00', '09:46', '12:58', '16:00']::text[], null, 'import'),
  ('violette', '2026-06-04', 'maguires', array['04:31', '10:32', '12:59', '16:34']::text[], null, 'import'),
  ('violette', '2026-06-05', 'maguires', array['04:30', '10:15', '13:00', '16:20']::text[], null, 'import'),
  ('violette', '2026-06-07', 'maguires', array['04:32', '10:52', '12:58', '16:48']::text[], null, 'import'),
  ('violette', '2026-06-09', 'maguires', array['04:29', '09:31', '12:59', '16:20']::text[], null, 'import'),
  ('violette', '2026-06-10', 'maguires', array['04:28', '08:48', '12:58', '16:15']::text[], null, 'import'),
  ('violette', '2026-06-11', 'maguires', array['04:29', '10:04', '12:58', '16:17']::text[], null, 'import'),
  ('violette', '2026-06-12', 'maguires', array['04:28', '10:15', '12:58', '17:13']::text[], null, 'import'),
  ('violette', '2026-06-14', 'maguires', array['04:31', '11:26', '12:59', '16:23']::text[], null, 'import'),
  ('violette', '2026-06-16', 'maguires', array['04:30', '10:42', '12:57', '16:20']::text[], null, 'import'),
  ('violette', '2026-06-17', 'maguires', array['04:30', '10:36', '12:59', '16:13']::text[], null, 'import'),
  ('violette', '2026-06-18', 'maguires', array['04:30', '09:38', '13:18', '16:27']::text[], null, 'import'),
  ('violette', '2026-06-19', 'maguires', array['04:29', '09:32', '13:17', '16:23']::text[], null, 'import'),
  ('violette', '2026-06-20', 'maguires', array['04:30', '10:08', '12:59', '16:28']::text[], null, 'import'),
  ('violette', '2026-06-22', 'maguires', array['04:29', '10:52', '13:00', '16:42']::text[], null, 'import'),
  ('violette', '2026-06-23', 'maguires', array['04:29', '10:01', '13:00', '16:35']::text[], null, 'import'),
  ('violette', '2026-06-24', 'maguires', array['04:29', '10:32', '12:59', '16:48']::text[], null, 'import'),
  ('violette', '2026-06-25', 'maguires', array['04:30', '10:42', '12:54', '17:46']::text[], 'Milk trailer start', 'import'),
  ('violette', '2026-06-26', 'maguires', array['04:32', '10:18', '12:46', '17:23']::text[], null, 'import'),
  ('violette', '2026-06-29', 'maguires', array['04:30', '09:14', '12:40', '17:01']::text[], null, 'import'),
  ('violette', '2026-06-30', 'maguires', array['04:30', '09:27', '12:35', '17:32']::text[], null, 'import'),
  ('violette', '2026-07-01', 'maguires', array['04:28', '10:07', '12:35', '17:10']::text[], null, 'import'),
  ('violette', '2026-07-02', 'maguires', array['04:30', '09:39', '12:38', '17:13']::text[], null, 'import'),
  ('violette', '2026-07-03', 'maguires', array['04:29', '10:16', '12:40', '17:41']::text[], null, 'import'),
  ('violette', '2026-07-06', 'maguires', array['04:29', '09:33', '12:40', '17:25']::text[], null, 'import'),
  ('violette', '2026-07-07', 'maguires', array['04:28', '09:32', '12:42', '17:26']::text[], null, 'import'),
  ('violette', '2026-07-10', 'maguires', array['04:29', '09:16', '12:39', '17:42']::text[], null, 'import'),
  ('violette', '2026-07-11', 'maguires', array['04:28', '09:57', '13:04', '18:15']::text[], null, 'import'),
  ('violette', '2026-07-12', 'maguires', array['04:29', '09:21', '12:35', '17:17']::text[], null, 'import'),
  ('violette', '2026-07-13', 'maguires', array['04:29', '09:24', '12:34', '17:41']::text[], null, 'import'),
  ('violette', '2026-07-14', 'maguires', array['04:29', '09:06', '12:34', '17:40']::text[], null, 'import'),
  ('violette', '2026-07-16', 'maguires', array['04:29', '09:14', '13:02', '18:11']::text[], 'End of calving season', 'import'),
  ('violette', '2026-07-17', 'maguires', array['04:29', '08:47', '13:05', '18:20']::text[], 'Insemination start', 'import'),
  ('violette', '2026-07-18', 'maguires', array['04:29', '09:24', '12:37', '17:52']::text[], null, 'import'),
  ('violette', '2026-07-20', 'maguires', array['04:30', '09:19', '12:37', '17:09']::text[], null, 'import'),
  ('violette', '2026-07-21', 'maguires', array['04:29', '09:35', '12:44', '17:14']::text[], null, 'import'),
  ('violette', '2026-07-24', 'maguires', array['04:29', '09:50', '12:39', '17:57']::text[], null, 'import'),
  ('violette', '2026-07-25', 'maguires', array['04:29', '09:31', '12:36', '17:18']::text[], null, 'import'),
  ('violette', '2026-07-26', 'maguires', array['04:29', '09:42', '12:38', '17:35']::text[], null, 'import'),
  ('violette', '2026-07-27', 'maguires', array['04:29', '09:31', '12:35', '17:52']::text[], null, 'import'),
  ('violette', '2026-07-28', 'maguires', array['04:29', '09:22', '12:59', '17:25']::text[], 'Milk trailer end', 'import'),
  ('violette', '2026-07-31', 'maguires', array['04:29', '10:04', '13:28', '17:26']::text[], null, 'import'),
  ('violette', '2026-08-01', 'maguires', array['04:29', '09:46', '13:29', '17:28']::text[], null, 'import'),
  ('violette', '2026-08-02', 'maguires', array['04:29', '09:49', '12:59', '16:56']::text[], null, 'import'),
  ('violette', '2026-08-03', 'maguires', array['04:29', '09:24', '12:59', '17:54']::text[], null, 'import'),
  ('violette', '2026-08-06', 'maguires', array['04:31', '10:52', '13:25', '17:07']::text[], null, 'import'),
  ('violette', '2026-08-07', 'maguires', array['04:29', '09:28', '12:58', '17:27']::text[], null, 'import'),
  ('violette', '2026-08-08', 'maguires', array['04:29', '09:42', '12:59', '17:50']::text[], null, 'import'),
  ('violette', '2026-08-09', 'maguires', array['04:29', '09:53', '13:11', '17:02']::text[], null, 'import'),
  ('violette', '2026-08-10', 'maguires', array['04:28', '09:50', '13:30', '17:29']::text[], null, 'import'),
  ('violette', '2026-08-11', 'maguires', array['04:29', '09:43', '13:18', '17:36']::text[], null, 'import'),
  ('violette', '2026-08-13', 'maguires', array['04:29', '09:27', '13:14', '17:16']::text[], null, 'import'),
  ('violette', '2026-08-14', 'maguires', array['04:28', '09:54', '13:14', '17:03']::text[], null, 'import'),
  ('violette', '2026-08-15', 'maguires', array['04:29', '09:57', '12:59', '17:09']::text[], null, 'import'),
  ('violette', '2026-08-17', 'maguires', array['04:29', '09:39', '12:59', '17:29']::text[], null, 'import'),
  ('violette', '2026-08-18', 'maguires', array['04:28', '10:03', '12:59', '17:16']::text[], null, 'import'),
  ('violette', '2026-08-21', 'maguires', array['04:30', '09:02', '13:29', '17:17']::text[], 'End of insemination', 'import'),
  ('violette', '2026-08-22', 'maguires', array['04:29', '08:58', '13:28', '17:18']::text[], null, 'import'),
  ('violette', '2026-08-23', 'maguires', array['04:31', '08:35', '13:29', '17:16']::text[], null, 'import'),
  ('violette', '2026-08-24', 'maguires', array['04:29', '08:52', '13:29', '17:14']::text[], null, 'import'),
  ('violette', '2026-08-25', 'maguires', array['04:28', '08:32', '12:58', '17:02']::text[], null, 'import'),
  ('violette', '2026-08-28', 'maguires', array['04:30', '07:42', '10:12', '11:16', '12:32', '16:44']::text[], 'Shovel feedpad', 'import'),
  ('violette', '2026-08-29', 'maguires', array['04:58', '08:48', '12:59', '17:37']::text[], null, 'import'),
  ('violette', '2026-08-30', 'maguires', array['04:28', '08:38', '12:58', '17:05']::text[], null, 'import'),
  ('junior', '2026-09-28', 'maguires', array['04:54', '09:42', '16:21', '21:16']::text[], null, 'demo'),
  ('junior', '2026-09-29', 'maguires', array['04:51', '09:22', '14:38', '20:06']::text[], null, 'demo'),
  ('junior', '2026-09-30', 'maguires', array['04:51', '08:56', '14:14', '19:14']::text[], null, 'demo'),
  ('junior', '2026-10-02', 'maguires', array['04:54', '09:42', '16:21', '20:46']::text[], null, 'demo'),
  ('ani', '2026-09-22', 'vickers', array['05:07', '10:32', '15:55', '20:25']::text[], null, 'demo'),
  ('ani', '2026-09-23', 'vickers', array['04:50', '09:59', '15:26', '19:35']::text[], null, 'demo'),
  ('ani', '2026-09-26', 'vickers', array['04:57', '09:39', '15:37', '20:04']::text[], null, 'demo'),
  ('ani', '2026-09-27', 'vickers', array['05:07', '09:31', '15:08', '20:02']::text[], null, 'demo'),
  ('ani', '2026-09-28', 'vickers', array['04:57', '09:36', '15:59', '21:17']::text[], null, 'demo'),
  ('ani', '2026-09-29', 'vickers', array['05:08', '09:20', '15:30', '20:38']::text[], null, 'demo'),
  ('ani', '2026-09-30', 'vickers', array['04:58', '09:26', '15:52', '21:00']::text[], null, 'demo'),
  ('else', '2026-05-11', 'vickers', array['05:01', '09:51', '16:08', '21:16']::text[], null, 'demo'),
  ('else', '2026-05-12', 'vickers', array['05:09', '09:40', '15:00', '20:22']::text[], null, 'demo'),
  ('else', '2026-05-14', 'vickers', array['04:50', '09:37', '16:20', '20:40']::text[], null, 'demo'),
  ('else', '2026-05-16', 'vickers', array['05:08', '09:47', '16:31', '21:21']::text[], null, 'demo'),
  ('else', '2026-05-17', 'vickers', array['04:54', '09:09', '15:32', '20:28']::text[], null, 'demo'),
  ('else', '2026-05-18', 'vickers', array['04:52', '09:40', '15:48', '20:15']::text[], null, 'demo'),
  ('else', '2026-05-19', 'vickers', array['05:07', '10:33', '16:31', '21:01']::text[], null, 'demo'),
  ('else', '2026-05-21', 'vickers', array['04:56', '09:27', '15:00', '20:06']::text[], null, 'demo'),
  ('else', '2026-05-23', 'vickers', array['04:56', '09:58', '15:18', '20:16']::text[], null, 'demo'),
  ('else', '2026-05-24', 'vickers', array['05:02', '09:39', '15:10', '19:48']::text[], null, 'demo'),
  ('else', '2026-05-25', 'vickers', array['04:53', '09:51', '15:44', '20:27']::text[], null, 'demo'),
  ('else', '2026-05-26', 'vickers', array['04:51', '09:43', '15:10', '19:33']::text[], null, 'demo'),
  ('else', '2026-05-28', 'vickers', array['05:06', '09:55', '16:08', '21:13']::text[], null, 'demo'),
  ('else', '2026-05-30', 'vickers', array['04:55', '10:23', '16:52', '21:23']::text[], null, 'demo'),
  ('else', '2026-05-31', 'vickers', array['04:52', '09:37', '15:21', '20:32']::text[], null, 'demo'),
  ('else', '2026-06-01', 'vickers', array['05:06', '10:16', '16:41', '21:10']::text[], null, 'demo'),
  ('else', '2026-06-02', 'vickers', array['05:05', '09:52', '15:57', '20:20']::text[], null, 'demo'),
  ('else', '2026-06-04', 'vickers', array['05:00', '09:23', '15:29', '20:28']::text[], null, 'demo'),
  ('else', '2026-06-06', 'vickers', array['05:04', '09:57', '16:00', '21:03']::text[], null, 'demo'),
  ('else', '2026-06-07', 'vickers', array['05:05', '09:32', '14:52', '19:33']::text[], null, 'demo'),
  ('else', '2026-06-08', 'vickers', array['04:59', '09:36', '15:19', '19:59']::text[], null, 'demo'),
  ('else', '2026-06-09', 'vickers', array['04:54', '09:47', '15:26', '19:56']::text[], null, 'demo'),
  ('else', '2026-06-11', 'vickers', array['04:54', '10:13', '16:56', '21:29']::text[], null, 'demo'),
  ('else', '2026-06-13', 'vickers', array['05:03', '10:08', '15:46', '20:18']::text[], null, 'demo'),
  ('else', '2026-06-14', 'vickers', array['04:50', '09:16', '15:30', '20:41']::text[], null, 'demo'),
  ('else', '2026-06-15', 'vickers', array['05:03', '09:29', '15:03', '19:45']::text[], null, 'demo'),
  ('else', '2026-06-16', 'vickers', array['04:59', '09:17', '15:55', '20:47']::text[], null, 'demo'),
  ('else', '2026-06-18', 'vickers', array['05:07', '09:44', '16:23', '21:35']::text[], null, 'demo'),
  ('else', '2026-06-20', 'vickers', array['04:59', '09:34', '16:06', '21:21']::text[], null, 'demo'),
  ('else', '2026-06-21', 'vickers', array['04:58', '09:25', '15:06', '19:53']::text[], null, 'demo'),
  ('else', '2026-06-22', 'vickers', array['04:56', '09:45', '16:19', '21:19']::text[], null, 'demo'),
  ('else', '2026-06-23', 'vickers', array['05:04', '09:12', '15:36', '20:29']::text[], null, 'demo'),
  ('else', '2026-06-25', 'vickers', array['04:54', '09:18', '15:31', '20:47']::text[], null, 'demo'),
  ('else', '2026-06-27', 'vickers', array['05:05', '09:36', '15:52', '20:30']::text[], null, 'demo'),
  ('else', '2026-06-28', 'vickers', array['05:00', '09:10', '14:45', '19:40']::text[], null, 'demo'),
  ('else', '2026-06-29', 'vickers', array['04:55', '09:26', '16:01', '21:20']::text[], null, 'demo'),
  ('else', '2026-06-30', 'vickers', array['05:09', '09:54', '16:33', '20:56']::text[], null, 'demo'),
  ('else', '2026-07-02', 'vickers', array['04:52', '09:19', '15:24', '20:42']::text[], null, 'demo'),
  ('else', '2026-07-04', 'vickers', array['04:56', '09:28', '16:07', '20:55']::text[], null, 'demo'),
  ('else', '2026-07-05', 'vickers', array['05:02', '10:04', '15:36', '19:39']::text[], null, 'demo'),
  ('else', '2026-07-06', 'vickers', array['05:05', '09:35', '14:55', '20:06']::text[], null, 'demo'),
  ('else', '2026-07-07', 'vickers', array['04:51', '09:36', '16:17', '20:36']::text[], null, 'demo'),
  ('else', '2026-07-09', 'vickers', array['05:06', '09:14', '15:22', '20:19']::text[], null, 'demo'),
  ('else', '2026-07-11', 'vickers', array['04:59', '09:42', '15:41', '20:15']::text[], null, 'demo'),
  ('else', '2026-07-12', 'vickers', array['05:06', '09:34', '14:57', '20:17']::text[], null, 'demo'),
  ('else', '2026-07-13', 'vickers', array['04:57', '09:41', '15:11', '20:21']::text[], null, 'demo'),
  ('else', '2026-07-14', 'vickers', array['05:03', '10:05', '16:26', '21:15']::text[], null, 'demo'),
  ('else', '2026-07-16', 'vickers', array['05:03', '09:59', '16:29', '20:41']::text[], null, 'demo'),
  ('else', '2026-07-18', 'vickers', array['04:59', '09:18', '15:11', '20:10']::text[], null, 'demo'),
  ('else', '2026-07-19', 'vickers', array['04:54', '09:40', '15:28', '19:48']::text[], null, 'demo'),
  ('else', '2026-07-20', 'vickers', array['05:09', '10:16', '15:41', '20:05']::text[], null, 'demo'),
  ('else', '2026-07-21', 'vickers', array['04:54', '09:34', '15:55', '20:22']::text[], null, 'demo'),
  ('else', '2026-07-23', 'vickers', array['05:04', '09:18', '14:41', '19:54']::text[], null, 'demo'),
  ('else', '2026-07-25', 'vickers', array['04:52', '09:53', '15:16', '20:06']::text[], null, 'demo'),
  ('else', '2026-07-26', 'vickers', array['05:01', '10:05', '16:08', '20:57']::text[], null, 'demo'),
  ('else', '2026-07-27', 'vickers', array['05:08', '09:50', '15:19', '20:09']::text[], null, 'demo'),
  ('else', '2026-07-28', 'vickers', array['04:56', '09:07', '15:26', '20:26']::text[], null, 'demo'),
  ('else', '2026-07-30', 'vickers', array['04:55', '09:53', '15:45', '19:48']::text[], null, 'demo'),
  ('else', '2026-08-01', 'vickers', array['04:50', '09:23', '15:35', '20:48']::text[], null, 'demo'),
  ('else', '2026-08-02', 'vickers', array['05:01', '09:44', '15:20', '19:59']::text[], null, 'demo'),
  ('else', '2026-08-03', 'vickers', array['05:10', '09:36', '15:08', '19:56']::text[], null, 'demo'),
  ('else', '2026-08-04', 'vickers', array['04:57', '10:14', '15:38', '19:55']::text[], null, 'demo'),
  ('else', '2026-08-06', 'vickers', array['04:51', '09:12', '15:33', '20:13']::text[], null, 'demo'),
  ('else', '2026-08-08', 'vickers', array['05:09', '10:09', '15:50', '20:22']::text[], null, 'demo'),
  ('else', '2026-08-09', 'vickers', array['05:05', '09:25', '14:52', '20:02']::text[], null, 'demo'),
  ('else', '2026-08-10', 'vickers', array['05:00', '10:08', '16:40', '21:16']::text[], null, 'demo'),
  ('else', '2026-08-11', 'vickers', array['04:57', '09:38', '16:08', '20:35']::text[], null, 'demo'),
  ('else', '2026-08-13', 'vickers', array['05:05', '10:21', '15:51', '20:28']::text[], null, 'demo'),
  ('else', '2026-08-15', 'vickers', array['05:03', '09:44', '15:08', '19:30']::text[], null, 'demo'),
  ('else', '2026-08-16', 'vickers', array['04:53', '09:44', '15:51', '20:10']::text[], null, 'demo'),
  ('else', '2026-08-17', 'vickers', array['05:02', '09:56', '16:31', '21:11']::text[], null, 'demo'),
  ('else', '2026-08-18', 'vickers', array['04:59', '09:57', '15:12', '19:48']::text[], null, 'demo'),
  ('else', '2026-08-20', 'vickers', array['05:07', '09:11', '15:53', '20:56']::text[], null, 'demo'),
  ('else', '2026-08-22', 'vickers', array['04:52', '09:17', '15:47', '20:32']::text[], null, 'demo'),
  ('else', '2026-08-23', 'vickers', array['05:04', '09:13', '14:39', '19:38']::text[], null, 'demo'),
  ('else', '2026-08-24', 'vickers', array['04:56', '09:15', '15:22', '20:12']::text[], null, 'demo'),
  ('else', '2026-08-25', 'vickers', array['05:02', '09:46', '15:03', '20:11']::text[], null, 'demo'),
  ('else', '2026-08-27', 'vickers', array['05:08', '09:59', '16:07', '20:49']::text[], null, 'demo'),
  ('else', '2026-08-29', 'vickers', array['04:51', '09:09', '15:25', '20:12']::text[], null, 'demo'),
  ('else', '2026-08-30', 'vickers', array['04:59', '09:05', '14:50', '19:53']::text[], null, 'demo'),
  ('else', '2026-08-31', 'vickers', array['04:53', '09:15', '15:14', '20:11']::text[], null, 'demo'),
  ('else', '2026-09-01', 'vickers', array['05:06', '09:35', '16:07', '21:33']::text[], null, 'demo'),
  ('else', '2026-09-03', 'vickers', array['05:04', '09:56', '16:13', '20:36']::text[], null, 'demo'),
  ('else', '2026-09-05', 'vickers', array['05:06', '09:19', '15:07', '20:01']::text[], null, 'demo'),
  ('else', '2026-09-06', 'vickers', array['04:51', '09:23', '16:03', '21:25']::text[], null, 'demo'),
  ('else', '2026-09-07', 'vickers', array['04:53', '09:24', '15:22', '20:41']::text[], null, 'demo'),
  ('else', '2026-09-08', 'vickers', array['04:57', '10:02', '15:25', '19:31']::text[], null, 'demo'),
  ('else', '2026-09-10', 'vickers', array['05:00', '09:49', '15:32', '20:00']::text[], null, 'demo'),
  ('else', '2026-09-12', 'vickers', array['05:05', '09:41', '16:18', '21:06']::text[], null, 'demo'),
  ('else', '2026-09-13', 'vickers', array['04:53', '09:59', '15:52', '20:25']::text[], null, 'demo'),
  ('else', '2026-09-14', 'vickers', array['04:54', '09:29', '15:02', '20:06']::text[], null, 'demo'),
  ('else', '2026-09-15', 'vickers', array['04:56', '10:00', '15:47', '20:17']::text[], null, 'demo'),
  ('else', '2026-09-17', 'vickers', array['05:04', '09:40', '16:22', '21:18']::text[], null, 'demo'),
  ('else', '2026-09-19', 'vickers', array['04:55', '09:32', '15:59', '20:42']::text[], null, 'demo'),
  ('else', '2026-09-20', 'vickers', array['04:59', '09:46', '15:08', '19:48']::text[], null, 'demo'),
  ('else', '2026-09-21', 'vickers', array['04:54', '10:11', '15:58', '20:23']::text[], null, 'demo'),
  ('else', '2026-09-22', 'vickers', array['05:04', '09:48', '15:08', '20:04']::text[], null, 'demo'),
  ('else', '2026-09-24', 'vickers', array['05:08', '10:01', '16:01', '20:18']::text[], null, 'demo'),
  ('else', '2026-09-26', 'vickers', array['04:53', '09:32', '15:05', '19:54']::text[], null, 'demo'),
  ('else', '2026-09-27', 'vickers', array['04:59', '10:23', '17:00', '21:27']::text[], null, 'demo'),
  ('else', '2026-09-28', 'vickers', array['05:08', '09:57', '15:55', '20:10']::text[], null, 'demo'),
  ('else', '2026-09-29', 'vickers', array['05:08', '10:07', '15:44', '20:35']::text[], null, 'demo'),
  ('else', '2026-10-01', 'vickers', array['04:55', '09:47', '15:50', '20:00']::text[], null, 'demo'),
  ('carolina', '2026-05-11', 'laang', array['05:04', '09:40', '15:26', '20:22']::text[], null, 'demo'),
  ('carolina', '2026-05-12', 'laang', array['04:59', '10:01', '15:42', '20:00']::text[], null, 'demo'),
  ('carolina', '2026-05-13', 'laang', array['04:55', '09:46', '15:12', '19:25']::text[], null, 'demo'),
  ('carolina', '2026-05-14', 'laang', array['05:05', '09:31', '15:42', '20:37']::text[], null, 'demo'),
  ('carolina', '2026-05-17', 'laang', array['05:05', '09:57', '15:22', '19:56']::text[], null, 'demo'),
  ('carolina', '2026-05-18', 'laang', array['04:54', '09:42', '15:20', '19:48']::text[], null, 'demo'),
  ('carolina', '2026-05-19', 'laang', array['05:07', '09:38', '15:08', '20:30']::text[], null, 'demo'),
  ('carolina', '2026-05-20', 'laang', array['04:54', '09:24', '16:00', '20:30']::text[], null, 'demo'),
  ('carolina', '2026-05-21', 'laang', array['05:00', '09:43', '15:51', '20:13']::text[], null, 'demo'),
  ('carolina', '2026-05-24', 'laang', array['04:52', '09:41', '15:04', '20:12']::text[], null, 'demo'),
  ('carolina', '2026-05-25', 'laang', array['04:57', '09:20', '15:12', '20:20']::text[], null, 'demo'),
  ('carolina', '2026-05-26', 'laang', array['04:53', '09:56', '15:19', '19:31']::text[], null, 'demo'),
  ('carolina', '2026-05-27', 'laang', array['04:50', '09:09', '15:21', '20:25']::text[], null, 'demo'),
  ('carolina', '2026-05-28', 'laang', array['04:59', '09:17', '16:00', '21:15']::text[], null, 'demo'),
  ('carolina', '2026-05-31', 'laang', array['05:01', '09:31', '15:54', '20:41']::text[], null, 'demo'),
  ('carolina', '2026-06-01', 'laang', array['05:00', '09:31', '15:46', '20:39']::text[], null, 'demo'),
  ('carolina', '2026-06-02', 'laang', array['05:01', '09:28', '16:09', '21:30']::text[], null, 'demo'),
  ('carolina', '2026-06-03', 'laang', array['05:08', '10:01', '16:05', '21:10']::text[], null, 'demo'),
  ('carolina', '2026-06-04', 'laang', array['04:59', '10:03', '16:31', '20:40']::text[], null, 'demo'),
  ('carolina', '2026-06-07', 'laang', array['05:06', '09:41', '15:14', '19:40']::text[], null, 'demo'),
  ('carolina', '2026-06-08', 'laang', array['04:53', '10:16', '16:16', '20:40']::text[], null, 'demo'),
  ('carolina', '2026-06-09', 'laang', array['04:52', '09:22', '16:04', '21:25']::text[], null, 'demo'),
  ('carolina', '2026-06-10', 'laang', array['04:58', '09:13', '14:31', '19:34']::text[], null, 'demo'),
  ('carolina', '2026-06-11', 'laang', array['05:00', '09:35', '15:22', '20:00']::text[], null, 'demo'),
  ('carolina', '2026-06-14', 'laang', array['04:51', '09:23', '14:50', '20:15']::text[], null, 'demo'),
  ('carolina', '2026-06-15', 'laang', array['04:56', '09:24', '15:10', '20:07']::text[], null, 'demo'),
  ('carolina', '2026-06-16', 'laang', array['05:00', '09:26', '16:03', '21:18']::text[], null, 'demo'),
  ('carolina', '2026-06-17', 'laang', array['04:57', '09:27', '15:38', '20:34']::text[], null, 'demo'),
  ('carolina', '2026-06-18', 'laang', array['04:57', '09:39', '15:44', '20:38']::text[], null, 'demo'),
  ('carolina', '2026-06-21', 'laang', array['05:05', '09:49', '15:13', '20:26']::text[], null, 'demo'),
  ('carolina', '2026-06-22', 'laang', array['05:00', '10:01', '15:59', '20:35']::text[], null, 'demo'),
  ('carolina', '2026-06-23', 'laang', array['04:51', '09:38', '16:21', '20:43']::text[], null, 'demo'),
  ('carolina', '2026-06-24', 'laang', array['05:04', '09:37', '15:09', '20:03']::text[], null, 'demo'),
  ('carolina', '2026-06-25', 'laang', array['04:59', '09:36', '15:05', '20:14']::text[], null, 'demo'),
  ('carolina', '2026-06-28', 'laang', array['04:53', '09:36', '15:30', '20:00']::text[], null, 'demo'),
  ('carolina', '2026-06-29', 'laang', array['04:52', '09:26', '15:43', '20:42']::text[], null, 'demo'),
  ('carolina', '2026-06-30', 'laang', array['05:08', '09:13', '14:30', '19:35']::text[], null, 'demo'),
  ('carolina', '2026-07-01', 'laang', array['04:58', '10:15', '15:32', '19:55']::text[], null, 'demo'),
  ('carolina', '2026-07-02', 'laang', array['05:06', '09:30', '15:38', '20:19']::text[], null, 'demo'),
  ('carolina', '2026-07-05', 'laang', array['05:06', '10:08', '15:30', '20:17']::text[], null, 'demo'),
  ('carolina', '2026-07-06', 'laang', array['04:53', '09:50', '15:21', '19:52']::text[], null, 'demo'),
  ('carolina', '2026-07-07', 'laang', array['05:01', '09:40', '15:03', '19:49']::text[], null, 'demo'),
  ('carolina', '2026-07-08', 'laang', array['04:53', '09:30', '16:12', '21:09']::text[], null, 'demo'),
  ('carolina', '2026-07-09', 'laang', array['04:56', '09:15', '14:49', '19:35']::text[], null, 'demo'),
  ('carolina', '2026-07-12', 'laang', array['05:07', '09:53', '15:11', '20:04']::text[], null, 'demo'),
  ('carolina', '2026-07-13', 'laang', array['05:02', '09:46', '15:42', '20:29']::text[], null, 'demo'),
  ('carolina', '2026-07-14', 'laang', array['05:07', '09:50', '16:29', '21:16']::text[], null, 'demo'),
  ('carolina', '2026-07-15', 'laang', array['05:10', '09:57', '15:48', '20:13']::text[], null, 'demo'),
  ('carolina', '2026-07-16', 'laang', array['05:05', '10:06', '15:23', '20:14']::text[], null, 'demo'),
  ('carolina', '2026-07-19', 'laang', array['05:10', '10:01', '15:56', '21:04']::text[], null, 'demo'),
  ('carolina', '2026-07-20', 'laang', array['04:57', '09:47', '16:27', '20:55']::text[], null, 'demo'),
  ('carolina', '2026-07-21', 'laang', array['05:07', '09:52', '15:22', '20:34']::text[], null, 'demo'),
  ('carolina', '2026-07-22', 'laang', array['05:09', '09:51', '16:23', '21:17']::text[], null, 'demo'),
  ('carolina', '2026-07-23', 'laang', array['04:54', '09:49', '16:16', '20:34']::text[], null, 'demo'),
  ('carolina', '2026-07-26', 'laang', array['05:00', '10:10', '16:51', '21:16']::text[], null, 'demo'),
  ('carolina', '2026-07-27', 'laang', array['05:08', '10:28', '16:43', '21:23']::text[], null, 'demo'),
  ('carolina', '2026-07-28', 'laang', array['05:00', '09:37', '15:01', '19:58']::text[], null, 'demo'),
  ('carolina', '2026-07-29', 'laang', array['04:55', '09:53', '15:51', '19:55']::text[], null, 'demo'),
  ('carolina', '2026-07-30', 'laang', array['04:57', '09:22', '15:37', '20:51']::text[], null, 'demo'),
  ('carolina', '2026-08-02', 'laang', array['05:03', '09:50', '16:04', '20:29']::text[], null, 'demo'),
  ('carolina', '2026-08-03', 'laang', array['05:04', '10:01', '15:49', '20:50']::text[], null, 'demo'),
  ('carolina', '2026-08-04', 'laang', array['04:56', '10:03', '16:24', '20:57']::text[], null, 'demo'),
  ('carolina', '2026-08-05', 'laang', array['04:56', '09:59', '16:08', '20:52']::text[], null, 'demo'),
  ('carolina', '2026-08-06', 'laang', array['05:09', '09:31', '14:59', '20:05']::text[], null, 'demo'),
  ('carolina', '2026-08-09', 'laang', array['04:51', '09:27', '15:19', '19:48']::text[], null, 'demo'),
  ('carolina', '2026-08-10', 'laang', array['05:06', '10:06', '16:10', '20:20']::text[], null, 'demo'),
  ('carolina', '2026-08-11', 'laang', array['04:55', '10:03', '16:15', '21:03']::text[], null, 'demo'),
  ('carolina', '2026-08-12', 'laang', array['04:51', '09:17', '14:56', '19:53']::text[], null, 'demo'),
  ('carolina', '2026-08-13', 'laang', array['04:53', '09:36', '15:26', '19:58']::text[], null, 'demo'),
  ('carolina', '2026-08-16', 'laang', array['05:07', '09:56', '16:35', '21:17']::text[], null, 'demo'),
  ('carolina', '2026-08-17', 'laang', array['04:57', '09:14', '15:35', '20:51']::text[], null, 'demo'),
  ('carolina', '2026-08-18', 'laang', array['04:52', '09:33', '15:13', '20:26']::text[], null, 'demo'),
  ('carolina', '2026-08-19', 'laang', array['05:06', '10:11', '16:27', '21:07']::text[], null, 'demo'),
  ('carolina', '2026-08-20', 'laang', array['04:59', '09:59', '16:17', '20:30']::text[], null, 'demo'),
  ('carolina', '2026-08-23', 'laang', array['05:09', '10:21', '16:00', '20:15']::text[], null, 'demo'),
  ('carolina', '2026-08-24', 'laang', array['05:06', '09:43', '16:27', '21:42']::text[], null, 'demo'),
  ('carolina', '2026-08-25', 'laang', array['05:00', '09:27', '15:16', '20:42']::text[], null, 'demo'),
  ('carolina', '2026-08-26', 'laang', array['05:04', '10:11', '16:06', '20:20']::text[], null, 'demo'),
  ('carolina', '2026-08-27', 'laang', array['05:02', '09:47', '16:19', '21:24']::text[], null, 'demo'),
  ('carolina', '2026-08-30', 'laang', array['04:53', '09:06', '15:28', '20:34']::text[], null, 'demo'),
  ('carolina', '2026-08-31', 'laang', array['04:54', '09:07', '14:34', '19:36']::text[], null, 'demo'),
  ('carolina', '2026-09-01', 'laang', array['05:02', '10:10', '15:31', '19:53']::text[], null, 'demo'),
  ('carolina', '2026-09-02', 'laang', array['05:00', '09:07', '14:58', '19:59']::text[], null, 'demo'),
  ('carolina', '2026-09-03', 'laang', array['05:04', '09:42', '16:13', '21:29']::text[], null, 'demo'),
  ('carolina', '2026-09-06', 'laang', array['04:53', '09:50', '15:45', '20:34']::text[], null, 'demo'),
  ('carolina', '2026-09-07', 'laang', array['04:53', '08:59', '14:46', '19:46']::text[], null, 'demo'),
  ('carolina', '2026-09-08', 'laang', array['05:00', '09:24', '15:25', '20:36']::text[], null, 'demo'),
  ('carolina', '2026-09-09', 'laang', array['05:08', '09:58', '15:39', '20:33']::text[], null, 'demo'),
  ('carolina', '2026-09-10', 'laang', array['04:54', '09:19', '15:39', '20:26']::text[], null, 'demo'),
  ('carolina', '2026-09-13', 'laang', array['05:07', '10:19', '15:55', '20:08']::text[], null, 'demo'),
  ('carolina', '2026-09-14', 'laang', array['05:07', '10:03', '15:29', '20:00']::text[], null, 'demo'),
  ('carolina', '2026-09-15', 'laang', array['05:02', '09:32', '14:59', '20:00']::text[], null, 'demo'),
  ('carolina', '2026-09-16', 'laang', array['05:08', '09:46', '15:41', '20:34']::text[], null, 'demo'),
  ('carolina', '2026-09-17', 'laang', array['04:56', '09:43', '16:05', '20:44']::text[], null, 'demo'),
  ('carolina', '2026-09-20', 'laang', array['04:57', '10:07', '15:27', '19:48']::text[], null, 'demo'),
  ('carolina', '2026-09-21', 'laang', array['05:00', '10:10', '15:28', '19:50']::text[], null, 'demo'),
  ('carolina', '2026-09-22', 'laang', array['04:56', '09:43', '15:22', '19:52']::text[], null, 'demo'),
  ('carolina', '2026-09-23', 'laang', array['04:57', '09:49', '15:16', '20:23']::text[], null, 'demo'),
  ('carolina', '2026-09-24', 'laang', array['05:06', '09:52', '15:15', '20:29']::text[], null, 'demo'),
  ('carolina', '2026-09-27', 'laang', array['04:55', '09:37', '15:57', '20:30']::text[], null, 'demo'),
  ('carolina', '2026-09-28', 'laang', array['04:54', '10:14', '16:03', '20:33']::text[], null, 'demo'),
  ('carolina', '2026-09-29', 'laang', array['05:08', '09:38', '15:38', '21:01']::text[], null, 'demo'),
  ('carolina', '2026-09-30', 'laang', array['05:06', '09:51', '15:54', '20:45']::text[], null, 'demo'),
  ('carolina', '2026-10-01', 'laang', array['04:50', '10:07', '16:33', '21:12']::text[], null, 'demo')
) as v(emp_code, work_date, farm_code, times, note, source);

insert into timesheet_shifts (employee_id, farm_id, work_date, note, source)
select e.id, f.id, i.work_date, i.note, i.source
from imported_hours i
join employees e on e.code = i.emp_code
join farms f on f.code = i.farm_code;

insert into timesheet_segments (shift_id, start_time, end_time, end_reason)
select s.id, i.times[n], i.times[n + 1],
       case when n + 1 = array_length(i.times, 1) then 'end_of_day' else 'meal_break' end
from imported_hours i
join employees e on e.code = i.emp_code
join timesheet_shifts s on s.employee_id = e.id and s.work_date = i.work_date
cross join generate_series(1, array_length(i.times, 1), 2) as n;

do $$
begin
  if (select count(*) from timesheet_shifts) <> 350
  or (select count(*) from timesheet_segments) <> (select sum(array_length(times, 1)) / 2 from imported_hours) then
    raise exception 'Hours import incomplete';
  end if;
end $$;

-- ---------- 4. DEMO access -----------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['companies', 'farms', 'employees', 'employee_farms', 'roster_shifts',
                           'timesheet_shifts', 'timesheet_segments', 'timesheet_approvals', 'public_holidays',
                           'farm_plans', 'farm_plan_refs', 'farm_plan_paddocks'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "anon full access (DEMO)" on %I for all to anon using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on %I to anon', t);
  end loop;
end $$;

commit;
