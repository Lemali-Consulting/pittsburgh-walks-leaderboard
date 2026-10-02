import os
import tempfile
import unittest
from unittest import mock

import build

SAMPLE_FEATURES = [
    {"attributes": {
        "name": "Alice",
        "email": "alice@example.com",
        "neighborhood": "Bloomfield",
        "street_name": "MAIN ST",
        "CreationDate": 1700000000000,
    }},
]

SAMPLE_ROSTER_VALUES = [
    ["Email Address", "Create your username (Follow Instructions)"],
    ["alice@example.com", "Alice"],
]


class EmailFilesAreNotPublishedTest(unittest.TestCase):
    """The repo folder is published as-is, so email-bearing files must never land in it."""

    def run_build(self):
        seen = {}

        def fake_run(cmd, check, env):
            raw_path = env[build.SURVEY_INPUT_ENV_VAR]
            seen["raw_path"] = raw_path
            seen["roster_path"] = env[build.ROSTER_ENV_VAR]
            with open(raw_path, encoding="utf-8") as f:
                seen["raw_contents"] = f.read()
            with open(seen["roster_path"], encoding="utf-8") as f:
                seen["roster_contents"] = f.read()

        with tempfile.TemporaryDirectory() as repo_dir:
            cwd = os.getcwd()
            os.chdir(repo_dir)
            try:
                with mock.patch.object(build, "fetch_all_features", return_value=SAMPLE_FEATURES), \
                        mock.patch.object(build, "fetch_roster_values", return_value=SAMPLE_ROSTER_VALUES), \
                        mock.patch.object(build.subprocess, "run", side_effect=fake_run):
                    build.main()
                published = [
                    os.path.join(root, name)
                    for root, _, names in os.walk(repo_dir)
                    for name in names
                ]
            finally:
                os.chdir(cwd)
        return seen, published, repo_dir

    def test_raw_survey_is_handed_to_the_pipeline(self):
        seen, _, _ = self.run_build()
        self.assertIn("alice@example.com", seen["raw_contents"])

    def test_roster_is_handed_to_the_pipeline(self):
        seen, _, _ = self.run_build()
        self.assertIn("alice@example.com", seen["roster_contents"])

    def test_raw_survey_and_roster_are_written_outside_the_published_folder(self):
        seen, _, repo_dir = self.run_build()
        for key in ("raw_path", "roster_path"):
            self.assertFalse(os.path.realpath(seen[key]).startswith(os.path.realpath(repo_dir)))

    def test_raw_survey_and_roster_are_deleted_after_the_build(self):
        seen, published, _ = self.run_build()
        self.assertFalse(os.path.exists(seen["raw_path"]))
        self.assertFalse(os.path.exists(seen["roster_path"]))
        self.assertEqual(published, [])


HEADER_ROW = [
    "Timestamp",
    "Email Address",
    "Phone Number",
    "Ethnicity",
    "Create your username (Follow Instructions)",
    "Age",
]


def make_values(*data_rows):
    return [
        [],
        ["", "Registered Volunteer Count", "225"],
        HEADER_ROW,
        *data_rows,
    ]


class ExtractRosterPairsTest(unittest.TestCase):
    def test_finds_header_on_third_row_below_junk(self):
        values = make_values(
            ["1/1/2025", "a@example.com", "555-0100", "X", "Alice", "30"],
        )
        self.assertEqual(
            build.extract_roster_pairs(values), [("Alice", "a@example.com")]
        )

    def test_skips_blank_usernames_and_trims(self):
        values = make_values(
            ["t", "  a@example.com ", "p", "e", "  Alice  ", "30"],
            ["t", "b@example.com", "p", "e", "   ", "30"],
            ["t", "c@example.com", "p", "e", "", "30"],
        )
        self.assertEqual(
            build.extract_roster_pairs(values), [("Alice", "a@example.com")]
        )

    def test_short_rows_yield_blank_email(self):
        values = make_values(["t"], ["t", "", "p", "e", "Bob"])
        self.assertEqual(build.extract_roster_pairs(values), [("Bob", "")])

    def test_sensitive_columns_never_in_output(self):
        values = make_values(
            ["t", "a@example.com", "555-0100", "SECRET-ETHNICITY", "Alice", "99"],
        )
        flat = repr(build.extract_roster_pairs(values))
        for secret in ("555-0100", "SECRET-ETHNICITY", "99"):
            self.assertNotIn(secret, flat)

    def test_missing_header_raises(self):
        with self.assertRaises(ValueError):
            build.extract_roster_pairs([["nothing", "here"]])

    def test_missing_username_column_raises(self):
        with self.assertRaises(ValueError):
            build.extract_roster_pairs([["Email Address", "Other"], ["a", "b"]])


if __name__ == "__main__":
    unittest.main()
