-- 002: where the Xero connection is kept.
--
-- One row per company: the tokens Xero gives back when the farmer
-- connects. They are as sensitive as a password, so the table is closed:
-- row-level security on, no policy and no grant for the app's public
-- key. Only the Vercel functions read it, with the service_role key.
-- The Xero organisation id itself stays in companies.xero_tenant_id.

begin;

create table xero_tokens (
  company_id    uuid primary key references companies(id),
  access_token  text not null,            -- valid 30 minutes
  refresh_token text not null,            -- valid 60 days, replaced at each refresh
  expires_at    timestamptz not null,     -- when access_token stops working
  updated_at    timestamptz not null default now()
);

alter table xero_tokens enable row level security;
revoke all on xero_tokens from anon, authenticated;

commit;
