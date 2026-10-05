/* GET /api/xero-callback — Xero sends the farmer back here after they
   allow access. Swaps the one-time code for tokens and keeps them in the
   closed xero_tokens table, then returns to the app. */

const { REDIRECT_URI, db, requestTokens, saveTokens } = require('./_xero');

module.exports = async (req, res) => {
  const { code, state, error } = req.query;
  const cookie = (req.headers.cookie || '').split('; ').find((c) => c.startsWith('xero_state='));
  if (error) return res.redirect(302, '/?xero=cancelled');
  if (!code || !state || !cookie || cookie.slice('xero_state='.length) !== state) {
    return res.status(400).send('This Xero link has expired. Start again from FarmSmart.');
  }
  const companyId = state.split('.')[0];

  try {
    const tokens = await requestTokens({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI });
    // The organisation the farmer picked in Xero.
    const conn = await fetch('https://api.xero.com/connections', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const [tenant] = await conn.json();
    if (!tenant) throw new Error('No Xero organisation was shared.');

    await saveTokens(companyId, tokens);
    await db(`companies?id=eq.${encodeURIComponent(companyId)}`, {
      method: 'PATCH', body: { xero_tenant_id: tenant.tenantId, updated_at: new Date().toISOString() },
    });
    res.setHeader('Set-Cookie', 'xero_state=; Path=/api; Max-Age=0');
    res.redirect(302, '/?xero=connected');
  } catch (err) {
    console.error('[xero-callback]', err);
    res.status(500).send('Could not connect to Xero. Try again from FarmSmart.');
  }
};
