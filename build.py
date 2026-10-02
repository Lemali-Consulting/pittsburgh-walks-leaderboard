"""
Build script: fetches survey data from ArcGIS and runs the processing pipeline.

1. Queries the ArcGIS Feature Service API (with pagination)
2. Writes the raw download (columns expected by process_survey.js) to a temp
   file OUTSIDE the repo: the whole repo folder is published, and the raw
   download contains volunteer emails
3. Runs process_survey.js to generate data/processed-survey.csv (leaderboard)
   and data/group-surveys.csv (shared group accounts, counted toward the goal)
"""

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


def main():
    os.makedirs("data", exist_ok=True)

    print("Fetching survey data from ArcGIS...")
    features = fetch_all_features()
    print(f"Total records fetched: {len(features)}")

    # The raw download holds emails and the repo is published, so keep it outside the repo
    raw_fd, raw_path = tempfile.mkstemp(suffix=".csv")
    os.close(raw_fd)
    try:
        write_raw_csv(features, raw_path)
        print("Running process_survey.js...")
        subprocess.run(
            ["node", "data/process_survey.js"],
            check=True,
            env={**os.environ, SURVEY_INPUT_ENV_VAR: raw_path},
        )
    finally:
        os.remove(raw_path)

    print("Build complete.")


if __name__ == "__main__":
    main()
