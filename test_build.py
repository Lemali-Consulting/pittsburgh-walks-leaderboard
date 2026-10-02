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


class RawSurveyIsNotPublishedTest(unittest.TestCase):
    """The repo folder is published as-is, so the email-bearing raw download must never land in it."""

    def run_build(self):
        seen = {}

        def fake_run(cmd, check, env):
            raw_path = env[build.SURVEY_INPUT_ENV_VAR]
            seen["raw_path"] = raw_path
            with open(raw_path, encoding="utf-8") as f:
                seen["raw_contents"] = f.read()

        with tempfile.TemporaryDirectory() as repo_dir:
            cwd = os.getcwd()
            os.chdir(repo_dir)
            try:
                with mock.patch.object(build, "fetch_all_features", return_value=SAMPLE_FEATURES), \
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

    def test_raw_survey_is_written_outside_the_published_folder(self):
        seen, _, repo_dir = self.run_build()
        self.assertFalse(os.path.realpath(seen["raw_path"]).startswith(os.path.realpath(repo_dir)))

    def test_raw_survey_is_deleted_after_the_build(self):
        seen, published, _ = self.run_build()
        self.assertFalse(os.path.exists(seen["raw_path"]))
        self.assertEqual(published, [])


if __name__ == "__main__":
    unittest.main()
