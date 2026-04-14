/**
 * Data pipeline to process raw-survey.csv:
 * - Remove rows with "Training" username (case-insensitive)
 * - Remove rows with system-generated usernames (s<sep?><digits><letters>
 *   pattern, where sep may be '-', em-dash, or absent — e.g. s-328sb, s—328sb, S322ad)
 * - Deduplicate users by email (case-insensitive)
 * - For rows with the same email, use the first username encountered
 * - Username comparisons are case-insensitive
 * - Output cleaned data to processed-survey.csv
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

function processSurvey(inputPath, outputPath) {
  // Read and parse input
  const content = fs.readFileSync(inputPath, 'utf-8').replace(/^\uFEFF/, ''); // Remove BOM
  const { headers, rows: allRows } = parseCSV(content);

  // Filter out rows with "Training" username (case-insensitive)
  // and rows with system-generated usernames: start with 's', optional non-word
  // separator (hyphen, em-dash, or none), then digits, then word chars.
  const rows = allRows.filter(row => {
    const username = (row['Username'] || '').trim();
    if (username.toLowerCase() === 'training') return false;
    if (/^s\W*\d+\w+$/i.test(username)) return false;
    return true;
  });
  const trainingRowsRemoved = allRows.length - rows.length;

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
  const outputHeaders = headers.filter(h => h !== 'Email address');
  const output = toCSV(outputHeaders, rows);
  fs.writeFileSync(outputPath, output, 'utf-8');

  return {
    totalRows: allRows.length,
    trainingRowsRemoved,
    rowsProcessed: rows.length,
    uniqueEmails: emailToUsername.size,
    usernamesChanged,
  };
}

// Main execution
const scriptDir = __dirname;
const inputFile = process.env.SURVEY_INPUT || path.join(scriptDir, 'raw-survey.csv');
const outputFile = process.env.SURVEY_OUTPUT || path.join(scriptDir, 'processed-survey.csv');

const stats = processSurvey(inputFile, outputFile);

console.log(`Total rows in input: ${stats.totalRows}`);
console.log(`Removed ${stats.trainingRowsRemoved} filtered rows (Training + system-generated)`);
console.log(`Processed ${stats.rowsProcessed} rows`);
console.log(`Found ${stats.uniqueEmails} unique emails`);
console.log(`Changed ${stats.usernamesChanged} usernames to match first occurrence`);
