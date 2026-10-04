-- Backfill: real rosters 1 June – 11 October 2026, and demo timesheets
-- that follow them (1 June – 3 October). Run once in the Supabase SQL editor.
--
-- What it does:
--   1. Final names: Junior → Daniel, Else → Emily, Ani → Chloe; Greg and
--      Violette employed again. Safe to re-run if already done.
--   2. Adds the staff who appear on the rosters: Pat, Jess, Josh, Sarah, Kate.
--   3. Replaces every roster day from 1 June to 11 October.
--   4. Replaces the 'demo' timesheets from 1 June with times that follow the
--      roster. Greg and Violette keep only their real hours: nothing is
--      generated for them.

begin;

-- 1. Final names -----------------------------------------------------------
update employees set code = 'daniel', preferred_name = 'Daniel' where code = 'junior';
update employees set code = 'emily',  preferred_name = 'Emily'  where code = 'else';
update employees set code = 'chloe',  preferred_name = 'Chloe'  where code = 'ani';
update employees set end_date = null where code in ('greg', 'violette');

-- 2. Staff from the rosters (end_date = last rostered day) ------------------
insert into employees (company_id, code, preferred_name, employment_type, classification,
                       start_date, end_date, cycle_start, sort_order)
select f.company_id, p.code, p.name, 'casual', 'FLH1', '2026-06-01', p.end_date, '2026-06-01', p.sort_order
from farms f
cross join (values
  ('pat',   'Pat',   date '2026-09-26', 4),
  ('jess',  'Jess',  date '2026-09-26', 5),
  ('josh',  'Josh',  date '2026-07-05', 6),
  ('sarah', 'Sarah', date '2026-06-23', 7),
  ('kate',  'Kate',  date '2026-07-05', 8)
) as p(code, name, end_date, sort_order)
where f.code = 'maguires'
on conflict (company_id, code) do nothing;

-- 3. Rosters ---------------------------------------------------------------
-- One line per person per week, Monday to Sunday:
--   J = John's farm (Maguires), D = Damian's farm (Vickers),
--   P = Peter's farm (Laang), . = day off, - = not on the roster yet / any more.
create temp table roster_input (code text, monday date, days text) on commit drop;
insert into roster_input values
  ('greg', '2026-06-01', 'JJ.JJ.J'), ('violette', '2026-06-01', 'JJ.JJ.J'),
  ('emily', '2026-06-01', 'D.DDD.D'), ('pat', '2026-06-01', 'JJJ....'),
  ('jess', '2026-06-01', 'DDJ..J.'), ('josh', '2026-06-01', 'D..DDDD'),
  ('sarah', '2026-06-01', '.DDDDD.'), ('kate', '2026-06-01', 'PDD..DP'),
  ('carolina', '2026-06-01', '.PPPPP.'),

  ('greg', '2026-06-08', '.JJJJ.J'), ('violette', '2026-06-08', '.JJJJ.J'),
  ('emily', '2026-06-08', 'DDD.DDD'), ('pat', '2026-06-08', '.......'),
  ('jess', '2026-06-08', 'JDDD.J.'), ('josh', '2026-06-08', 'D..DDDD'),
  ('sarah', '2026-06-08', '.DDD.DD'), ('kate', '2026-06-08', 'P.PPDPP'),
  ('carolina', '2026-06-08', '.PPPPP.'),

  ('greg', '2026-06-15', '.JJJJJ.'), ('violette', '2026-06-15', '.JJJJJ.'),
  ('emily', '2026-06-15', 'D.DDDD.'), ('pat', '2026-06-15', '.......'),
  ('jess', '2026-06-15', 'JD.DD.J'), ('josh', '2026-06-15', 'DDD.DDD'),
  ('sarah', '2026-06-15', 'DDDD.DD'), ('kate', '2026-06-15', 'P.PPPP.'),
  ('carolina', '2026-06-15', '.PPPP.P'),

  ('greg', '2026-06-22', 'JJJJJ..'), ('violette', '2026-06-22', 'JJJJJ..'),
  ('emily', '2026-06-22', 'D.DDDD.'), ('pat', '2026-06-22', '.....JJ'),
  ('jess', '2026-06-22', '.D.DDJJ'), ('josh', '2026-06-22', 'DDD.DDD'),
  ('sarah', '2026-06-22', 'DD-----'), ('kate', '2026-06-22', 'P.D.DPP'),
  ('carolina', '2026-06-22', '.PPPPP.'),

  ('greg', '2026-06-29', 'JJJJJ..'), ('violette', '2026-06-29', 'JJJJJ..'),
  ('emily', '2026-06-29', '...DDDD'), ('pat', '2026-06-29', 'DDD..JJ'),
  ('jess', '2026-06-29', 'DDD..JJ'), ('josh', '2026-06-29', '.DDDDDD'),
  ('kate', '2026-06-29', 'P.DDDPP'), ('carolina', '2026-06-29', '.PPPPP.'),

  ('greg', '2026-07-06', 'JJ..JJJ'), ('violette', '2026-07-06', 'JJ..JJJ'),
  ('emily', '2026-07-06', 'D.DDDD.'), ('pat', '2026-07-06', 'DDJJD.D'),
  ('jess', '2026-07-06', 'DDJJ.DD'), ('carolina', '2026-07-06', 'PPPPPP.'),

  ('greg', '2026-07-13', 'JJ.JJJ.'), ('violette', '2026-07-13', 'JJ.JJJ.'),
  ('emily', '2026-07-13', 'D.DDDD.'), ('pat', '2026-07-13', 'DDJ.D.J'),
  ('jess', '2026-07-13', '.DDD.DD'), ('carolina', '2026-07-13', '.PPPPP.'),

  ('greg', '2026-07-20', 'DD..DDD'), ('violette', '2026-07-20', 'JJ..JJJ'),
  ('emily', '2026-07-20', 'D.DD.DD'), ('pat', '2026-07-20', 'DDJJD..'),
  ('jess', '2026-07-20', '.DDDDD.'), ('carolina', '2026-07-20', '.PPPPP.'),

  ('greg', '2026-07-27', 'DD..DDD'), ('violette', '2026-07-27', 'JJ..JJJ'),
  ('emily', '2026-07-27', 'D.DD.DD'), ('pat', '2026-07-27', 'DDJJD..'),
  ('jess', '2026-07-27', '.DDDDD.'), ('carolina', '2026-07-27', '.PPPPP.'),

  ('greg', '2026-08-03', 'D..DDDD'), ('violette', '2026-08-03', 'J..JJJJ'),
  ('emily', '2026-08-03', 'DDDDD..'), ('pat', '2026-08-03', 'DJJ..DD'),
  ('jess', '2026-08-03', '.DDD.DD'), ('carolina', '2026-08-03', '..PPPPP'),

  ('greg', '2026-08-10', 'DD.DDD.'), ('violette', '2026-08-10', 'JJ.JJJ.'),
  ('emily', '2026-08-10', 'D.DDD.D'), ('pat', '2026-08-10', 'DDJ.D.J'),
  ('jess', '2026-08-10', '.DDD.DD'), ('carolina', '2026-08-10', '.PPPPP.'),

  ('greg', '2026-08-17', 'DD..DDD'), ('violette', '2026-08-17', 'JJ..JJJ'),
  ('emily', '2026-08-17', 'D.DDD.D'), ('pat', '2026-08-17', 'DDJJD..'),
  ('jess', '2026-08-17', '.DDD.DD'), ('carolina', '2026-08-17', '.PPPPP.'),

  ('greg', '2026-08-24', 'DD..DDD'), ('violette', '2026-08-24', 'JJ..JJJ'),
  ('emily', '2026-08-24', 'D.DDD.D'), ('pat', '2026-08-24', 'DDJJD..'),
  ('jess', '2026-08-24', '.DDD.D.'), ('carolina', '2026-08-24', '.PPPPP.'),

  ('greg', '2026-08-31', 'DD..DDD'), ('violette', '2026-08-31', 'JJ..JJJ'),
  ('emily', '2026-08-31', 'D.DDDD.'), ('pat', '2026-08-31', 'D.JJD.D'),
  ('jess', '2026-08-31', '.DDD.DD'), ('carolina', '2026-08-31', '.PPPPP.'),

  ('greg', '2026-09-07', 'DDDD..D'), ('violette', '2026-09-07', 'JJJJJ..'),
  ('emily', '2026-09-07', 'D.DDDD.'), ('pat', '2026-09-07', 'DD..DJJ'),
  ('jess', '2026-09-07', '.DDD.DD'), ('carolina', '2026-09-07', '.PPPPP.'),

  ('greg', '2026-09-14', 'J.D.DJJ'), ('violette', '2026-09-14', 'J.J.JJJ'),
  ('emily', '2026-09-14', 'DDDD...'), ('pat', '2026-09-14', '.J.JDDD'),
  ('jess', '2026-09-14', 'DD.D.DD'), ('carolina', '2026-09-14', '.PP.PPP'),

  ('greg', '2026-09-21', 'JJJ..JJ'), ('violette', '2026-09-21', 'JJJ..JJ'),
  ('emily', '2026-09-21', '.DDD..D'), ('pat', '2026-09-21', 'D..JJD.'),
  ('jess', '2026-09-21', '.DD.DD.'), ('chloe', '2026-09-21', '--DD..D'),
  ('carolina', '2026-09-21', 'P..PPPP'),

  ('greg', '2026-09-28', '.......'), ('violette', '2026-09-28', '.......'),
  ('emily', '2026-09-28', 'DD.DDD.'), ('chloe', '2026-09-28', 'DDDD..D'),
  ('daniel', '2026-09-28', 'JJJJ..J'), ('carolina', '2026-09-28', '.PPPPP.'),

  ('greg', '2026-10-05', '.DDDD.D'), ('violette', '2026-10-05', '.DDD.DD'),
  ('emily', '2026-10-05', 'D.DDDD.'), ('chloe', '2026-10-05', 'D.JJJ.J'),
  ('daniel', '2026-10-05', 'JJJ..JJ'), ('carolina', '2026-10-05', '.PPPPP.');

create temp table roster_days on commit drop as
select e.id as employee_id, r.monday + (d.n - 1) as work_date,
       (select f.id from farms f
        where f.company_id = e.company_id
          and f.code = case substr(r.days, d.n, 1) when 'J' then 'maguires' when 'D' then 'vickers' when 'P' then 'laang' end) as farm_id
from roster_input r
join employees e on e.code = r.code
cross join generate_series(1, 7) as d(n)
where substr(r.days, d.n, 1) <> '-';

delete from roster_shifts where work_date between '2026-06-01' and '2026-10-11';
insert into roster_shifts (employee_id, work_date, farm_id)
select employee_id, work_date, farm_id from roster_days;

-- Everyone is trained on the farms they were rostered on.
insert into employee_farms (employee_id, farm_id)
select distinct employee_id, farm_id from roster_days where farm_id is not null
on conflict do nothing;

-- 4. Timesheets ------------------------------------------------------------
-- Typical day by farm (minutes are picked at random inside each range):
--   Vickers:  start 3:40–4:20, meal break from 9:20–10:45, back 12:45–13:30, end 18:15–18:45
--   Laang:    start 5:20–5:40, then the same as Vickers
--   Maguires: start 4:20–4:40, meal break from 8:35–8:55, back 12:50–13:10, end 17:20–17:40
delete from timesheet_shifts t
using employees e
where e.id = t.employee_id and t.source = 'demo' and t.work_date >= '2026-06-01'
  and e.code not in ('greg', 'violette');

select setseed(0.2026);  -- same times every time the script is tested

create temp table demo_days on commit drop as
select rd.employee_id, rd.farm_id, rd.work_date,
       time '00:00' + make_interval(mins => s.base_start + floor(random() * s.start_spread)::int) as start_time,
       time '00:00' + make_interval(mins => s.base_break + floor(random() * s.break_spread)::int) as break_time,
       time '00:00' + make_interval(mins => s.base_back + floor(random() * s.back_spread)::int) as back_time,
       time '00:00' + make_interval(mins => s.base_end + floor(random() * s.end_spread)::int) as end_time
from roster_days rd
join employees e on e.id = rd.employee_id
join farms f on f.id = rd.farm_id
join (values
  -- farm,      start (min, spread), meal break,  back,       end
  ('vickers',  220, 41,  560, 86,  765, 46,  1095, 31),
  ('laang',    320, 21,  560, 86,  765, 46,  1095, 31),
  ('maguires', 260, 21,  515, 21,  770, 21,  1040, 21)
) as s(farm_code, base_start, start_spread, base_break, break_spread, base_back, back_spread, base_end, end_spread)
  on s.farm_code = f.code
where rd.work_date <= '2026-10-03'
  and e.code not in ('greg', 'violette');

insert into timesheet_shifts (employee_id, farm_id, work_date, status, source)
select employee_id, farm_id, work_date, 'complete', 'demo' from demo_days
on conflict (employee_id, work_date) do nothing;

insert into timesheet_segments (shift_id, start_time, end_time, end_reason)
select t.id, seg.start_time, seg.end_time, seg.end_reason
from demo_days d
join timesheet_shifts t on t.employee_id = d.employee_id and t.work_date = d.work_date and t.source = 'demo'
cross join lateral (values
  (d.start_time, d.break_time, 'meal_break'),
  (d.back_time,  d.end_time,   'end_of_day')
) as seg(start_time, end_time, end_reason);

commit;
