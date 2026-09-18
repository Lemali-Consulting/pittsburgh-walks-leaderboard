"""
Watchdog: fail if the live leaderboard's newest record is older than
MAX_AGE_DAYS. The build workflow otherwise only fires a webhook and reports
success no matter what Netlify does, so stale data was invisible.
"""

import csv
import datetime
import io
import sys
import time
import urllib.request

LIVE_CSV_URL = "https://pittsburgh-walks.lemaliconsulting.com/data/processed-survey.csv"
MAX_AGE_DAYS = 7
DATE_COLUMN = "CreationDate"


def newest_record_time():
    url = f"{LIVE_CSV_URL}?cb={int(time.time())}"
    with urllib.request.urlopen(url, timeout=60) as resp:
        text = resp.read().decode("utf-8")
    rows = csv.DictReader(io.StringIO(text))
    newest_ms = max(int(r[DATE_COLUMN]) for r in rows if r[DATE_COLUMN].strip().isdigit())
    return datetime.datetime.fromtimestamp(newest_ms / 1000, datetime.timezone.utc)


def main():
    newest = newest_record_time()
    age = datetime.datetime.now(datetime.timezone.utc) - newest
    print(f"Newest live record: {newest.isoformat()} ({age.days} days old)")
    if age > datetime.timedelta(days=MAX_AGE_DAYS):
        print(f"::error::Live leaderboard data is stale (older than {MAX_AGE_DAYS} days)")
        sys.exit(1)


if __name__ == "__main__":
    main()
