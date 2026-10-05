/* GET /api/xero-connect?company=<id>&pin=<manager code>
   Sends the farmer to Xero to allow FarmSmart to write draft timesheets.
   Xero then comes back to /api/xero-callback. */

const crypto = require('crypto');
const { SCOPES, REDIRECT_URI, checkPin } = require('./_xero');

module.exports = (req, res) => {
  const { company, pin } = req.query;
  if (!checkPin(pin)) return res.status(401).send('Wrong manager code.');
  if (!company) return res.status(400).send('Missing company.');

  // `state` comes back from Xero unchanged; the cookie proves it was us.
  const state = `${company}.${crypto.randomBytes(16).toString('hex')}`;
  res.setHeader('Set-Cookie', `xero_state=${state}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  const url = new URL('https://login.xero.com/identity/connect/authorize');
  url.search = new URLSearchParams({
    response_type: 'code', client_id: process.env.XERO_CLIENT_ID, redirect_uri: REDIRECT_URI, scope: SCOPES, state,
  });
  res.redirect(302, url.toString());
};
