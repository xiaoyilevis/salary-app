// Vercel API Route: /api/calendar
const NAME_MERGE = {
  "王彥喆 家教":"王彥喆","彥喆":"王彥喆",
  "君綺家教":"君綺","王君綺":"君綺","君綺 家教":"君綺",
  "晟允家教":"彭晟允","澎晟允家教":"彭晟允",
  "藝芹家教":"藝芹","洪藝芹":"藝芹",
  "林高 高二數A":"林高高二數A",
};
const HEADCOUNT_MAP = {
  "林高高一一小時":22,"林高高二數A":18,"林高高二數B":17,
  "林高明倫分班":4,"長庚高一":4,"長庚高一先修":4,
  "長庚高二數A":12,"長庚高二":8,"崇林國二團班":12,
  "崇林國一團班":10,"文華班小四團班":10,"文華班小六":8,
  "文華班小五":7,"文華班小四":8,"文華班小三團班":8,
  "文華班 國三":10,"文華班 國二":8,
};
const DOW_MAP = { MO:0,TU:1,WE:2,TH:3,FR:4,SA:5,SU:6 };

function parseDT(s) {
  if (!s) return null;
  const y=+s.slice(0,4), mo=+s.slice(4,6)-1, d=+s.slice(6,8);
  const h=+(s.slice(9,11)||0);
  const mi=+(s.slice(11,13)||0);
  if (s.endsWith('Z')) {
    return new Date(Date.UTC(y, mo, d, h+8, mi));
  }
  return new Date(y, mo, d, h, mi);
}

function parseICS(text, calId) {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const blocks = unfolded.split('BEGIN:VEVENT');
  blocks.shift();
  const events = [];
  const END_2027 = new Date(2027, 0, 1);

  for (const block of blocks) {
    const get = (key) => {
      const m = block.match(new RegExp(`^${key}(?:;[^:\\r\\n]+)?:(.+)$`, 'm'));
      return m ? m[1].trim() : '';
    };
    const uid     = get('UID') || `${calId}_${events.length}`;
    const rawName = get('SUMMARY').replace(/\\,/g,',').replace(/\\n/g,' ').trim();
    const dtstart = get('DTSTART');
    const dtend   = get('DTEND');
    const rrule   = get('RRULE');
    if (!dtstart || /^\d{8}$/.test(dtstart)) continue;
    const sd = parseDT(dtstart);
    const ed = dtend ? parseDT(dtend) : null;
    if (!sd) continue;
    const dur = ed ? Math.max(0.5, Math.round((ed-sd)/1800000)*0.5) : 1;
    const name = NAME_MERGE[rawName] || rawName;
    const hc = HEADCOUNT_MAP[name] || +(rawName.match(/(\d+)\s*人/)||[0,0])[1] || 0;
    const safeUid = uid.replace(/[^a-zA-Z0-9_]/g,'_').slice(0,36);

    const makeEvent = (dt) => ({
      id: `${calId}_${safeUid}_${dt.getFullYear()}${dt.getMonth()+1}${dt.getDate()}`,
      calId,
      date: `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`,
      time: `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`,
      duration: dur,
      studentName: name,
      headcount: hc,
    });

    if (rrule && rrule.includes('FREQ=WEEKLY')) {
      const untilM = rrule.match(/UNTIL=(\d{8}(?:T\d{6}Z?)?)/);
      const countM = rrule.match(/COUNT=(\d+)/);
      const bydayM = rrule.match(/BYDAY=([A-Z,]+)/);
      const days   = bydayM ? bydayM[1].split(',').map(d=>DOW_MAP[d]).filter(d=>d!==undefined) : [sd.getDay()];
      const endDt  = untilM ? new Date(Math.min(parseDT(untilM[1]).getTime(), END_2027.getTime())) : END_2027;
      const maxCnt = countM ? +countM[1] : 500;
      const weekStart = new Date(sd);
      weekStart.setDate(sd.getDate() - ((sd.getDay()+6)%7));
      let cnt = 0;
      let cur = new Date(weekStart);
      while (cur <= endDt && cnt < maxCnt) {
        for (const dow of days.sort()) {
          const dt = new Date(cur);
          dt.setDate(cur.getDate() + (dow - ((cur.getDay()+6)%7) + 7) % 7);
          dt.setHours(sd.getHours(), sd.getMinutes(), 0);
          if (dt >= sd && dt <= endDt && cnt < maxCnt) {
            events.push(makeEvent(dt));
            cnt++;
          }
        }
        cur.setDate(cur.getDate() + 7);
      }
    } else {
      events.push(makeEvent(sd));
    }
  }
  return events;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');

  const debug = req.query?.debug === '1';
  const CAL1_URL = process.env.CALENDAR_ICS_1;
  const CAL2_URL = process.env.CALENDAR_ICS_2;

  const diag = { cal1:{}, cal2:{} };

  if (!CAL1_URL || !CAL2_URL) {
    return res.status(500).json({ error: '未設定 CALENDAR_ICS_1 / CALENDAR_ICS_2', cal1Set:!!CAL1_URL, cal2Set:!!CAL2_URL });
  }

  async function fetchOne(url, calId, slot) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SalaryApp/1.0)' } });
      diag[slot].status = r.status;
      diag[slot].ok = r.ok;
      diag[slot].url_prefix = url.slice(0, 60);
      if (!r.ok) {
        diag[slot].error = `HTTP ${r.status}`;
        return [];
      }
      const text = await r.text();
      diag[slot].text_length = text.length;
      diag[slot].is_ics = text.startsWith('BEGIN:VCALENDAR');
      if (!text.startsWith('BEGIN:VCALENDAR')) {
        diag[slot].error = 'Not ICS format';
        diag[slot].text_preview = text.slice(0, 200);
        return [];
      }
      const events = parseICS(text, calId);
      diag[slot].events_count = events.length;
      diag[slot].events_2024plus = events.filter(e => e.date >= '2024-01-01').length;
      return events;
    } catch (err) {
      diag[slot].error = err.message;
      return [];
    }
  }

  try {
    const [cal1, cal2] = await Promise.all([
      fetchOne(CAL1_URL, 'cal1', 'cal1'),
      fetchOne(CAL2_URL, 'cal2', 'cal2'),
    ]);

    const all = [...cal1, ...cal2];
    const seen = new Set();
    const deduped = all.filter(e => {
      const k = `${e.date}|${e.time}|${e.studentName}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const recent = deduped.filter(e => e.date >= '2024-01-01');

    if (debug) {
      return res.status(200).json({ diag, total: recent.length });
    }
    res.status(200).json({ events: recent, updated: new Date().toISOString(), diag });
  } catch (err) {
    res.status(500).json({ error: err.message, diag });
  }
}
