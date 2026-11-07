/* POST /api/crossing-light
   Body: { on: true | false }
   Queues the command in the Notecard's crossing_light.qi Notefile on
   Notehub; the Cygnet picks it up within seconds and switches the light.
   Secrets come from Vercel environment variables, never from the repo:
   NOTEHUB_TOKEN (personal access token), NOTEHUB_PRODUCT_UID, NOTECARD_DEVICE_UID.
   Replies 400 bad body, 500 not configured, 502 Notehub refused. */

const NOTEHUB_API = 'https://api.notefile.net/v1';
const COMMAND_FILE = 'crossing_light.qi';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
  const { on } = req.body || {};
  if (typeof on !== 'boolean') return res.status(400).json({ error: '"on" must be true or false.' });

  const token = (process.env.NOTEHUB_TOKEN || '').trim();
  const product = (process.env.NOTEHUB_PRODUCT_UID || '').trim();
  const device = (process.env.NOTECARD_DEVICE_UID || '').trim();
  if (!token || !product || !device) return res.status(500).json({ error: 'Crossing light is not configured on the server.' });

  const url = `${NOTEHUB_API}/projects/${product}/devices/${device}/notes/${COMMAND_FILE}`;
  try {
    const hub = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: { on } }),
    });
    // Notehub's error text never contains the token, so it is safe to show.
    if (!hub.ok) return res.status(502).json({ error: `Notehub refused the command (${hub.status}): ${await hub.text()}` });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(502).json({ error: 'Could not reach Notehub.' });
  }
};
