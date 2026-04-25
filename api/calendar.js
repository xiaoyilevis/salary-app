// Vercel API Route: /api/calendar
// 從 Google Calendar 抓取 ICS 並解析回傳課程資料

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
  const h=+(s[9]||0)*10+(+s[10]||0);
  const mi=+(s[11]||0)*10+(+s[12]||0);
  const dt = new Date(y, mo, d, h, mi);
  if (s.endsWith('Z')) {
    // UTC+8
    return new Date(Date.UTC(y, mo, d, h+8, mi));
  }
  return dt;
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
    const hc = HEADCOUNT_MAP[name] || (rawName.match(/(\d+)\s*人/)||[])[1] || 0;
    const safeUid = uid.replace(/[^a-zA-Z0-9_]/g,'_').slice(0,36);

    const makeEvent = (dt) => ({
      id: `${calId}_${safeUid}_${dt.getFullYear()}${dt.getMonth()+1}${dt.getDate()}`,
      calId,
      date: `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`,
      time: `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`,
      duration: dur,
      studentName: name,
      headcount: +hc,
    });

    if (rrule && rrule.includes('FREQ=WEEKLY')) {
      const untilM = rrule.match(/UNTIL=(\d{8}(?:T\d{6}Z?)?)/);
      const countM = rrule.match(/COUNT=(\d+)/);
      const bydayM = rrule.match(/BYDAY=([A-Z,]+)/);
      const days   = bydayM ? bydayM[1].split(',').map(d=>DOW_MAP[d]).filter(d=>d!==undefined) : [sd.getDay()];
      const endDt  = untilM ? new Date(Math.min(parseDT(untilM[1]).getTime(), END_2027.getTime())) : END_2027;
      const maxCnt = countM ? +countM[1] : 500;

      // 從包含 sd 的那週週一開始
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
  res.setHeader('Cache-Control', 's-maxage=300'); // 快取 5 分鐘

  const CAL1_URL = process.env.CALENDAR_ICS_1;
  const CAL2_URL = process.env.CALENDAR_ICS_2;

  if (!CAL1_URL || !CAL2_URL) {
    return res.status(500).json({ error: '未設定 CALENDAR_ICS_1 / CALENDAR_ICS_2 環境變數' });
  }

  try {
    const [r1, r2] = await Promise.all([
      fetch(CAL1_URL).then(r => r.text()),
      fetch(CAL2_URL).then(r => r.text()),
    ]);

    const cal1 = parseICS(r1, 'cal1');
    const cal2 = parseICS(r2, 'cal2');
    const all  = [...cal1, ...cal2];

    // 去重
    const seen = new Set();
    const deduped = all.filter(e => {
      const k = `${e.date}|${e.time}|${e.studentName}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // 只回傳 2024 年之後
    const recent = deduped.filter(e => e.date >= '2024-01-01');

    res.status(200).json({ events: recent, updated: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
