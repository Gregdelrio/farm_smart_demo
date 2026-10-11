-- 003: what the Vercel functions may do with the service_role key.
--
-- This Supabase project gives service_role no read or write rights on
-- new tables, so the Xero functions got "permission denied". Grant only
-- what /api needs: the Xero tokens, the company's Xero organisation id
-- and each employee's Xero id. Row-level security does not apply to
-- service_role, so no policy is needed.

begin;

grant select, insert, update on xero_tokens to service_role;
grant select, update on companies to service_role;
grant select, update on employees to service_role;

commit;
