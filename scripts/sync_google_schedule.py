import os
import sys
import re
import json
import zipfile
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

SHEET_URL = 'https://docs.google.com/spreadsheets/d/12Xb8SVyjXOzchhyzLWP07UCdh3JDfEsOEqfeC9t2Z30/export?format=xlsx'
LOCAL_XLSX = 'scratch/user_installation_schedule.xlsx'
# .railwayignore leaves scratch/ out of deploys, so create it on demand
os.makedirs('scratch', exist_ok=True)

def load_env():
    # Process env first (Railway sets the PG_* variables there and does not
    # ship .env.local); a local .env.local then takes precedence
    env_vars = dict(os.environ)
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    candidates = ['.env.local', os.path.join(base_dir, '.env.local')]
    for path in candidates:
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8-sig') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        k, v = line.split('=', 1)
                        k = k.strip()
                        v = v.strip()
                        if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                            v = v[1:-1]
                        env_vars[k] = v
            break
    return env_vars

ENV = load_env()
PG_OPS_URL = ENV.get('PG_PROXY_URL')
PG_OPS_DB = ENV.get('PG_PROXY_DATABASE')
PG_OPS_TOKEN = ENV.get('PG_PROXY_TOKEN')

PG_SRC_URL = ENV.get('PG_SOURCE_PROXY_URL') or PG_OPS_URL
PG_SRC_DB = ENV.get('PG_SOURCE_PROXY_DATABASE') or PG_OPS_DB
PG_SRC_TOKEN = ENV.get('PG_SOURCE_PROXY_TOKEN') or PG_OPS_TOKEN

def query_db(url, db, token, sql, params=None, max_retries=3):
    import time
    if params is None:
        params = []
    payload = json.dumps({
        'db_name': db,
        'sql': sql,
        'params': params
    }).encode('utf-8')
    req = urllib.request.Request(url, data=payload, headers={
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    })
    last_err = None
    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                return data.get('rows', [])
        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8')
            last_err = err_body
            print(f"DB Query HTTP Error ({e.code}, attempt {attempt + 1}/{max_retries}): {err_body}")
            if e.code in (502, 503, 504) and attempt < max_retries - 1:
                time.sleep(2 * (attempt + 1))
                continue
            raise RuntimeError(f"Database query failed: {err_body}")
        except Exception as e:
            last_err = str(e)
            print(f"DB Query Exception (attempt {attempt + 1}/{max_retries}): {e}")
            if attempt < max_retries - 1:
                time.sleep(2 * (attempt + 1))
                continue
            raise
    raise RuntimeError(f"Database query failed after {max_retries} attempts: {last_err}")

def download_sheet():
    print(f"1. Downloading live Google Sheet from {SHEET_URL}...")
    try:
        req = urllib.request.Request(SHEET_URL, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=60) as resp:
            content = resp.read()
            with open(LOCAL_XLSX, 'wb') as f:
                f.write(content)
        print(f"Downloaded {len(content)} bytes to {LOCAL_XLSX}")
        return True
    except Exception as e:
        print(f"Download notice: {e}. Using local cached file if available.")
        return os.path.exists(LOCAL_XLSX)

MONTH_MAP = {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
    'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
}

def extract_time_and_slot(s, iso_date):
    time_str = '09:00'
    slot = 'am'
    has_explicit_time = True
    slot_lower = s.lower().replace(' ', '')
    
    if '230pm' in slot_lower or '2.30pm' in slot_lower or '2:30pm' in slot_lower or '@230' in slot_lower or '@2.30' in slot_lower or '@2:30' in slot_lower:
        time_str = '14:30'
        slot = 'pm'
    elif '330pm' in slot_lower or '3.30pm' in slot_lower or '3:30pm' in slot_lower or '@330' in slot_lower or '@3.30' in slot_lower:
        time_str = '15:30'
        slot = 'pm'
    elif '930am' in slot_lower or '9.30am' in slot_lower or '9:30am' in slot_lower or '@930' in slot_lower or '@9.30' in slot_lower:
        time_str = '09:30'
        slot = 'am'
    elif '130pm' in slot_lower or '1.30pm' in slot_lower or '1:30pm' in slot_lower or '@130' in slot_lower or '@1.30' in slot_lower:
        time_str = '13:30'
        slot = 'pm'
    elif '12pm' in slot_lower or '12:00pm' in slot_lower or '@12' in slot_lower:
        time_str = '12:00'
        slot = 'pm'
    elif '1pm' in slot_lower or '1:00pm' in slot_lower or '@1pm' in slot_lower:
        time_str = '13:00'
        slot = 'pm'
    elif '2pm' in slot_lower or '2:00pm' in slot_lower or '@2pm' in slot_lower or '@2' in slot_lower:
        time_str = '14:00'
        slot = 'pm'
    elif '3pm' in slot_lower or '3:00pm' in slot_lower or '@3pm' in slot_lower or '@3' in slot_lower:
        time_str = '15:00'
        slot = 'pm'
    elif '4pm' in slot_lower or '4:00pm' in slot_lower or '@4pm' in slot_lower or '@4' in slot_lower:
        time_str = '16:00'
        slot = 'pm'
    elif '10am' in slot_lower or '@10' in slot_lower:
        time_str = '10:00'
        slot = 'am'
    elif '11am' in slot_lower or '@11' in slot_lower:
        time_str = '11:00'
        slot = 'am'
    elif '9am' in slot_lower or '@9' in slot_lower:
        time_str = '09:00'
        slot = 'am'
    elif 'full day' in slot_lower or '3 days' in slot_lower or '2 days' in slot_lower:
        time_str = '09:00'
        slot = 'full'
    elif 'pm' in slot_lower:
        time_str = '14:00'
        slot = 'pm'
    elif 'am' in slot_lower:
        time_str = '09:00'
        slot = 'am'
    else:
        has_explicit_time = False

    return {'isoDate': iso_date, 'timeStr': time_str, 'slot': slot, 'rawSlot': s, 'hasExplicitTime': has_explicit_time}

def parse_slot_date(slot_text, default_year='2026', current_week=''):
    if not slot_text:
        return None
    s = slot_text.strip()
    
    # 1. Try D/M/YYYY or D/M/YY or D-M-YYYY or D-M-YY
    m_slash = re.search(r'\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b', s)
    if m_slash:
        d = m_slash.group(1).zfill(2)
        m = m_slash.group(2).zfill(2)
        y = m_slash.group(3)
        if y:
            if len(y) == 2:
                y = f"20{y}"
        else:
            y = default_year
        if 1 <= int(d) <= 31 and 1 <= int(m) <= 12:
            iso_date = f"{y}-{m}-{d}"
            return extract_time_and_slot(s, iso_date)

    # 2. Try "D Month YYYY" or "D Month"
    m_named = re.search(r'\b(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(\d{4}))?\b', s)
    if m_named:
        d = m_named.group(1).zfill(2)
        month_word = m_named.group(2).lower()[:3]
        if month_word in MONTH_MAP:
            m = MONTH_MAP[month_word]
            y = m_named.group(3) or default_year
            iso_date = f"{y}-{m}-{d}"
            return extract_time_and_slot(s, iso_date)

    # 3. Try "Month D, YYYY" or "Month D"
    m_month_first = re.search(r'\b([A-Za-z]{3,9})\s+(\d{1,2})(?:[,\s]+(\d{4}))?\b', s)
    if m_month_first:
        month_word = m_month_first.group(1).lower()[:3]
        if month_word in MONTH_MAP:
            d = m_month_first.group(2).zfill(2)
            m = MONTH_MAP[month_word]
            y = m_month_first.group(3) or default_year
            iso_date = f"{y}-{m}-{d}"
            return extract_time_and_slot(s, iso_date)

    # 4. Try "Mon 16", "Tue 17", "Wed 18", "Thu 19", "Fri 20", etc. resolved against current_week
    if current_week:
        wm = re.search(r'(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*[~\-]\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})', current_week)
        if wm:
            d1, m1, y1, d2, m2, y2 = wm.groups()
            y2_full = int(f"20{y2}" if len(y2) == 2 else y2)
            m2_int = int(m2)
            m1_int = int(m1)
            if y1:
                y1_full = int(f"20{y1}" if len(y1) == 2 else y1)
            else:
                y1_full = y2_full - 1 if m1_int > m2_int else y2_full

            m_weekday_day = re.search(r'\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?\s+(\d{1,2})\b', s, re.I)
            if m_weekday_day:
                target_day = int(m_weekday_day.group(1))
                if 1 <= target_day <= 31:
                    try:
                        from datetime import date, timedelta
                        start_dt = date(y1_full, m1_int, int(d1))
                        for offset in range(-1, 8):
                            cand_dt = start_dt + timedelta(days=offset)
                            if cand_dt.day == target_day:
                                iso_date = cand_dt.strftime('%Y-%m-%d')
                                return extract_time_and_slot(s, iso_date)
                    except ValueError:
                        pass
                    iso_date = f"{y2_full:04d}-{m2_int:02d}-{target_day:02d}"
                    return extract_time_and_slot(s, iso_date)

            # 5. Try "Thu 9am", "Thu 2pm" (weekday + explicit time within current_week)
            m_weekday_only = re.match(r'^\s*(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?\s+(?:@\s*)?\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)\b', s, re.I)
            if m_weekday_only:
                wd_map = {'mon': 0, 'tue': 1, 'tues': 1, 'wed': 2, 'thu': 3, 'thur': 3, 'thurs': 3, 'fri': 4, 'sat': 5, 'sun': 6}
                wd_key = m_weekday_only.group(1).lower()
                if wd_key in wd_map:
                    try:
                        from datetime import date, timedelta
                        start_dt = date(y1_full, m1_int, int(d1))
                        monday_dt = start_dt - timedelta(days=start_dt.weekday())
                        cand_dt = monday_dt + timedelta(days=wd_map[wd_key])
                        iso_date = cand_dt.strftime('%Y-%m-%d')
                        return extract_time_and_slot(s, iso_date)
                    except ValueError:
                        pass

    return None

def parse_crew_subheader(a_text, section_all_members, section_all_cars):
    if not a_text:
        return None
    s = a_text.strip()
    if not s:
        return None

    # 1. "All" means combine all members and cars seen in this team section
    if s.lower() == 'all':
        return {
            'isAll': True,
            'members': list(section_all_members),
            'cars': list(section_all_cars),
            'supervisor': None,
        }

    def clean_member(name):
        w = name.strip()
        if not w:
            return ''
        if w.islower():
            return w.title()
        return w

    # 2. "<Car> (<Members>)" e.g. "Van JXW783 (Jamar, Faiz, shahir)" or "Myvi (Hakimin, Amien, Imam)"
    m_car_mem = re.match(r'^((?:Van|Myvi|Avanza|Hilux|Alza|Lorry)\b[^(]*)\(([^)]+)\)\s*$', s, re.I)
    if m_car_mem:
        car = m_car_mem.group(1).strip()
        members = [clean_member(x) for x in m_car_mem.group(2).split(',') if clean_member(x)]
        for mem in members:
            if mem not in section_all_members:
                section_all_members.append(mem)
        if car and car not in section_all_cars:
            section_all_cars.append(car)
        return {
            'isAll': False,
            'members': members,
            'cars': [car] if car else [],
            'supervisor': None,
        }

    # 3. Labeled or multi-line subheaders (Site supervisor: ..., Team/Technician: ..., Car: ...)
    lines = [l.strip() for l in s.split('\n') if l.strip()]
    sup = None
    members = []
    cars = []
    matched_any = False

    for line in lines:
        m_sup = re.match(r'^site\s*supervisor\s*:\s*(.+)$', line, re.I)
        if m_sup:
            sup = m_sup.group(1).strip()
            matched_any = True
            continue
        m_team = re.match(r'^(?:team|technician)\s*:\s*(.+)$', line, re.I)
        if m_team:
            members.extend([clean_member(x) for x in m_team.group(1).split(',') if clean_member(x)])
            matched_any = True
            continue
        m_car = re.match(r'^car\s*:\s*(.+)$', line, re.I)
        if m_car:
            cars.extend([x.strip() for x in m_car.group(1).split(',') if x.strip()])
            matched_any = True
            continue
        if re.match(r'^(?:Van|Myvi|Avanza|Hilux|Alza|Lorry)\b', line, re.I) and not re.search(r'\b(mon|tue|wed|thu|fri|sat|sun)\b', line, re.I):
            cars.extend([x.strip() for x in line.split(',') if x.strip()])
            matched_any = True
            continue
        if ',' in line and not re.search(r'\d', line) and not re.search(r'\b(mon|tue|wed|thu|fri|sat|sun|note|holiday|available|waiting)\b', line, re.I):
            members.extend([clean_member(x) for x in line.split(',') if clean_member(x)])
            matched_any = True

    if matched_any:
        for mem in members:
            if mem not in section_all_members:
                section_all_members.append(mem)
        for car in cars:
            if car not in section_all_cars:
                section_all_cars.append(car)
        return {
            'isAll': False,
            'members': members,
            'cars': cars,
            'supervisor': sup,
        }

    return None

def parse_customer_cell(cell_text):
    if not cell_text:
        return None
    s = cell_text.strip()
    if re.match(r'^public\s+holiday', s, re.I):
        return {'isPublicHoliday': True, 'raw': s}

    has_green_tick = bool(re.search(r'[\u2705\u2714\u2713\u2611]|✅|✓|✔|☑', s))

    cleaned = re.sub(r'[\u2705\u2714\u2713\u2611]|✅|✓|✔|☑', '', s).strip()
    lines = [l.strip() for l in cleaned.split('\n') if l.strip()]

    name_line = ''
    remarks = []

    for l in lines:
        if l.startswith('-') or l.startswith('•') or l.startswith('*') or l.startswith('➡️') or l.startswith('▶️'):
            remarks.append(l)
        elif re.match(r'^(pre\s*book|request|to schedule|material|wiring on|site supervisor|pending install batt)', l, re.I):
            remarks.append(l)
        elif re.match(r'^\[.*\]$', l):
            remarks.append(l)
        elif not name_line:
            name_line = l
        else:
            remarks.append(l)

    if not name_line and lines:
        name_line = lines[0]

    clean_name = name_line
    if '**' in clean_name:
        parts = clean_name.split('**', 1)
        clean_name = parts[0].strip()
        if parts[1].strip():
            remarks.append('** ' + parts[1].strip())
    if ' - ' in clean_name:
        parts = clean_name.split(' - ', 1)
        if re.search(r'(add on|change|no need|pending|proceed|phase|panel|inverter|batt|tnb|selco|hold)', parts[1], re.I):
            clean_name = parts[0].strip()
            remarks.insert(0, '- ' + parts[1].strip())

    clean_name = re.sub(r'\(ATAP\)', '', clean_name, flags=re.I)
    clean_name = re.sub(r'\(SELCO\)', '', clean_name, flags=re.I)
    clean_name = re.sub(r'\(FACTORY\)', '', clean_name, flags=re.I)
    clean_name = re.sub(r'\[O&M\]', '', clean_name, flags=re.I)
    clean_name = re.sub(r'\(COMMERCIAL\)', '', clean_name, flags=re.I)
    clean_name = re.sub(r'\(ADD ON PANEL[^\)]*\)', '', clean_name, flags=re.I)
    clean_name = re.sub(r'\(TOP UP CASE\)', '', clean_name, flags=re.I)
    clean_name = re.sub(r'^pre\s*book\s*\d*[\/\d]*', '', clean_name, flags=re.I)
    clean_name = re.sub(r'\[.*?\]', '', clean_name).strip()

    return {
        'raw': s,
        'rawCustomer': name_line,
        'cleanName': clean_name,
        'hasGreenTick': has_green_tick,
        'remarks': '\n'.join(remarks),
        'isAtap': bool(re.search(r'\(ATAP\)', s, re.I)),
    }

def sheet_availability_status(item, today):
    # The sheet's green tick is mirrored as the green tick on the job's row in
    # Arranged Installation, which the app stores as Complete. Never Propose:
    # that would move the job out of Arranged Installation into Propose to
    # Install. Without a tick, a job the office already ticked in the app stays
    # Complete unless its date is still ahead of us.
    if item['customer']['hasGreenTick']:
        return 'complete'
    current = (item.get('matchedOps') or {}).get('customer_availability_status')
    if current == 'complete' and item['slot']['isoDate'] <= today:
        return 'complete'
    remarks = item['customer']['remarks'].lower()
    if 'pending' in remarks or 'reschedule' in remarks:
        return 'pending_complete'
    return 'ready_to_schedule'

def normalize(str_val):
    if not str_val:
        return ''
    return re.sub(r'[^a-z0-9]', '', str_val.lower())

def extract_panel_line(text):
    if not text:
        return ''
    lines = [l.strip() for l in text.split('\n') if l.strip()]
    if not lines:
        return ''
    for line in lines:
        is_solar = bool(re.search(r'\b(panel|panels|jinko|jinkosolar|astronergy|longi|trina|ja\s*solar|canadian\s*solar|risen|topcon|bi-?facial|tiger\s*neo)\b', line, re.I))
        is_not_comp = not bool(re.search(r'\b(inverter|battery|seda|tnb|smart\s*meter|skylift|mounting|cable|works|design|surveying|application)\b', line, re.I))
        if is_solar and is_not_comp:
            return line
    for line in lines:
        is_qty = bool(re.match(r'^\(?\d+(?:\+\d+)?\)?\s*(?:[xX×]|pcs|panels?\b)', line, re.I))
        is_not_comp = not bool(re.search(r'\b(inverter|battery|seda|tnb|smart\s*meter|skylift|mounting|cable|works|design|surveying|application)\b', line, re.I))
        if is_qty and is_not_comp:
            return line
    return lines[0]

def parse_delivery_departure(s):
    if not s:
        return None, None
    s = str(s).strip()
    d_str = None
    # 1. Try named month: e.g. "1 Nov 2026" or "1 Nov"
    m_named = re.search(r'\b(\d{1,2})\s+([A-Za-z]{3,9})(?:\s+(\d{2,4}))?\b', s)
    if m_named:
        d = int(m_named.group(1))
        mw = m_named.group(2).lower()[:3]
        if mw in MONTH_MAP and 1 <= d <= 31:
            m = int(MONTH_MAP[mw])
            y = int(m_named.group(3)) if m_named.group(3) else 2026
            if y < 100:
                y += 2000
            d_str = f"{y:04d}-{m:02d}-{d:02d}"

    # 2. Try slash/dash date: e.g. "1/11/2026" or "1/11" or "01-11-2026"
    if not d_str:
        m_slash = re.search(r'\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b', s)
        if m_slash:
            d = int(m_slash.group(1))
            m = int(m_slash.group(2))
            if 1 <= d <= 31 and 1 <= m <= 12:
                y = int(m_slash.group(3)) if m_slash.group(3) else 2026
                if y < 100:
                    y += 2000
                d_str = f"{y:04d}-{m:02d}-{d:02d}"

    t_str = '09:00'
    m_time = re.search(r'@\s*(\d{1,2})(?::(\d{2})|\.(\d{2}))?\s*(am|pm)?', s, re.I)
    if not m_time:
        m_time = re.search(r'\b(\d{1,2})(?::(\d{2})|\.(\d{2}))\s*(am|pm)\b', s, re.I)
    if m_time:
        hr = int(m_time.group(1))
        mn = int(m_time.group(2) or m_time.group(3) or 0)
        ampm = (m_time.group(4) or '').lower()
        if ampm == 'pm' and hr < 12:
            hr += 12
        elif ampm == 'am' and hr == 12:
            hr = 0
        if 0 <= hr <= 23 and 0 <= mn <= 59:
            t_str = f'{hr:02d}:{mn:02d}'

    return d_str, t_str

def parse_delivery_customer_cell(cell_b):
    if not cell_b:
        return '', ''
    lines = [l.strip() for l in str(cell_b).split('\n') if l.strip()]
    if not lines:
        return '', ''

    name_idx = 0
    if (re.match(r'^\[.*\]$', lines[0]) or re.match(r'^pre[- ]?book.*', lines[0], re.I)) and len(lines) > 1:
        name_idx = 1

    raw_name = lines[name_idx]
    clean_name = re.sub(r'[\u2705\u274c\u25b6\ufe0f*【】]', '', raw_name)
    clean_name = re.sub(r'\((?:ATAP|SELCO|NEM|FACTORY|TOP UP|ADD ON).*?\)', '', clean_name, flags=re.I)
    clean_name = re.sub(r'\s+', ' ', clean_name).strip()

    remark_lines = []
    if name_idx > 0:
        remark_lines.append(lines[0])
    remark_lines.extend(lines[name_idx + 1:])

    cleaned_remarks = []
    for r in remark_lines:
        r_clean = r.lstrip('-* ').strip()
        if r_clean:
            cleaned_remarks.append(r_clean)

    return clean_name, '\n'.join(cleaned_remarks)

def extract_all_sheet_rows():
    if not os.path.exists(LOCAL_XLSX):
        raise FileNotFoundError(f"Missing {LOCAL_XLSX}")

    with zipfile.ZipFile(LOCAL_XLSX, 'r') as z:
        inst_target = None
        del_target = None
        with z.open('xl/workbook.xml') as f:
            tree = ET.parse(f)
            root = tree.getroot()
            sheets = root.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheets')
            inst_rid = None
            del_rid = None
            for s in sheets:
                name = s.attrib.get('name', '')
                if '2026' in name and 'INSTALLATION' in name.upper() and 'SCHEDULE' in name.upper():
                    inst_rid = s.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
                elif '2026' in name and 'DELIVERY' in name.upper() and 'SCHEDULE' in name.upper():
                    del_rid = s.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')

            with z.open('xl/_rels/workbook.xml.rels') as rf:
                rtree = ET.parse(rf)
                rroot = rtree.getroot()
                for rel in rroot:
                    rid = rel.attrib.get('Id')
                    if rid == inst_rid:
                        inst_target = 'xl/' + rel.attrib.get('Target').lstrip('/')
                    elif rid == del_rid:
                        del_target = 'xl/' + rel.attrib.get('Target').lstrip('/')

        if not inst_target:
            inst_target = 'xl/worksheets/sheet4.xml'
        if not del_target:
            del_target = 'xl/worksheets/sheet5.xml'
        print(f"Targeting worksheets: Installation={inst_target}, Delivery={del_target}")

        shared_strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            with z.open('xl/sharedStrings.xml') as f:
                for event, elem in ET.iterparse(f):
                    if elem.tag.endswith('}si'):
                        text = ''.join([t.text or '' for t in elem.iter() if t.tag.endswith('}t')])
                        shared_strings.append(text)
                        elem.clear()

        def parse_worksheet(target_path):
            rows = []
            with z.open(target_path) as f:
                for event, elem in ET.iterparse(f):
                    if elem.tag.endswith('}row'):
                        row_num = int(elem.attrib.get('r'))
                        cells = {}
                        for c in elem.iter():
                            if c.tag.endswith('}c'):
                                cell_ref = c.attrib.get('r')
                                cell_type = c.attrib.get('t')
                                v_elem = c.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v')
                                val = v_elem.text if v_elem is not None else None
                                if val is not None:
                                    if cell_type == 's':
                                        idx = int(val)
                                        val = shared_strings[idx] if idx < len(shared_strings) else val
                                    cells[cell_ref] = val
                        if cells:
                            rows.append({'row': row_num, 'cells': cells})
                        elem.clear()
            return rows

        inst_rows = parse_worksheet(inst_target)
        del_rows = parse_worksheet(del_target)
        return inst_rows, del_rows

def sync_schedule():
    print("=== Starting Google Sheet Schedule Synchronization ===")
    
    # 1. Download sheet
    download_sheet()

    # 2. Extract rows
    print("2. Extracting rows from worksheets...")
    sheet_rows, delivery_sheet_rows = extract_all_sheet_rows()
    print(f"Extracted {len(sheet_rows)} installation rows and {len(delivery_sheet_rows)} delivery rows.")

    # 3. Query source database (prod_main)
    print("3. Querying source records from prod_main...")
    source_rows = query_db(PG_SRC_URL, PG_SRC_DB, PG_SRC_TOKEN, """
        SELECT 
          i.bubble_id,
          i.invoice_number,
          c.name as customer_name,
          c.phone as customer_phone,
          coalesce(s.email, c.email) as customer_email,
          coalesce(s.installation_address, c.address) as address,
          a.name as agent_name,
          s.phase_type as phase,
          i.panel_qty,
          i.panel_rating,
          p_item.description as package_item_description,
          coalesce(inv_prod.name, p.package_name) as inverter_name
        FROM invoice i
        LEFT JOIN customer c ON c.customer_id = i.linked_customer
        LEFT JOIN agent a ON a.linked_user_login = i.linked_agent OR a.bubble_id = i.linked_agent
        LEFT JOIN package p ON p.bubble_id = i.linked_package
        LEFT JOIN product inv_prod ON inv_prod.bubble_id = p.inverter_1
        LEFT JOIN seda_registration s ON s.bubble_id = i.linked_seda_registration
        LEFT JOIN LATERAL (
          SELECT description FROM invoice_item 
          WHERE linked_invoice = i.bubble_id AND is_a_package = true 
          ORDER BY sort NULLS LAST, id LIMIT 1
        ) p_item ON true
        WHERE coalesce(c.name, '') <> ''
    """)
    print(f"Loaded {len(source_rows)} source customer records from prod_main.")
    source_by_id = {r['bubble_id']: r for r in source_rows if r.get('bubble_id')}

    # 4. Query ops database (NUrul_DB)
    print("4. Querying ops records from NUrul_DB...")
    ops_jobs = query_db(PG_OPS_URL, PG_OPS_DB, PG_OPS_TOKEN, """
        SELECT id, source_invoice_id, invoice_number, customer_name, delivery_contact_number, 
               customer_availability_status, installation_date, remarks, installation_remarks,
               power_output, inverter_battery, warehouse_location
        FROM public.installation_jobs
    """)
    print(f"Loaded {len(ops_jobs)} jobs from public.installation_jobs.")

    # Fetch ops state
    ops_rows = query_db(PG_OPS_URL, PG_OPS_DB, PG_OPS_TOKEN, "SELECT state FROM public.installation_ops_state WHERE id = $1 LIMIT 1", ['default'])
    ops_state = {}
    if ops_rows and ops_rows[0].get('state'):
        raw = ops_rows[0]['state']
        ops_state = json.loads(raw) if isinstance(raw, str) else raw

    # Backup ops state
    with open('scratch/ops_state_backup_before_sync.json', 'w', encoding='utf-8') as f:
        json.dump(ops_state, f, indent=2, ensure_ascii=False)

    # 5. Parse sheet rows into structured items
    print("5. Parsing sheet rows into scheduled items...")
    current_week = ''
    current_team = 'Team 1'
    current_install = ''
    current_wiring = ''
    current_supervisor = ''
    current_members = []
    current_cars = []
    section_all_members = []
    section_all_cars = []

    parsed_items = []
    seen_team_date_count = {}
    used_job_ids_by_team_date = {}

    for r in sheet_rows:
        row_text = ' '.join(str(v) for v in r['cells'].values())
        week_match = re.search(r'INSTALLATION\s*~\s*Week\s*:\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s*[~\-]\s*(\d{1,2}\/\d{1,2}\/\d{4})', row_text, re.I)
        if week_match:
            current_week = week_match.group(0)
            current_members = []
            current_cars = []
            section_all_members = []
            section_all_cars = []
            continue

        a = r['cells'].get(f"A{r['row']}", '')
        b = r['cells'].get(f"B{r['row']}", '')
        c = r['cells'].get(f"C{r['row']}", '')
        d = r['cells'].get(f"D{r['row']}", '')
        e_val = r['cells'].get(f"E{r['row']}", '')
        f_val = r['cells'].get(f"F{r['row']}", '')
        g = r['cells'].get(f"G{r['row']}", '')
        i_val = r['cells'].get(f"I{r['row']}", '')
        j = r['cells'].get(f"J{r['row']}", '')
        k = r['cells'].get(f"K{r['row']}", '')

        if re.search(r'^Team\s*\d+', (a or '').strip(), re.I):
            current_team = a.strip()
            current_install = re.sub(r'Install(?:\s*&\s*Wiring)?\s*:\s*', '', b or '', flags=re.I).strip()
            current_wiring = re.sub(r'Wiring\s*:\s*', '', c or '', flags=re.I).strip()
            sup_cand = (f_val or '').strip()
            if not sup_cand and e_val and not re.search(r'site\s*supervisor', e_val, re.I):
                sup_cand = e_val.strip()
            current_supervisor = re.sub(r'^site\s*supervisor\s*:\s*', '', sup_cand, flags=re.I).strip()
            current_members = []
            current_cars = []
            section_all_members = []
            section_all_cars = []
            continue

        if not current_week:
            continue

        m_yr = re.search(r'\/(\d{4})', current_week)
        default_yr = m_yr.group(1) if m_yr else '2026'

        slot_info = parse_slot_date(a, default_year=default_yr, current_week=current_week)
        if not slot_info and a and not b:
            sub_crew = parse_crew_subheader(a, section_all_members, section_all_cars)
            if sub_crew:
                current_members = list(sub_crew.get('members') or [])
                current_cars = list(sub_crew.get('cars') or [])
                if sub_crew.get('supervisor'):
                    current_supervisor = sub_crew['supervisor']
                continue
        if not slot_info or not b:
            continue

        cust_info = parse_customer_cell(b)
        if not cust_info or not cust_info.get('cleanName') or cust_info.get('isPublicHoliday'):
            continue

        # In two-row-per-day templates without explicit @9am / @2pm in Column A,
        # the second customer on the same (team, date) takes the afternoon slot (14:00 / pm)
        td_key = (current_team.strip().lower(), slot_info['isoDate'])
        prev_td_count = seen_team_date_count.get(td_key, 0)
        if not slot_info.get('hasExplicitTime') and prev_td_count >= 1:
            slot_info = {
                **slot_info,
                'timeStr': '14:00',
                'slot': 'pm',
            }
        seen_team_date_count[td_key] = prev_td_count + 1

        target_norm = normalize(cust_info['cleanName'])
        # Also prepare a base customer name without trailing house/invoice numbers for DB lookup
        base_cust_name = re.sub(r'\(\s*10\d{5}\s*\)', '', cust_info['cleanName']).strip()
        base_cust_name = re.sub(r'\s+(?:\-\s*)?\d+\s*$', '', base_cust_name).strip()
        base_norm = normalize(base_cust_name) or target_norm
        phone_digits = re.sub(r'[^0-9]', '', j or '')
        inv_match = re.search(r'\b(?:INV[-\s]*)?(10\d{5})\b', b, re.I)
        explicit_inv = inv_match.group(1) if inv_match else None
        sheet_addr_norm = normalize(c or '')

        matched_source = None
        matched_ops = None

        def pick_best_source(candidates):
            if not candidates:
                return None
            if len(candidates) == 1 or not sheet_addr_norm:
                return candidates[0]
            # Prefer candidate whose address best overlaps with Column C
            addr_tokens = [tok for tok in re.split(r'[^a-z0-9]+', (c or '').lower()) if len(tok) >= 2]
            best = candidates[0]
            best_score = -1
            for cand in candidates:
                c_addr = (cand.get('address') or '').lower()
                score = sum(2 if tok.isdigit() else 1 for tok in addr_tokens if tok in c_addr)
                if score > best_score:
                    best_score = score
                    best = cand
            return best

        if explicit_inv:
            for s_row in source_rows:
                if explicit_inv in (s_row.get('invoice_number') or ''):
                    matched_source = s_row
                    break
            if not matched_source:
                for jb in ops_jobs:
                    if explicit_inv in (jb.get('invoice_number') or ''):
                        matched_ops = jb
                        break

        if not matched_source and not matched_ops and len(phone_digits) >= 7:
            phone_cands = []
            for s_row in source_rows:
                s_phone = re.sub(r'[^0-9]', '', s_row.get('customer_phone') or '')
                if phone_digits in s_phone or (len(s_phone) >= 7 and s_phone in phone_digits):
                    phone_cands.append(s_row)
            matched_source = pick_best_source(phone_cands)

        if not matched_source and not matched_ops and len(target_norm) >= 3:
            name_cands = []
            for s_row in source_rows:
                s_norm = normalize(s_row.get('customer_name'))
                if (
                    s_norm == target_norm
                    or s_norm == base_norm
                    or (len(s_norm) >= 5 and (target_norm in s_norm or s_norm in target_norm or base_norm in s_norm or s_norm in base_norm))
                ):
                    name_cands.append(s_row)
            matched_source = pick_best_source(name_cands)

        if not matched_source and not matched_ops and len(phone_digits) >= 7:
            for jb in ops_jobs:
                jb_phone = re.sub(r'[^0-9]', '', jb.get('delivery_contact_number') or '')
                if phone_digits in jb_phone:
                    matched_ops = jb
                    break

        if not matched_source and not matched_ops and len(target_norm) >= 3:
            for jb in ops_jobs:
                jb_norm = normalize(jb.get('customer_name'))
                if (
                    jb_norm == target_norm
                    or jb_norm == base_norm
                    or (len(jb_norm) >= 5 and (target_norm in jb_norm or jb_norm in target_norm or base_norm in jb_norm or jb_norm in base_norm))
                ):
                    matched_ops = jb
                    break

        # Resolve between source_rows (prod_main) and ops_jobs (installation_jobs).
        # Any job present in prod_main is keyed by matched_source['bubble_id'] in /api/jobs,
        # whereas standalone jobs (not in prod_main) are keyed by matched_ops['id'].
        if matched_source and not matched_ops:
            matched_ops = next(
                (jb for jb in ops_jobs if jb.get('source_invoice_id') == matched_source['bubble_id']),
                None,
            )
        elif matched_ops and not matched_source:
            src_id = matched_ops.get('source_invoice_id')
            if src_id and src_id in source_by_id:
                matched_source = source_by_id[src_id]

        job_id = None
        if matched_source:
            job_id = matched_source['bubble_id']
        elif matched_ops:
            job_id = matched_ops['id']
        else:
            job_id = f"job-{target_norm[:12]}-{slot_info['isoDate']}"

        # If two distinct houses for the same customer are scheduled on the same team & date
        # (e.g. Hii Hiong Liew 96 and Hii Hiong Liew 44) and resolved to the same job_id,
        # give the second row a distinct job_id so both slots render on the board.
        used_on_td = used_job_ids_by_team_date.setdefault(td_key, set())
        if job_id in used_on_td:
            job_id = f"{job_id}-{target_norm[-4:] or prev_td_count + 1}"
        used_on_td.add(job_id)

        # Resolve pulled DB fields (falling back to sheet if DB missing)
        final_address = c.strip()
        final_phone = j.strip()
        final_email = k.strip()
        final_agent = i_val.strip()
        final_phase = d.strip()
        final_panels = f_val.strip()
        final_inverter = g.strip()

        if matched_source:
            if matched_source.get('address'):
                final_address = matched_source['address'].replace('\n', ', ')
            if matched_source.get('customer_phone'):
                final_phone = matched_source['customer_phone']
            if matched_source.get('customer_email'):
                final_email = matched_source['customer_email']
            if matched_source.get('agent_name'):
                final_agent = matched_source['agent_name']
            if matched_source.get('phase'):
                final_phase = matched_source['phase']
            source_panel = extract_panel_line(matched_source.get('package_item_description'))
            if source_panel:
                final_panels = source_panel
            if matched_source.get('inverter_name'):
                final_inverter = matched_source['inverter_name']
        elif matched_ops:
            if matched_ops.get('warehouse_location'):
                final_address = matched_ops['warehouse_location']
            if matched_ops.get('delivery_contact_number'):
                final_phone = matched_ops['delivery_contact_number']
            ops_panel = extract_panel_line(matched_ops.get('power_output')) or extract_panel_line(matched_ops.get('panel_details'))
            if ops_panel:
                final_panels = ops_panel
            if matched_ops.get('inverter_battery'):
                final_inverter = matched_ops['inverter_battery']

        parsed_items.append({
            'row': r['row'],
            'week': current_week,
            'team': current_team,
            # Blank when the sheet's "Install:" is blank (weeks not crewed yet),
            # rather than a made-up AR17
            'installTeam': current_install,
            'wiringTeam': current_wiring,
            'supervisor': current_supervisor,
            'wiringMembers': list(current_members),
            'cars': list(current_cars),
            'slot': slot_info,
            'customer': cust_info,
            'jobId': job_id,
            'matchedSource': matched_source,
            'matchedOps': matched_ops,
            'fields': {
                'address': final_address,
                'phone': final_phone,
                'email': final_email,
                'agent': final_agent,
                'phase': final_phase,
                'panels': final_panels,
                'inverter': final_inverter,
            },
            'remarks': cust_info['remarks']
        })

    print(f"Total parsed items: {len(parsed_items)}")
    matched_count = sum(1 for p in parsed_items if p['matchedSource'] or p['matchedOps'])
    print(f"Matched with DB: {matched_count} / {len(parsed_items)} ({matched_count / len(parsed_items) * 100:.1f}%)")

    # 6. Every week in the sheet has been arranged by ops, future weeks included,
    # so all sheet rows become Arranged Installation groups. Propose to Install
    # is left to placements made in the app for jobs the sheet doesn't list.
    TODAY = datetime.now().strftime('%Y-%m-%d')

    arranged_items = list(parsed_items)
    propose_items = []

    # One status per job: its newest row decides, tick included (an earlier
    # visit ticked doesn't finish a job whose latest visit is still to come),
    # the same way the jobs upsert below picks the date
    latest_by_job = {}
    for p in parsed_items:
        prev = latest_by_job.get(p['jobId'])
        if prev is None or p['slot']['isoDate'] >= prev['slot']['isoDate']:
            latest_by_job[p['jobId']] = p
    status_by_job = {
        jid: sheet_availability_status(p, TODAY)
        for jid, p in latest_by_job.items()
    }

    print(f"Arranged Installation items: {len(arranged_items)}")
    print(f"Propose to Install items: {len(propose_items)}")

    # 7. Build state updates
    existing_groups = list(ops_state.get('groups', []))
    job_updates = dict(ops_state.get('jobUpdates', {}))
    week_assignments = list(ops_state.get('teamWeekAssignments') or ops_state.get('weekAssignments') or [])
    schedule_draft = dict(ops_state.get('scheduleDraft', {}))
    existing_placements = list(schedule_draft.get('placements', []))
    existing_removals = list(schedule_draft.get('removals', []))
    team_crews = dict(schedule_draft.get('teamCrews') or {})

    # Clean replacement of Google Sheet arranged groups (prefixed with arr-)
    kept_groups = [g for g in existing_groups if not g.get('id', '').startswith('arr-')]

    new_groups = []
    used_group_ids = set(kept.get('id') for kept in kept_groups)
    new_assignments = []

    for item in arranged_items:
        slot = item['slot']
        cust = item['customer']
        fields = item['fields']
        job_id = item['jobId']
        iso_date = slot['isoDate']
        time_str = slot['timeStr']
        team = item['team']

        status = status_by_job[job_id]

        group_id = f"arr-{team.lower().replace(' ', '')}-{normalize(cust['cleanName'])[:8]}-{iso_date}"
        # Two customers whose names start alike, booked for one team on one day
        # (Mohd Hosaini No.6 and No.6a), would share an id and the page would
        # mix their rows up; the second one gets a numbered suffix
        if group_id in used_group_ids:
            n = 2
            while f"{group_id}-{n}" in used_group_ids:
                n += 1
            group_id = f"{group_id}-{n}"
        used_group_ids.add(group_id)

        sup_list = [
            s.strip()
            for s in re.split(r'[,/]', item['supervisor'] or '')
            if s.strip()
        ]
        grp = {
            'id': group_id,
            'name': f"{team} · {cust['cleanName']}",
            'area': fields['address'],
            'installationDate': iso_date,
            'installationEndDate': iso_date,
            'jobIds': [job_id],
            'installationTeam': item['installTeam'] or '',
            'wiringTeam': item['wiringTeam'] or '',
            'supervisors': sup_list,
            'teamLabel': team,
            'wiringMembers': item.get('wiringMembers') or [],
            'cars': item.get('cars') or [],
            'remark': cust['remarks'],
        }
        new_groups.append(grp)

        if iso_date >= TODAY:
            m_tnum = re.search(r'\bteam\s*([1-4])\b', team, re.I)
            if m_tnum:
                t_key = m_tnum.group(1)
                cur_crew = dict(team_crews.get(t_key) or team_crews.get(int(t_key)) or {})
                if item['installTeam']:
                    cur_crew['installationTeam'] = item['installTeam']
                if item['wiringTeam']:
                    cur_crew['wiringTeam'] = item['wiringTeam']
                if item['supervisor']:
                    cur_crew['siteSupervisor'] = item['supervisor']
                team_crews[t_key] = cur_crew

        # Keep ONLY operational fields in job_updates to keep JSON compact and clean
        job_Patch = {
            **(job_updates.get(job_id) or {}),
            'customerName': cust['cleanName'],
            'installationDate': iso_date,
            'preferredInstallationDate': iso_date,
            'preferredInstallationTime': time_str,
            'scheduleStatus': 'ready_to_schedule',
            'customerAvailabilityStatus': status,
            'installationApprovalStatus': 'date_approved',
            'installationRemarks': cust['remarks'],
        }
        if not item['matchedSource']:
            if fields['address']:
                job_Patch['address'] = fields['address']
            if fields['phone']:
                job_Patch['customerPhone'] = fields['phone']
            if fields['panels']:
                job_Patch['powerOutput'] = fields['panels']
            if fields['inverter']:
                job_Patch['inverterBattery'] = fields['inverter']
        job_updates[job_id] = job_Patch

        new_assignments.append({
            'id': f"assign-{group_id}",
            'installationGroupId': group_id,
            'teamId': '',
            'startDate': f"{iso_date}T{time_str}:00.000Z",
        })

    kept_assignments = [a for a in week_assignments if not a.get('id', '').startswith('assign-')]
    final_assignments = kept_assignments + new_assignments

    # Placements for Propose to Install: drop any job the sheet now arranges,
    # and any placement whose date has already passed
    sheet_job_ids = set(p['jobId'] for p in parsed_items)
    filtered_placements = [
        p for p in existing_placements
        if p.get('jobId') not in sheet_job_ids and p.get('date', '') >= TODAY
    ]
    filtered_removals = [
        r for r in existing_removals
        if r.get('jobId') not in sheet_job_ids
    ]

    for item in propose_items:
        slot = item['slot']
        cust = item['customer']
        fields = item['fields']
        job_id = item['jobId']
        iso_date = slot['isoDate']
        time_str = slot['timeStr']
        team_str = item['team']

        m_team = re.search(r'(\d+)', team_str)
        team_num = int(m_team.group(1)) if m_team else 1
        if team_num not in [1, 2, 3, 4]:
            team_num = 1

        dt = datetime.strptime(iso_date, '%Y-%m-%d')
        week_start_dt = dt.fromordinal(dt.toordinal() - dt.weekday())
        week_start = week_start_dt.strftime('%Y-%m-%d')

        slot_type = slot['slot']

        filtered_placements.append({
            'jobId': job_id,
            'weekStart': week_start,
            'team': team_num,
            'date': iso_date,
            'slot': slot_type
        })

        # Set status to 'propose'
        job_updates[job_id] = {
            **(job_updates.get(job_id) or {}),
            'customerName': cust['cleanName'],
            'preferredInstallationDate': iso_date,
            'preferredInstallationTime': time_str,
            'customerAvailabilityStatus': 'propose',
            'installationRemarks': cust['remarks'],
        }

    updated_groups = kept_groups + new_groups

    # Write ops state in clean parts so payload size is always well within proxy limits:
    # 1. Groups (in two slices so each payload is ~220 KB, well under proxy limit)
    print("Writing groups to public.installation_ops_state...")
    half = len(updated_groups) // 2
    g1 = updated_groups[:half]
    g2 = updated_groups[half:]

    query_db(PG_OPS_URL, PG_OPS_DB, PG_OPS_TOKEN, """
        UPDATE public.installation_ops_state
        SET state = jsonb_set(state, '{groups}', $1::jsonb),
            updated_at = NOW()
        WHERE id = 'default'
    """, [json.dumps(g1)])

    if g2:
        query_db(PG_OPS_URL, PG_OPS_DB, PG_OPS_TOKEN, """
            UPDATE public.installation_ops_state
            SET state = jsonb_set(state, '{groups}', (state->'groups') || $1::jsonb),
                updated_at = NOW()
            WHERE id = 'default'
        """, [json.dumps(g2)])

    # 2. Schedule draft (placements) & lastScheduleSync
    print("Writing scheduleDraft to public.installation_ops_state...")
    draft_patch = {
        'scheduleDraft': {
            **schedule_draft,
            'placements': filtered_placements,
            'removals': filtered_removals,
            'teamCrews': team_crews,
        },
        'teamWeekAssignments': final_assignments,
        'weekAssignments': final_assignments,
        'lastScheduleSync': datetime.now().isoformat()
    }
    query_db(PG_OPS_URL, PG_OPS_DB, PG_OPS_TOKEN, """
        INSERT INTO public.installation_ops_state (id, state)
        VALUES ($1, $2::jsonb)
        ON CONFLICT (id) DO UPDATE SET
            state = (public.installation_ops_state.state || EXCLUDED.state),
            updated_at = NOW()
    """, ['default', json.dumps(draft_patch)])
    print("Structure patches saved.")

    # 2. Merge jobUpdates in small chunks (e.g. 150 jobs per chunk)
    print("Merging jobUpdates into public.installation_ops_state...")
    job_ids = list(job_updates.keys())
    chunk_size = 150
    for idx in range(0, len(job_ids), chunk_size):
        chunk_ids = job_ids[idx:idx + chunk_size]
        chunk_updates = {jid: job_updates[jid] for jid in chunk_ids}
        if idx == 0:
            query_db(PG_OPS_URL, PG_OPS_DB, PG_OPS_TOKEN, """
                UPDATE public.installation_ops_state
                SET state = jsonb_set(state, '{jobUpdates}', $1::jsonb),
                    updated_at = NOW()
                WHERE id = 'default'
            """, [json.dumps(chunk_updates)])
        else:
            query_db(PG_OPS_URL, PG_OPS_DB, PG_OPS_TOKEN, """
                UPDATE public.installation_ops_state
                SET state = jsonb_set(
                    state,
                    '{jobUpdates}',
                    coalesce(state->'jobUpdates', '{}'::jsonb) || ($1::jsonb)
                ),
                updated_at = NOW()
                WHERE id = 'default'
            """, [json.dumps(chunk_updates)])
        print(f"Merged jobUpdates {idx + 1} to {min(idx + chunk_size, len(job_ids))}...")

    # 8. Upsert customer records into public.installation_jobs (deduplicated by source_id)
    print("Upserting customer records into public.installation_jobs...")
    jobs_by_source_id = {}
    for item in parsed_items:
        source_id = (
            item['matchedSource']['bubble_id'] if item['matchedSource']
            else (item['matchedOps']['source_invoice_id'] if item['matchedOps'] else item['jobId'])
        )
        cust = item['customer']
        if source_id not in jobs_by_source_id:
            item_copy = dict(item)
            item_copy['customer'] = dict(cust)
            item_copy['sourceId'] = source_id
            jobs_by_source_id[source_id] = item_copy
        else:
            existing = jobs_by_source_id[source_id]
            # Merge green tick: if ANY occurrence is complete, customer is complete
            if cust.get('hasGreenTick'):
                existing['customer']['hasGreenTick'] = True
            # Merge remarks
            r1 = existing.get('customer', {}).get('remarks', '').strip()
            r2 = cust.get('remarks', '').strip()
            if r2 and r2 not in r1:
                existing['customer']['remarks'] = f"{r1}\n{r2}".strip() if r1 else r2
            # Prioritize newer date for slot/fields
            if item['slot']['isoDate'] >= existing['slot']['isoDate']:
                merged_tick = existing['customer']['hasGreenTick'] or cust.get('hasGreenTick', False)
                merged_rem = existing['customer']['remarks']
                item_copy = dict(item)
                item_copy['customer'] = dict(cust)
                item_copy['customer']['hasGreenTick'] = merged_tick
                item_copy['customer']['remarks'] = merged_rem
                item_copy['sourceId'] = source_id
                jobs_by_source_id[source_id] = item_copy

    print(f"Total unique source jobs to upsert: {len(jobs_by_source_id)}")

    items_list = list(jobs_by_source_id.values())
    chunk_size = 40
    upsert_success = 0
    upsert_fail = 0

    for c_idx in range(0, len(items_list), chunk_size):
        chunk = items_list[c_idx:c_idx + chunk_size]
        values_clauses = []
        flat_params = []
        for i, item in enumerate(chunk):
            job_id = item['jobId']
            source_id = item['sourceId']
            cust = item['customer']
            slot = item['slot']
            fields = item['fields']
            status = status_by_job[job_id]

            inv_num = (
                item['matchedSource']['invoice_number'] if item['matchedSource'] and item['matchedSource'].get('invoice_number')
                else (item['matchedOps']['invoice_number'] if item['matchedOps'] and item['matchedOps'].get('invoice_number') else f"INV-{job_id[:8]}")
            )

            offset = i * 24
            row_placeholders = [f"${offset + p}" for p in range(1, 25)]
            row_placeholders[21] = f"{row_placeholders[21]}::date"
            row_placeholders[22] = f"{row_placeholders[22]}::date"
            values_clauses.append(f"({', '.join(row_placeholders)})")

            flat_params.extend([
                job_id,
                source_id,
                inv_num,
                cust['cleanName'],
                status,
                '',
                'date_approved',
                'ready_to_schedule',
                'pending',
                '',
                fields['phone'],
                fields['address'],
                fields['panels'],
                '',
                '',
                '',
                'none',
                '',
                cust['remarks'],
                fields['inverter'],
                fields['panels'],
                slot['isoDate'],
                slot['isoDate'],
                slot['timeStr']
            ])

        sql = f"""
            INSERT INTO public.installation_jobs (
                id, source_invoice_id, invoice_number, customer_name, customer_availability_status,
                availability_remarks, installation_approval_status, schedule_status, delivery_status,
                stock_details, delivery_contact_number, warehouse_location, panel_details,
                wiring_details, battery_details, remarks, payment_override_status, payment_override_reason,
                installation_remarks, inverter_battery, power_output,
                installation_date, preferred_installation_date, preferred_installation_time
            ) VALUES {', '.join(values_clauses)}
            ON CONFLICT (source_invoice_id) DO UPDATE SET
                customer_availability_status = EXCLUDED.customer_availability_status,
                installation_date = EXCLUDED.installation_date,
                preferred_installation_date = EXCLUDED.preferred_installation_date,
                preferred_installation_time = EXCLUDED.preferred_installation_time,
                installation_remarks = COALESCE(NULLIF(EXCLUDED.installation_remarks, ''), installation_jobs.installation_remarks),
                panel_details = COALESCE(NULLIF(EXCLUDED.panel_details, ''), installation_jobs.panel_details),
                inverter_battery = COALESCE(NULLIF(EXCLUDED.inverter_battery, ''), installation_jobs.inverter_battery),
                power_output = COALESCE(NULLIF(EXCLUDED.power_output, ''), installation_jobs.power_output),
                warehouse_location = COALESCE(NULLIF(installation_jobs.warehouse_location, ''), EXCLUDED.warehouse_location),
                delivery_contact_number = COALESCE(NULLIF(installation_jobs.delivery_contact_number, ''), EXCLUDED.delivery_contact_number),
                updated_at = NOW()
        """
        try:
            query_db(PG_OPS_URL, PG_OPS_DB, PG_OPS_TOKEN, sql, flat_params)
            upsert_success += len(chunk)
            print(f"Upserted {min(c_idx + chunk_size, len(items_list))} / {len(items_list)} jobs...")
        except Exception as e:
            upsert_fail += len(chunk)
            print(f"Warning: Failed batch upsert for chunk starting at {c_idx}: {e}")

    # 9. Parse and sync Delivery Schedule (2026 DELIVERY SCHEDULE)
    print("9. Parsing and syncing delivery schedule...")
    del_runs = []
    current_week = None
    current_driver_pic = ''
    current_driver_phone = ''
    current_lorry = 'Delivery Team 1'
    current_run = None

    for r_info in delivery_sheet_rows:
        r = r_info['row']
        c_map = r_info['cells']
        colA = c_map.get(f'A{r}', '')
        colB = c_map.get(f'B{r}', '')
        colC = c_map.get(f'C{r}', '')
        colI = c_map.get(f'I{r}', '')
        colJ = c_map.get(f'J{r}', '')
        colK = c_map.get(f'K{r}', '')
        colM = c_map.get(f'M{r}', '')

        strA = str(colA).strip()
        strB = str(colB).strip()
        strC = str(colC).strip()

        if 'WEEK' in strA.upper() and ('DELIVERY' in strA.upper() or '~' in strA or '-' in strA):
            current_week = strA
            continue
            
        if 'DRIVER:' in strA.upper() or 'LORRY' in strA.upper():
            m_driver = re.search(r'DRIVER:\s*([A-Za-z\s]+?)(?:\s+(\d[\d\s-]+))?(?:[（(]|$)', strA, re.I)
            if m_driver:
                current_driver_pic = m_driver.group(1).strip()
                if m_driver.group(2):
                    current_driver_phone = re.sub(r'[^\d-]', '', m_driver.group(2)).strip()
            m_lorry = re.search(r'(Lorry\s*\d+)', strA, re.I)
            if m_lorry:
                current_lorry = m_lorry.group(1).strip()
            continue
            
        if 'TOTAL PCS' in strC.upper() or 'TOTAL PCS' in strB.upper():
            if current_run:
                del_runs.append(current_run)
                current_run = None
            continue

        is_slot = False
        if strA and (re.search(r'\d{1,2}/\d{1,2}', strA) or re.search(r'\b(sun|mon|tue|wed|thu|fri|sat)\b', strA, re.I) or '@' in strA):
            is_slot = True
            
        if is_slot:
            if current_run and current_run['customers']:
                del_runs.append(current_run)
            d_date, d_time = parse_delivery_departure(strA)
            current_run = {
                'name': strA,
                'weekLabel': current_week or '',
                'deliveryDate': d_date or '2026-10-10',
                'departureTime': d_time or '09:00',
                'deliveryPic': current_driver_pic,
                'contactNumber': current_driver_phone,
                'deliveryTeam': current_lorry,
                'warehouse': 'JB Warehouse',
                'customers': []
            }
            
        if strB and not strB.upper().startswith('CLIENT NAME') and not strB.upper().startswith('CUSTOMER'):
            if current_run:
                cust_name, remark = parse_delivery_customer_cell(strB)
                current_run['customers'].append({
                    'row': r,
                    'rawB': strB,
                    'customerName': cust_name,
                    'remark': remark,
                    'address': strC,
                    'eta': str(colI).strip() if colI else '',
                    'instDate': str(colJ).strip() if colJ else '',
                    'instTeam': str(colK).strip() if colK else '',
                    'extraStock': str(colM).strip() if colM else ''
                })

    if current_run and current_run['customers']:
        del_runs.append(current_run)

    print(f"Parsed {len(del_runs)} delivery runs from sheet.")

    norm_ops = {}
    for j in ops_jobs:
        n = normalize(j.get('customer_name') or '')
        if n and n not in norm_ops:
            norm_ops[n] = j

    delivery_runs_to_save = []
    delivery_job_updates = {}

    for idx, r in enumerate(del_runs):
        matched_job_ids = []
        for c in r['customers']:
            name = c['customerName']
            n = normalize(name)
            matched_job = norm_ops.get(n)
            if not matched_job:
                for db_n, j in norm_ops.items():
                    if len(n) > 5 and (n in db_n or db_n in n):
                        matched_job = j
                        break
            if matched_job:
                jid = matched_job['id']
                matched_job_ids.append(jid)
                
                final_remark = c['remark']
                if c['extraStock']:
                    final_remark = f"{final_remark}\n{c['extraStock']}".strip() if final_remark else c['extraStock']
                
                eta_d, eta_t = parse_delivery_departure(c['eta'])
                
                delivery_job_updates[jid] = {
                    'stock_details': final_remark or '',
                    'arrival_date': eta_d or r['deliveryDate'],
                    'arrival_time': eta_t or r['departureTime']
                }
                
        if matched_job_ids:
            run_obj = {
                'id': f"del-{r['deliveryDate'].replace('-', '')}-{idx+1}",
                'name': r['name'],
                'deliveryDate': r['deliveryDate'],
                'departureTime': r['departureTime'],
                'warehouse': r['warehouse'],
                'deliveryTeam': r['deliveryTeam'],
                'deliveryPic': r['deliveryPic'],
                'contactNumber': r['contactNumber'],
                'installationGroupId': '',
                'status': 'delivered' if r['deliveryDate'] < '2026-10-25' else 'pending_stock',
                'jobIds': matched_job_ids,
                'weekLabel': r['weekLabel'],
                'order': idx + 1
            }
            delivery_runs_to_save.append(run_obj)

    print(f"Constructed {len(delivery_runs_to_save)} delivery runs with {sum(len(r['jobIds']) for r in delivery_runs_to_save)} jobs.")

    # Save deliveryRuns into public.installation_ops_state
    print("Writing deliveryRuns to public.installation_ops_state...")
    query_db(PG_OPS_URL, PG_OPS_DB, PG_OPS_TOKEN, """
        UPDATE public.installation_ops_state
        SET state = jsonb_set(state, '{deliveryRuns}', $1::jsonb),
            updated_at = NOW()
        WHERE id = 'default'
    """, [json.dumps(delivery_runs_to_save)])

    # Batch update installation_jobs with stock_details, arrival_date, arrival_time
    print(f"Updating {len(delivery_job_updates)} jobs with delivery remarks and ETAs...")
    chunk_size = 50
    j_items = list(delivery_job_updates.items())
    for c_idx in range(0, len(j_items), chunk_size):
        chunk = j_items[c_idx:c_idx + chunk_size]
        values_clauses = []
        params = []
        for i, (jid, vals) in enumerate(chunk):
            offset = i * 4
            values_clauses.append(f"(${offset+1}, ${offset+2}, ${offset+3}::date, ${offset+4})")
            params.extend([jid, vals['stock_details'], vals['arrival_date'], vals['arrival_time']])
        
        sql = f"""
            UPDATE public.installation_jobs AS j
            SET stock_details = COALESCE(NULLIF(v.stock_details, ''), j.stock_details),
                arrival_date = COALESCE(v.arrival_date, j.arrival_date),
                arrival_time = COALESCE(NULLIF(v.arrival_time, ''), j.arrival_time),
                updated_at = NOW()
            FROM (VALUES {', '.join(values_clauses)}) AS v(id, stock_details, arrival_date, arrival_time)
            WHERE j.id = v.id
        """
        try:
            query_db(PG_OPS_URL, PG_OPS_DB, PG_OPS_TOKEN, sql, params)
        except Exception as e:
            print(f"Warning: Failed batch update for delivery jobs starting at {c_idx}: {e}")

    print(f"=== Synchronization completed successfully! (Upserted: {upsert_success}, Failed: {upsert_fail}) ===")
    return {
        'total': len(parsed_items),
        'arranged': len(arranged_items),
        'propose': len(propose_items),
        'matched': matched_count,
        'upserted': upsert_success,
        'deliveryRuns': len(delivery_runs_to_save),
        'deliveryJobs': len(delivery_job_updates),
        'lastSynced': draft_patch['lastScheduleSync']
    }

if __name__ == '__main__':
    res = sync_schedule()
    print("\nFinal Result:", json.dumps(res, indent=2))
