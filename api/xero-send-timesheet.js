/* POST /api/xero-send-timesheet
   Body: { companyId, pin, timesheets: [{ employeeId, employeeCode, startDate, endDate,
           ordinaryHours, overtimeHours, overtimeSundayHours, publicHolidayHours }] }
   (each *Hours is 14 numbers, Monday → Sunday). Creates them in Xero
   Payroll as DRAFT timesheets, which the farmer then checks in Xero.
   Replies 401 wrong code, 409 Xero not connected, 422 Xero refused. */

const { PAYROLL_URL, checkPin, db, accessToken, xero } = require('./_xero');

// Which Xero earnings rate takes each line: the first whose name
// contains the words (lower case). Set up in Xero > Payroll settings.
const RATE_MATCHERS = {
  ordinaryHours: (n) => n.includes('ordinary'),
  overtimeHours: (n) => n.includes('overtime') && !n.includes('sunday'),
  overtimeSundayHours: (n) => n.includes('overtime') && n.includes('sunday'),
  publicHolidayHours: (n) => n.includes('public holiday'),
};

const UUID = /^[0-9a-f-]{36}$/i;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
  const { companyId, pin, timesheets } = req.body || {};
  if (!checkPin(pin)) return res.status(401).json({ error: 'Wrong manager code.' });
  if (!companyId || !Array.isArray(timesheets) || !timesheets.length) return res.status(400).json({ error: 'Nothing to send.' });

  try {
    const token = await accessToken(companyId);
    const [company] = await db(`companies?id=eq.${encodeURIComponent(companyId)}&select=xero_tenant_id`);
    if (!token || !company || !company.xero_tenant_id) return res.status(409).json({ error: 'Xero is not connected yet.' });
    const tenantId = company.xero_tenant_id;

    const [people, payItems] = await Promise.all([
      xero(token, tenantId, `${PAYROLL_URL}/Employees`),
      xero(token, tenantId, `${PAYROLL_URL}/PayItems`),
    ]);
    if (!people.ok || !payItems.ok) return res.status(422).json({ error: `Xero refused to list employees or pay items (${people.status}/${payItems.status}).` });

    const rates = payItems.data.PayItems.EarningsRates || [];
    const rateIds = {};
    for (const [line, matches] of Object.entries(RATE_MATCHERS)) {
      const rate = rates.find((r) => matches(r.Name.toLowerCase()));
      if (rate) rateIds[line] = rate.EarningsRateID;
    }

    // FarmSmart employee → Xero employee: the saved id, else the first
    // active Xero employee with the same first name (then saved).
    const ids = timesheets.map((t) => t.employeeId).filter((id) => UUID.test(id)).join(',');
    const ours = await db(`employees?id=in.(${ids})&select=id,preferred_name,xero_employee_id`);
    const active = (people.data.Employees || []).filter((e) => e.Status === 'ACTIVE');
    const missing = [];
    const toSend = [];
    for (const t of timesheets) {
      const employee = ours.find((e) => e.id === t.employeeId);
      if (!employee) continue;
      let xeroId = employee.xero_employee_id;
      if (!xeroId) {
        const match = active.find((e) => e.FirstName.trim().toLowerCase() === employee.preferred_name.trim().toLowerCase());
        if (!match) { missing.push(`${employee.preferred_name} is not an employee in Xero`); continue; }
        xeroId = match.EmployeeID;
        await db(`employees?id=eq.${employee.id}`, { method: 'PATCH', body: { xero_employee_id: xeroId } });
      }
      const lines = [];
      for (const line of Object.keys(RATE_MATCHERS)) {
        const units = t[line] || [];
        if (!units.some((h) => h > 0)) continue;
        if (!rateIds[line]) { missing.push(`no Xero earnings rate for ${line.replace('Hours', '')}`); continue; }
        lines.push({ EarningsRateID: rateIds[line], NumberOfUnits: units });
      }
      toSend.push({ EmployeeID: xeroId, StartDate: `${t.startDate}T00:00:00`, EndDate: `${t.endDate}T00:00:00`, Status: 'DRAFT', TimesheetLines: lines });
    }
    if (missing.length) return res.status(422).json({ error: [...new Set(missing)].join('; ') });

    const sent = await xero(token, tenantId, `${PAYROLL_URL}/Timesheets`, { method: 'POST', body: toSend });
    if (!sent.ok) {
      const messages = JSON.stringify(sent.data || '').match(/"Message":"[^"]+"/g) || [];
      return res.status(422).json({ error: messages.map((m) => m.slice(11, -1)).join('; ') || `Xero error ${sent.status}` });
    }
    res.status(200).json({ sent: toSend.length });
  } catch (err) {
    console.error('[xero-send-timesheet]', err);
    res.status(500).json({ error: 'Server error while talking to Xero.' });
  }
};
