/**
 * Data pipeline to process raw-survey.csv:
 * - Remove rows with "Training" username (case-insensitive)
 * - Move rows from shared group accounts (s<sep?><digits><letters> pattern,
 *   where sep may be '-', em-dash, or absent — e.g. s-328sb, s—328sb, S322ad)
 *   out of the leaderboard and into group-surveys.csv: they are real surveys
 *   from group activities, so they count toward the survey goal, but a shared
 *   account doesn't compete on the leaderboard
 * - Deduplicate users by email (case-insensitive)
 * - For rows with the same email, use the first username encountered
 * - Username comparisons are case-insensitive
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

const GROUP_ACCOUNT_PATTERN = /^s\W*\d+\w+$/i;
const EMAIL_COLUMN = 'Email address';

function isTrainingRow(row) {
  return (row['Username'] || '').trim().toLowerCase() === 'training';
}

function isGroupAccountRow(row) {
  return GROUP_ACCOUNT_PATTERN.test((row['Username'] || '').trim());
}

function processSurvey({ inputPath, outputPath, groupOutputPath }) {
  // Read and parse input
  const content = fs.readFileSync(inputPath, 'utf-8').replace(/^\uFEFF/, ''); // Remove BOM
  const { headers, rows: allRows } = parseCSV(content);

  const surveyRows = allRows.filter(row => !isTrainingRow(row));
  const trainingRowsRemoved = allRows.length - surveyRows.length;
  const groupRows = surveyRows.filter(isGroupAccountRow);
  const rows = surveyRows.filter(row => !isGroupAccountRow(row));

  // First pass: build email -> first username mapping
  const emailToUsername = new Map();

  for (const row of rows) {
    const email = (row['Email address'] || '').trim().toLowerCase();
    const username = (row['Username'] || '').trim();

    if (email && !emailToUsername.has(email)) {
      emailToUsername.set(email, username);
    }
  }

  // Second pass: apply normalized usernames
  let usernamesChanged = 0;

  for (const row of rows) {
    const email = (row['Email address'] || '').trim().toLowerCase();
    const originalUsername = row['Username'];

    if (email && emailToUsername.has(email)) {
      const normalizedUsername = emailToUsername.get(email);
      if (originalUsername.toLowerCase() !== normalizedUsername.toLowerCase()) {
        usernamesChanged++;
      }
      row['Username'] = normalizedUsername;
    }
  }

  // Write output — strip the Email address column so emails are never served publicly.
  const outputHeaders = headers.filter(h => h !== EMAIL_COLUMN);
  fs.writeFileSync(outputPath, toCSV(outputHeaders, rows), 'utf-8');
  fs.writeFileSync(groupOutputPath, toCSV(outputHeaders, groupRows), 'utf-8');

  return {
    totalRows: allRows.length,
    trainingRowsRemoved,
    groupRowsSeparated: groupRows.length,
    rowsProcessed: rows.length,
    uniqueEmails: emailToUsername.size,
    usernamesChanged,
  };
}

// Main execution
const scriptDir = __dirname;
const inputFile = process.env.SURVEY_INPUT || path.join(scriptDir, 'raw-survey.csv');
const outputFile = process.env.SURVEY_OUTPUT || path.join(scriptDir, 'processed-survey.csv');
const groupOutputFile = process.env.SURVEY_GROUP_OUTPUT || path.join(scriptDir, 'group-surveys.csv');

const stats = processSurvey({ inputPath: inputFile, outputPath: outputFile, groupOutputPath: groupOutputFile });

console.log(`Total rows in input: ${stats.totalRows}`);
console.log(`Removed ${stats.trainingRowsRemoved} Training rows`);
console.log(`Moved ${stats.groupRowsSeparated} group-account rows to the group surveys file`);
console.log(`Processed ${stats.rowsProcessed} rows`);
console.log(`Found ${stats.uniqueEmails} unique emails`);
console.log(`Changed ${stats.usernamesChanged} usernames to match first occurrence`);
