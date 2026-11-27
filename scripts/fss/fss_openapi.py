#!/usr/bin/env python3
"""
금융감독원 회계업무자료 Open API 클라이언트 (2026.11.11 개시분 7종)

키 위치(우선순위): 환경변수 FSS_API_KEY → C:\\Users\\geniw\\Claude\\fss_key.txt → ~/.fss_key.txt
키는 채팅에 붙여넣지 말 것.

사용 예
  python fss_openapi.py kifrs --from 2024-01-01 --to 2026-11-27 --q 리스
  python fss_openapi.py insp  --from 2020-01-01 --q 수익인식 --out xlsx
  python fss_openapi.py all   --from 2026-11-01            # 7종 신규자료 점검

개인용 키 한도(2026-11-27 실측 — 오류 코드로 확인)
  · 한 번에 조회할 수 있는 기간은 최대 1개월(030 「최대 조회기간 초과(개인 : 1개월)」) → 달 단위로 나눠 부른다.
  · 하루 30회(033 「하루 조회 건수는 30회」) — 7종 × 개월 수가 그대로 호출 수다. JAYTAX fss-sync 와 한도를 같이 쓴다.
  · 응답은 EUC-KR(Content-Type: text/html;charset=euc-kr) — UTF-8 로 읽으면 깨진다.
  · 자료 없음은 900 「자료가 없습니다.」, 성공은 1.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://www.fss.or.kr/fss/kr/openApi/api/{ep}.jsp"

# key: (endpoint, 한글명, 상세페이지 menuNo)
APIS: dict[str, tuple[str, str, str]] = {
    "illust": ("illustDisc", "주석공시 모범사례", "201298"),
    "kifrs":  ("kifrsQa",    "K-IFRS 질의회신요약", "201299"),
    "kgaap":  ("kgaapQa",    "일반기업회계기준 질의회신요약", "201300"),
    "icfr":   ("icfrData",   "내부회계관리제도 자료", "201301"),
    "insp":   ("inspExmpl",  "심사·감리 지적사례", "201302"),
    "auddata": ("audData",   "외부감사 업무자료", "201303"),
    "audfaq": ("audFaq",     "외부감사 FAQ", "201304"),
}

# 공통 + API별 추가 필드(심사·감리지적사례·K-IFRS 질의회신)
FIELDS = ["api", "contentId", "subject", "regDate", "relStand", "issRealm", "rlsNo",
          "dcsnYr", "sprvisnTrgtYr", "deptNm", "originUrl", "atchfileNm", "atchfileUrl", "text"]

KEY_PATHS = [Path(r"C:\Users\geniw\Claude\fss_key.txt"), Path.home() / ".fss_key.txt"]


def load_key() -> str:
    k = os.environ.get("FSS_API_KEY", "").strip()
    if k:
        return k
    for p in KEY_PATHS:
        if p.exists():
            return p.read_text(encoding="utf-8").strip()
    sys.exit("인증키 없음: FSS_API_KEY 환경변수 또는 fss_key.txt 를 준비하세요.")


def html_to_text(s: str | None) -> str:
    """응답 본문은 HTML 이 한 번 더 escape 되어 옴(&lt;p&gt;...) → 두 번 풀고 태그 제거."""
    if not s:
        return ""
    s = html.unescape(html.unescape(s))
    s = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).replace("\xa0", " ")
    s = re.sub(r"[ \t]+", " ", s)
    return re.sub(r"\n\s*\n+", "\n", s).strip()


def normalize(api: str, row: dict) -> dict:
    # 가이드 예시는 contentKor, 명세는 contentsKor → 둘 다 수용
    body = row.get("contentsKor") or row.get("contentKor") or ""
    out = {f: row.get(f, "") for f in FIELDS}
    out.update(api=APIS[api][1], text=html_to_text(body))
    return out


DAILY_LIMIT = 30


class QuotaExceeded(RuntimeError):
    """033 — 하루 30회를 넘었다. 더 부르지 않고 받은 데까지만 돌려준다."""


def _decode(raw: bytes, content_type: str) -> str:
    m = re.search(r"charset=([\w-]+)", content_type or "", re.I)
    cs = (m.group(1).lower() if m else "utf-8")
    if cs in ("euc-kr", "euckr", "ks_c_5601-1987"):
        cs = "cp949"
    try:
        return raw.decode(cs)
    except UnicodeDecodeError:
        return raw.decode("cp949" if cs.startswith("utf") else "utf-8")


def fetch(api: str, start: str, end: str, key: str, retries: int = 3) -> list[dict]:
    q = urllib.parse.urlencode({"apiType": "json", "startDate": start, "endDate": end, "authKey": key})
    url = f"{BASE.format(ep=APIS[api][0])}?{q}"
    for i in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "jaytax-fss/1.0"}), timeout=30) as r:
                data = json.loads(_decode(r.read(), r.headers.get("Content-Type", "")))
            break
        except Exception:  # 네트워크 오류만 재시도(키는 메시지에 넣지 않는다)
            if i == retries - 1:
                raise RuntimeError(f"[{APIS[api][1]}] {start}~{end} 접속 실패") from None
            time.sleep(2 * (i + 1))
    body = data.get("reponse") or data.get("response") or {}   # 원문 오타 'reponse'
    code, msg = str(body.get("resultCode", "")), body.get("resultMsg", "")
    if code == "1":
        return [normalize(api, r) for r in body.get("result") or []]
    if code == "900" or (body.get("resultCnt", 0) == 0 and "없" in msg):   # 자료 없음
        return []
    if code == "033":
        raise QuotaExceeded(f"하루 조회 한도({DAILY_LIMIT}회)를 넘었습니다 — 내일 다시 하세요. ({msg})")
    raise RuntimeError(f"[{APIS[api][1]}] {code} {msg}")              # 013 미등록 인증키 · 030 기간 초과 등


def month_windows(start: str, end: str):
    """개인용 키는 한 번에 최대 1개월 — 달력 달 단위로 나눠 부른다."""
    s, e = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    while s <= e:
        nm = dt.date(s.year + (s.month == 12), s.month % 12 + 1, 1)
        nxt = min(nm - dt.timedelta(days=1), e)
        yield s.isoformat(), nxt.isoformat()
        s = nxt + dt.timedelta(days=1)


def collect(apis, start, end, key, q=None) -> list[dict]:
    rows, seen = [], set()
    try:
        _collect(apis, start, end, key, rows, seen)
    except QuotaExceeded as ex:
        print(f"⚠ {ex} 받은 {len(rows)}건까지만 보여 줍니다.", file=sys.stderr)
    if q:
        terms = q.split()
        rows = [r for r in rows if all(t in f"{r['subject']} {r['relStand']} {r['issRealm']} {r['text']}" for t in terms)]
    return sorted(rows, key=lambda r: r["regDate"], reverse=True)


def _collect(apis, start, end, key, rows, seen) -> None:
    for a in apis:
        for s, e in month_windows(start, end):
            for r in fetch(a, s, e, key):
                uid = (a, r["contentId"])
                if uid in seen:
                    continue
                seen.add(uid)
                rows.append(r)


def save(rows, fmt, label) -> Path:
    stamp = dt.date.today().strftime("%Y%m%d")
    path = Path(f"{stamp}_FSS_{label}.{fmt}")
    if fmt == "json":
        path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    elif fmt == "csv":
        with path.open("w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=FIELDS)
            w.writeheader()
            w.writerows(rows)
    else:  # xlsx
        from openpyxl import Workbook
        from openpyxl.styles import Font
        wb = Workbook()
        ws = wb.active
        ws.title = "FSS"
        ws.append(FIELDS)
        for c in ws[1]:
            c.font = Font(bold=True)
        for r in rows:
            ws.append([r[f][:32000] if isinstance(r[f], str) else r[f] for f in FIELDS])
        ws.freeze_panes = "A2"
        wb.save(path)
    return path


def main():
    ap = argparse.ArgumentParser(description="금감원 회계업무자료 Open API")
    ap.add_argument("api", choices=[*APIS, "all"])
    ap.add_argument("--from", dest="start", default=(dt.date.today() - dt.timedelta(days=30)).isoformat())
    ap.add_argument("--to", dest="end", default=dt.date.today().isoformat())
    ap.add_argument("--q", help="키워드(공백=AND), 제목·관련기준서·쟁점·본문 검색")
    ap.add_argument("--out", choices=["json", "csv", "xlsx"], help="파일 저장(파일명 YYYYMMDD_ 접두)")
    ap.add_argument("--force", action="store_true", help="하루 한도(30회)를 넘는 기간도 부른다(한도에서 멈춘다)")
    a = ap.parse_args()

    apis = list(APIS) if a.api == "all" else [a.api]
    calls = len(apis) * len(list(month_windows(a.start, a.end)))
    if calls > DAILY_LIMIT and not a.force:
        sys.exit(f"호출 {calls}회가 필요합니다(종류 {len(apis)} × {calls // len(apis)}개월) — 하루 한도 {DAILY_LIMIT}회를 넘습니다.\n"
                 f"기간이나 종류를 줄이세요(JAYTAX 가 매일 모아 두므로 오래된 자료는 JAYTAX 「금감원 자료」에서 찾는 편이 낫습니다). 그래도 하려면 --force.")
    print(f"호출 {calls}회(하루 한도 {DAILY_LIMIT}회, JAYTAX 수집과 같이 씀)", file=sys.stderr)
    rows = collect(apis, a.start, a.end, load_key(), a.q)
    for r in rows[:50]:
        print(f"{r['regDate'][:10]} [{r['api']}] {r['subject']}  {r['relStand']}  {r['originUrl']}")
    print(f"— {len(rows)}건 ({a.start} ~ {a.end})")
    if a.out:
        print("저장:", save(rows, a.out, a.api))


if __name__ == "__main__":
    main()
