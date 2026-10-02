"""
Build script: fetches survey data from ArcGIS and runs the processing pipeline.

1. Queries the ArcGIS Feature Service API (with pagination)
2. Writes the raw download (columns expected by process_survey.js) to a temp
   file OUTSIDE the repo: the whole repo folder is published, and the raw
   download contains volunteer emails
3. Fetches the private volunteer roster (username + email only) from Google
   Sheets into a temp file outside the repo, for the same reason
4. Fetches the official group-event usernames (username column only; leader
   emails and phone numbers never leave the extraction) from the sheet's
   "Group Event Information" tab into a temp file outside the repo
5. Fetches the "Alternate Logins" tab (extra usernames/emails that belong to a
   registered volunteer; those three columns only) into a temp file outside
   the repo, since it holds emails
6. Runs process_survey.js to generate data/processed-survey.csv (leaderboard)
   and data/group-surveys.csv (shared group accounts, counted toward the goal)
"""

import contextlib
import csv
import json
import os
import subprocess
import tempfile
import urllib.parse
import urllib.request

API_URL = (
    "https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/"
    "survey123_74576e994b99487e87a7bb2dedebcfbc/FeatureServer/0/query"
)
BATCH_SIZE = 2000
SURVEY_INPUT_ENV_VAR = "SURVEY_INPUT"

ROSTER_SHEET_ID = "1EdLwdXjbDd1QcYoPugrVc9jXQsZ35A0CbwBffXws_io"
ROSTER_TAB_NAME = "Registration Responses"
ROSTER_EMAIL_HEADER = "Email Address"
ROSTER_USERNAME_HEADER_PREFIX = "Create your username"
SHEETS_VALUES_URL = (
    "https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/{tab}"
)
SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"
SERVICE_ACCOUNT_ENV_VAR = "GOOGLE_SERVICE_ACCOUNT_JSON"
ROSTER_ENV_VAR = "ROSTER_INPUT"
ROSTER_CSV_HEADER = ["Username", "Email address"]
GROUP_TAB_NAME = "Group Event Information"
GROUP_USERNAME_HEADER = "Event Username"
GROUP_ACCOUNTS_ENV_VAR = "GROUP_ACCOUNTS_INPUT"
GROUP_ACCOUNTS_CSV_HEADER = ["Username"]
ALIASES_TAB_NAME = "Alternate Logins"
ALIASES_REGISTERED_HEADER = "Registered Username"
ALIASES_USERNAME_HEADER = "Alternate Username"
ALIASES_EMAIL_HEADER = "Alternate Email"
ALIASES_ENV_VAR = "ALIASES_INPUT"
ALIASES_CSV_HEADER = ["Registered Username", "Alternate Username", "Email address"]


def fetch_all_features():
    all_features = []
    offset = 0

    while True:
        where = "CreationDate>=timestamp'2025-09-10 00:00:00'"
        params = urllib.parse.urlencode({
            "where": where,
            "outFields": "name,email,neighborhood,street_name,CreationDate",
            "resultOffset": offset,
            "resultRecordCount": BATCH_SIZE,
            "f": "json",
        })
        url = API_URL + "?" + params
        with urllib.request.urlopen(url) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        features = data.get("features", [])
        count = len(features)
        print(f"  Fetched {count} records (offset {offset})")
        all_features.extend(features)

        if count < BATCH_SIZE:
            break
        offset += BATCH_SIZE

    return all_features


def write_raw_csv(features, path):
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Username", "Email address", "Neighborhood", "Street Name", "CreationDate"])
        for feat in features:
            attrs = feat.get("attributes", {})
            writer.writerow([
                attrs.get("name", ""),
                attrs.get("email", ""),
                attrs.get("neighborhood", ""),
                attrs.get("street_name", ""),
                attrs.get("CreationDate", ""),
            ])


def extract_roster_pairs(values):
    """Return [(username, email)] from the sheet's rows; no other column leaves here."""
    header_index = next(
        (i for i, row in enumerate(values) if ROSTER_EMAIL_HEADER in row), None
    )
    if header_index is None:
        raise ValueError(f"No header row containing {ROSTER_EMAIL_HEADER!r} found in roster")

    header = values[header_index]
    email_col = header.index(ROSTER_EMAIL_HEADER)
    username_col = next(
        (i for i, h in enumerate(header) if h.strip().startswith(ROSTER_USERNAME_HEADER_PREFIX)),
        None,
    )
    if username_col is None:
        raise ValueError(f"No column starting with {ROSTER_USERNAME_HEADER_PREFIX!r} in roster")

    def cell(row, col):
        return row[col].strip() if col < len(row) else ""

    pairs = []
    for row in values[header_index + 1:]:
        username = cell(row, username_col)
        if username:
            pairs.append((username, cell(row, email_col)))
    return pairs


def extract_group_usernames(values):
    """Return the listed group usernames; no other column leaves here."""
    # Exact match: the title row's "Event Username Format: ..." text must not count
    header_index = next(
        (i for i, row in enumerate(values)
         if any(cell.strip() == GROUP_USERNAME_HEADER for cell in row)),
        None,
    )
    if header_index is None:
        raise ValueError(f"No header row containing {GROUP_USERNAME_HEADER!r} found in group tab")

    username_col = next(
        i for i, cell in enumerate(values[header_index]) if cell.strip() == GROUP_USERNAME_HEADER
    )

    usernames = []
    seen = set()
    for row in values[header_index + 1:]:
        username = row[username_col].strip() if username_col < len(row) else ""
        if username and username.lower() not in seen:
            seen.add(username.lower())
            usernames.append(username)
    return usernames


def extract_alternate_logins(values):
    """Return [(registered_username, alternate_username, alternate_email)]; no other column leaves here."""
    # Exact match so note rows above the header are never mistaken for it
    header_index = next(
        (i for i, row in enumerate(values)
         if any(cell.strip() == ALIASES_REGISTERED_HEADER for cell in row)),
        None,
    )
    if header_index is None:
        raise ValueError(
            f"No header row containing {ALIASES_REGISTERED_HEADER!r} found in alternate logins tab"
        )

    header = [cell.strip() for cell in values[header_index]]
    columns = []
    for label in (ALIASES_REGISTERED_HEADER, ALIASES_USERNAME_HEADER, ALIASES_EMAIL_HEADER):
        if label not in header:
            raise ValueError(f"No {label!r} column in alternate logins tab")
        columns.append(header.index(label))
    registered_col, username_col, email_col = columns

    def cell(row, col):
        return row[col].strip() if col < len(row) else ""

    logins = []
    for row in values[header_index + 1:]:
        registered = cell(row, registered_col)
        username = cell(row, username_col)
        email = cell(row, email_col)
        if registered and (username or email):
            logins.append((registered, username, email))
    return logins


def fetch_sheet_values(tab_name):
    # Imported here so build.py (and its tests) import without google-auth installed
    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession

    raw_key = os.environ.get(SERVICE_ACCOUNT_ENV_VAR)
    if not raw_key:
        raise RuntimeError(
            f"{SERVICE_ACCOUNT_ENV_VAR} is not set: cannot fetch the Google Sheet"
        )

    credentials = service_account.Credentials.from_service_account_info(
        json.loads(raw_key), scopes=[SHEETS_READONLY_SCOPE]
    )
    url = SHEETS_VALUES_URL.format(
        sheet_id=ROSTER_SHEET_ID, tab=urllib.parse.quote(tab_name)
    )
    resp = AuthorizedSession(credentials).get(url)
    resp.raise_for_status()
    return resp.json().get("values", [])


def write_roster_csv(pairs, path):
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(ROSTER_CSV_HEADER)
        writer.writerows(pairs)


def write_group_accounts_csv(usernames, path):
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(GROUP_ACCOUNTS_CSV_HEADER)
        writer.writerows([username] for username in usernames)


def write_alternate_logins_csv(logins, path):
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(ALIASES_CSV_HEADER)
        writer.writerows(logins)


@contextlib.contextmanager
def private_temp_csv():
    """Yield a temp CSV path outside the repo (which is published), deleted afterwards."""
    fd, path = tempfile.mkstemp(suffix=".csv")
    os.close(fd)
    try:
        yield path
    finally:
        os.remove(path)


def main():
    os.makedirs("data", exist_ok=True)

    print("Fetching survey data from ArcGIS...")
    features = fetch_all_features()
    print(f"Total records fetched: {len(features)}")

    print("Fetching volunteer roster from Google Sheets...")
    pairs = extract_roster_pairs(fetch_sheet_values(ROSTER_TAB_NAME))
    print(f"Roster has {len(pairs)} registered usernames")

    print("Fetching group event usernames from Google Sheets...")
    group_usernames = extract_group_usernames(fetch_sheet_values(GROUP_TAB_NAME))
    print(f"Found {len(group_usernames)} group usernames")

    print("Fetching alternate logins from Google Sheets...")
    alternate_logins = extract_alternate_logins(fetch_sheet_values(ALIASES_TAB_NAME))
    print(f"Found {len(alternate_logins)} alternate logins")

    # The survey, roster and alternate-login files hold volunteer emails, so none of these may land in the published repo
    with private_temp_csv() as raw_path, private_temp_csv() as roster_path, \
            private_temp_csv() as group_path, private_temp_csv() as aliases_path:
        write_raw_csv(features, raw_path)
        write_roster_csv(pairs, roster_path)
        write_group_accounts_csv(group_usernames, group_path)
        write_alternate_logins_csv(alternate_logins, aliases_path)
        print("Running process_survey.js...")
        subprocess.run(
            ["node", "data/process_survey.js"],
            check=True,
            env={
                **os.environ,
                SURVEY_INPUT_ENV_VAR: raw_path,
                ROSTER_ENV_VAR: roster_path,
                GROUP_ACCOUNTS_ENV_VAR: group_path,
                ALIASES_ENV_VAR: aliases_path,
            },
        )

    print("Build complete.")


if __name__ == "__main__":
    main()
