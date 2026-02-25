"""
Build script: fetches survey data from ArcGIS and runs the processing pipeline.

1. Queries the ArcGIS Feature Service API (with pagination)
2. Writes data/raw-survey.csv with columns expected by process_survey.js
3. Runs process_survey.js to generate data/processed-survey.csv
"""

import csv
import json
import os
import subprocess
import urllib.parse
import urllib.request

API_URL = (
    "https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/"
    "survey123_74576e994b99487e87a7bb2dedebcfbc/FeatureServer/0/query"
)
BATCH_SIZE = 2000


def fetch_all_features():
    all_features = []
    offset = 0

    while True:
        where = "CreationDate>=timestamp'2025-09-10 00:00:00'"
        params = urllib.parse.urlencode({
            "where": where,
            "outFields": "name,email,neighborhood",
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
        writer.writerow(["Username", "Email address", "Neighborhood"])
        for feat in features:
            attrs = feat.get("attributes", {})
            writer.writerow([
                attrs.get("name", ""),
                attrs.get("email", ""),
                attrs.get("neighborhood", ""),
            ])


def main():
    os.makedirs("data", exist_ok=True)

    print("Fetching survey data from ArcGIS...")
    features = fetch_all_features()
    print(f"Total records fetched: {len(features)}")

    raw_path = os.path.join("data", "raw-survey.csv")
    write_raw_csv(features, raw_path)
    print(f"Wrote {raw_path}")

    print("Running process_survey.js...")
    subprocess.run(["node", "data/process_survey.js"], check=True)

    print("Build complete.")


if __name__ == "__main__":
    main()
