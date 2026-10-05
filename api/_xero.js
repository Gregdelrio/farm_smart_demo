/* Shared helpers for the Xero functions. Vercel does not expose files
   starting with "_" as routes.
   Secrets come from Vercel environment variables, never from the repo:
   XERO_CLIENT_ID, XERO_CLIENT_SECRET, SUPABASE_SERVICE_ROLE_KEY, MANAGER_CODE. */

const crypto = require('crypto');

// Public, same project as js/core.js.
const SUPABASE_URL = 'https://gissuvlnkztpbvghymmz.supabase.co';
const REDIRECT_URI = 'https://farm-smart-demo.vercel.app/api/xero-callback';
const SCOPES = 'offline_access payroll.employees.read payroll.settings.read payroll.timesheets';
const PAYROLL_URL = 'https://api.xero.com/payroll.xro/1.0';

/** True when `pin` matches MANAGER_CODE, compared in constant time. */
function checkPin(pin) {
  const expected = Buffer.from(process.env.MANAGER_CODE || '');
  const given = Buffer.from(String(pin || ''));
  return expected.length > 0 && given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** Supabase REST call with the service_role key (bypasses row-level security). */
async function db(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${path.split('?')[0]}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

/** Asks Xero for tokens, from a login code or a refresh token. */
async function requestTokens(params) {
  const basic = Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  if (!res.ok) throw new Error(`Xero token: ${res.status} ${await res.text()}`);
  return res.json();
}

function saveTokens(companyId, tokens) {
  return db('xero_tokens?on_conflict=company_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates',
    body: {
      company_id: companyId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    },
  });
}

/** A working access token for the company, refreshed when about to expire; null if not connected. */
async function accessToken(companyId) {
  const [row] = await db(`xero_tokens?company_id=eq.${encodeURIComponent(companyId)}&select=*`);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() - Date.now() > 60 * 1000) return row.access_token;
  const tokens = await requestTokens({ grant_type: 'refresh_token', refresh_token: row.refresh_token });
  await saveTokens(companyId, tokens);
  return tokens.access_token;
}

/** Xero API call for one organisation. */
async function xero(token, tenantId, url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Xero-tenant-id': tenantId,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

module.exports = { SCOPES, REDIRECT_URI, PAYROLL_URL, checkPin, db, requestTokens, saveTokens, accessToken, xero };
