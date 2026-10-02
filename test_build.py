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

TITLE_TEXT = "Event Username Format: s-MMDDxy (xy = event leader's initials)"
GROUP_HEADER_ROW = [
    "Timestamp", "Your name", "Organization", "Leader email",
    "Leader phone number", "Location of event", "Date of event", "Event Username",
]
SAMPLE_GROUP_VALUES = [
    [TITLE_TEXT, TITLE_TEXT, TITLE_TEXT],
    [],
    [],
    GROUP_HEADER_ROW,
    ["1/1/2025", "Lead", "CCAC", "lead@example.com", "555-0100", "Oakland", "1/2/2025", "CCAC1"],
]

ALIASES_HEADER_ROW = ["Registered Username", "Alternate Username", "Alternate Email"]
SAMPLE_ALIASES_VALUES = [
    ["Note: add one row per extra login"],
    [],
    ALIASES_HEADER_ROW,
    ["zell2", "Zel2", "zel2@example.com"],
]


class EmailFilesAreNotPublishedTest(unittest.TestCase):
    """The repo folder is published as-is, so email-bearing files must never land in it."""

    def run_build(self):
        seen = {}

        def fake_fetch_sheet_values(tab_name):
            return {
                build.ROSTER_TAB_NAME: SAMPLE_ROSTER_VALUES,
                build.GROUP_TAB_NAME: SAMPLE_GROUP_VALUES,
                build.ALIASES_TAB_NAME: SAMPLE_ALIASES_VALUES,
            }[tab_name]

        def fake_run(cmd, check, env):
            raw_path = env[build.SURVEY_INPUT_ENV_VAR]
            seen["raw_path"] = raw_path
            seen["roster_path"] = env[build.ROSTER_ENV_VAR]
            seen["group_path"] = env[build.GROUP_ACCOUNTS_ENV_VAR]
            seen["aliases_path"] = env[build.ALIASES_ENV_VAR]
            with open(raw_path, encoding="utf-8") as f:
                seen["raw_contents"] = f.read()
            with open(seen["roster_path"], encoding="utf-8") as f:
                seen["roster_contents"] = f.read()
            with open(seen["group_path"], encoding="utf-8") as f:
                seen["group_contents"] = f.read()
            with open(seen["aliases_path"], encoding="utf-8") as f:
                seen["aliases_contents"] = f.read()

        with tempfile.TemporaryDirectory() as repo_dir:
            cwd = os.getcwd()
            os.chdir(repo_dir)
            try:
                with mock.patch.object(build, "fetch_all_features", return_value=SAMPLE_FEATURES), \
                        mock.patch.object(build, "fetch_sheet_values", side_effect=fake_fetch_sheet_values), \
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

    def test_group_usernames_are_handed_to_the_pipeline_without_leader_pii(self):
        seen, _, _ = self.run_build()
        self.assertEqual(seen["group_contents"].split(), ["Username", "CCAC1"])
        for secret in ("lead@example.com", "555-0100"):
            self.assertNotIn(secret, seen["group_contents"])

    def test_alternate_logins_are_handed_to_the_pipeline(self):
        seen, _, _ = self.run_build()
        self.assertEqual(
            seen["aliases_contents"].splitlines(),
            ["Registered Username,Alternate Username,Email address", "zell2,Zel2,zel2@example.com"],
        )

    def test_survey_roster_and_group_files_are_written_outside_the_published_folder(self):
        seen, _, repo_dir = self.run_build()
        for key in ("raw_path", "roster_path", "group_path", "aliases_path"):
            self.assertFalse(os.path.realpath(seen[key]).startswith(os.path.realpath(repo_dir)))

    def test_survey_roster_and_group_files_are_deleted_after_the_build(self):
        seen, published, _ = self.run_build()
        self.assertFalse(os.path.exists(seen["raw_path"]))
        self.assertFalse(os.path.exists(seen["roster_path"]))
        self.assertFalse(os.path.exists(seen["group_path"]))
        self.assertFalse(os.path.exists(seen["aliases_path"]))
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


class ExtractGroupUsernamesTest(unittest.TestCase):
    def test_title_row_text_is_not_mistaken_for_the_header(self):
        values = [[TITLE_TEXT, TITLE_TEXT], ["Event Username", "x"], ["s-1ab", "y"]]
        self.assertEqual(build.extract_group_usernames(values), ["s-1ab"])

    def test_finds_header_on_fourth_row_and_returns_usernames_in_order(self):
        values = [
            *SAMPLE_GROUP_VALUES,
            ["", "Lead2", "Org", "l2@example.com", "555-0101", "Here", "1/3/2025", "s-apbp"],
        ]
        self.assertEqual(build.extract_group_usernames(values), ["CCAC1", "s-apbp"])

    def test_skips_blanks_and_short_rows_and_trims(self):
        values = [
            ["Event Username"],
            ["  CCAC1  "],
            ["   "],
            [""],
            [],
        ]
        self.assertEqual(build.extract_group_usernames(values), ["CCAC1"])

    def test_dedupes_case_insensitively_first_spelling_wins(self):
        values = [["Event Username"], ["CCAC1"], ["ccac1"], ["s-1ab"], ["S-1AB"]]
        self.assertEqual(build.extract_group_usernames(values), ["CCAC1", "s-1ab"])

    def test_leader_contact_details_never_in_output(self):
        flat = repr(build.extract_group_usernames(SAMPLE_GROUP_VALUES))
        for secret in ("lead@example.com", "555-0100", "Lead", "Oakland"):
            self.assertNotIn(secret, flat)

    def test_missing_header_raises(self):
        with self.assertRaises(ValueError):
            build.extract_group_usernames([[TITLE_TEXT], ["a", "b"]])


class ExtractAlternateLoginsTest(unittest.TestCase):
    def test_finds_header_below_note_rows(self):
        self.assertEqual(
            build.extract_alternate_logins(SAMPLE_ALIASES_VALUES),
            [("zell2", "Zel2", "zel2@example.com")],
        )

    def test_either_alternate_may_be_blank_but_not_both(self):
        values = [
            ALIASES_HEADER_ROW,
            ["a", "A1", ""],
            ["b", "", "b2@example.com"],
            ["c", "", ""],
            ["d", "   ", "  "],
        ]
        self.assertEqual(
            build.extract_alternate_logins(values),
            [("a", "A1", ""), ("b", "", "b2@example.com")],
        )

    def test_skips_blank_registered_username_and_trims(self):
        values = [
            ["  Registered Username ", "Alternate Username", "Alternate Email"],
            ["  zell2 ", " Zel2 ", " z@example.com "],
            ["", "Orphan", "o@example.com"],
            ["   ", "Orphan2", ""],
        ]
        self.assertEqual(
            build.extract_alternate_logins(values), [("zell2", "Zel2", "z@example.com")]
        )

    def test_short_rows_yield_blank_cells(self):
        values = [ALIASES_HEADER_ROW, ["zell2", "Zel2"], []]
        self.assertEqual(build.extract_alternate_logins(values), [("zell2", "Zel2", "")])

    def test_columns_may_appear_in_any_order(self):
        values = [["Alternate Email", "Registered Username", "Alternate Username"], ["e@x.com", "r", "u"]]
        self.assertEqual(build.extract_alternate_logins(values), [("r", "u", "e@x.com")])

    def test_extra_columns_never_in_output(self):
        values = [
            [*ALIASES_HEADER_ROW, "Phone", "Notes"],
            ["zell2", "Zel2", "z@example.com", "555-0100", "SECRET-NOTE"],
        ]
        flat = repr(build.extract_alternate_logins(values))
        for secret in ("555-0100", "SECRET-NOTE"):
            self.assertNotIn(secret, flat)

    def test_missing_header_raises(self):
        with self.assertRaises(ValueError):
            build.extract_alternate_logins([["nothing", "here"]])

    def test_missing_any_column_raises(self):
        for missing in ALIASES_HEADER_ROW:
            header = [h for h in ALIASES_HEADER_ROW if h != missing]
            # Registered Username must be present for the header row to be found at all
            with self.assertRaises(ValueError, msg=missing):
                build.extract_alternate_logins([header, ["a", "b"]])


if __name__ == "__main__":
    unittest.main()
