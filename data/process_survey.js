/**
 * Data pipeline to process raw-survey.csv:
 * - Remove practice rows (case-insensitive): a "Test" username, or any username
 *   containing the word "training" (e.g. "Training", "Mindy - training walk").
 *   They are not real surveys, so they count nowhere
 * - Move rows from shared group accounts (s<sep?><digits><sep?><letters>
 *   pattern, where sep may be '-', em-dash, or absent — e.g. s-328sb, s—328sb,
 *   S322ad, S516-ng)
 *   out of the leaderboard and into group-surveys.csv: they are real surveys
 *   from group activities, so they count toward the survey goal, but a shared
 *   account doesn't compete on the leaderboard
 * - Only registered volunteers appear on the leaderboard. The roster (CSV at
 *   ROSTER_INPUT, header "Username,Email address") is the source of truth:
 *   1. a row whose email matches a roster email is credited to that roster
 *      username (so typos in the username field don't split or hijack a count)
 *   2. otherwise a row whose typed username matches a roster username is
 *      credited to the roster spelling
 *   3. otherwise the row is unregistered and is dropped from every output
 *   Email wins over username. Matching is trimmed and case-insensitive; for a
 *   duplicated roster email or username the first roster row wins. Group
 *   accounts are not roster-filtered
 * - Output cleaned data to processed-survey.csv
 * - Emails are stripped from both outputs so they are never served publicly
 */

const fs = require('fs');
const path = require('path');

function parseCSV(content) {
  const lines = content.split('\n');
  const headers = parseCSVLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    rows.push(row);
  }

  return { headers, rows };
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);

  return result;
}

function escapeCSVField(field) {
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

function toCSV(headers, rows) {
  const headerLine = headers.map(escapeCSVField).join(',');
  const dataLines = rows.map(row =>
    headers.map(h => escapeCSVField(row[h] || '')).join(',')
  );
  return [headerLine, ...dataLines].join('\n');
}

const GROUP_ACCOUNT_PATTERN = /^s\W*\d+\W*\w+$/i;
const EMAIL_COLUMN = 'Email address';
const USERNAME_COLUMN = 'Username';
const ROSTER_ENV_VAR = 'ROSTER_INPUT';
const RESOLVED_VIA_EMAIL = 'email';
const RESOLVED_VIA_USERNAME = 'username';
const TEST_USERNAME = 'test';
const TRAINING_WORD_PATTERN = /\btraining\b/i;

function isPracticeRow(row) {
  const username = (row[USERNAME_COLUMN] || '').trim();
  return username.toLowerCase() === TEST_USERNAME || TRAINING_WORD_PATTERN.test(username);
}

function isGroupAccountRow(row) {
  return GROUP_ACCOUNT_PATTERN.test((row[USERNAME_COLUMN] || '').trim());
}

function normalize(value) {
  return (value || '').trim().toLowerCase();
}

// Builds email -> username and username -> username lookups (both keyed
// lowercase, valued with the roster's own spelling). First occurrence wins.
function loadRoster(rosterPath) {
  if (!rosterPath) {
    throw new Error(`${ROSTER_ENV_VAR} is not set: refusing to build an unfiltered leaderboard`);
  }
  if (!fs.existsSync(rosterPath)) {
    throw new Error(`${ROSTER_ENV_VAR} file not found: ${rosterPath}`);
  }

  const content = fs.readFileSync(rosterPath, 'utf-8').replace(/^\uFEFF/, '');
  const { rows } = parseCSV(content);
  const byEmail = new Map();
  const byUsername = new Map();

  for (const row of rows) {
    const username = (row[USERNAME_COLUMN] || '').trim();
    if (!username) continue;

    const email = normalize(row[EMAIL_COLUMN]);
    if (email && !byEmail.has(email)) byEmail.set(email, username);

    const usernameKey = username.toLowerCase();
    if (!byUsername.has(usernameKey)) byUsername.set(usernameKey, username);
  }

  return { byEmail, byUsername };
}

// Returns { username, via } for a registered volunteer, or null if unregistered.
function resolveVolunteer({ row, roster }) {
  const byEmail = roster.byEmail.get(normalize(row[EMAIL_COLUMN]));
  if (byEmail) return { username: byEmail, via: RESOLVED_VIA_EMAIL };

  const byUsername = roster.byUsername.get(normalize(row[USERNAME_COLUMN]));
  if (byUsername) return { username: byUsername, via: RESOLVED_VIA_USERNAME };

  return null;
}

function processSurvey({ inputPath, outputPath, groupOutputPath, rosterPath }) {
  const roster = loadRoster(rosterPath);

  // Read and parse input
  const content = fs.readFileSync(inputPath, 'utf-8').replace(/^\uFEFF/, ''); // Remove BOM
  const { headers, rows: allRows } = parseCSV(content);

  const surveyRows = allRows.filter(row => !isPracticeRow(row));
  const practiceRowsRemoved = allRows.length - surveyRows.length;
  const groupRows = surveyRows.filter(isGroupAccountRow);
  const candidateRows = surveyRows.filter(row => !isGroupAccountRow(row));

  // Credit each row to its roster volunteer; tally the ones that match nobody
  const rows = [];
  let resolvedViaEmail = 0;
  let resolvedViaUsername = 0;
  const unregisteredCounts = new Map();

  for (const row of candidateRows) {
    const resolved = resolveVolunteer({ row, roster });
    if (!resolved) {
      const typed = (row[USERNAME_COLUMN] || '').trim();
      unregisteredCounts.set(typed, (unregisteredCounts.get(typed) || 0) + 1);
      continue;
    }

    if (resolved.via === RESOLVED_VIA_EMAIL) resolvedViaEmail++;
    else resolvedViaUsername++;
    row[USERNAME_COLUMN] = resolved.username;
    rows.push(row);
  }

  const unregisteredUsernames = [...unregisteredCounts.entries()]
    .map(([username, count]) => ({ username, count }))
    .sort((a, b) => b.count - a.count);

  // Write output — strip the Email address column so emails are never served publicly.
  const outputHeaders = headers.filter(h => h !== EMAIL_COLUMN);
  fs.writeFileSync(outputPath, toCSV(outputHeaders, rows), 'utf-8');
  fs.writeFileSync(groupOutputPath, toCSV(outputHeaders, groupRows), 'utf-8');

  return {
    totalRows: allRows.length,
    practiceRowsRemoved,
    groupRowsSeparated: groupRows.length,
    rowsProcessed: rows.length,
    resolvedViaEmail,
    resolvedViaUsername,
    unregisteredRowsDropped: candidateRows.length - rows.length,
    unregisteredUsernames,
  };
}

// Main execution
const scriptDir = __dirname;
const inputFile = process.env.SURVEY_INPUT || path.join(scriptDir, 'raw-survey.csv');
const outputFile = process.env.SURVEY_OUTPUT || path.join(scriptDir, 'processed-survey.csv');
const groupOutputFile = process.env.SURVEY_GROUP_OUTPUT || path.join(scriptDir, 'group-surveys.csv');

const rosterFile = process.env[ROSTER_ENV_VAR];

const stats = processSurvey({
  inputPath: inputFile,
  outputPath: outputFile,
  groupOutputPath: groupOutputFile,
  rosterPath: rosterFile,
});

console.log(`Total rows in input: ${stats.totalRows}`);
console.log(`Removed ${stats.practiceRowsRemoved} Training/Test rows`);
console.log(`Moved ${stats.groupRowsSeparated} group-account rows to the group surveys file`);
console.log(`Processed ${stats.rowsProcessed} rows`);
console.log(`Resolved ${stats.resolvedViaEmail} rows via registration email`);
console.log(`Resolved ${stats.resolvedViaUsername} rows via typed username`);
console.log(`Dropped ${stats.unregisteredRowsDropped} rows from unregistered volunteers`);
for (const { username, count } of stats.unregisteredUsernames) {
  console.log(`  unregistered: ${username} (${count})`);
}
