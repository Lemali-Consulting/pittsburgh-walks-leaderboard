const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const scriptPath = path.join(__dirname, 'process_survey.js');
const inputPath = path.join(__dirname, 'test-input.csv');
const outputPath = path.join(__dirname, 'test-output.csv');

function runPipeline(csvContent) {
  fs.writeFileSync(inputPath, csvContent, 'utf-8');
  execSync(`node ${scriptPath}`, {
    env: {
      ...process.env,
      SURVEY_INPUT: inputPath,
      SURVEY_OUTPUT: outputPath,
    },
  });
  return fs.readFileSync(outputPath, 'utf-8');
}

function cleanup() {
  for (const f of [inputPath, outputPath]) {
    try { fs.unlinkSync(f); } catch {}
  }
}

// Test: system-generated s-ID usernames are filtered out, including dash variants
try {
  const input = [
    'Username,Email address,Neighborhood,CreationDate',
    's-12345abc,bot@example.com,Shadyside,1700000000000',
    'Alice,alice@example.com,Squirrel Hill,1700000000000',
    's-99z,spam@example.com,Oakland,1700000000000',
    'Bob,bob@example.com,Lawrenceville,1700000000000',
    's\u2014328sb,emdash@example.com,Hill District,1700000000000',
    'S322ad,nodash@example.com,Greenfield,1700000000000',
    'S-328SB,upper@example.com,North Oakland,1700000000000',
    'Sal8,legit-s-name@example.com,Shadyside,1700000000000',
  ].join('\n');

  const output = runPipeline(input);
  const lines = output.trim().split('\n');
  const dataLines = lines.slice(1); // skip header

  const usernames = dataLines.map(line => line.split(',')[0]);

  console.assert(dataLines.length === 3, `Expected 3 rows, got ${dataLines.length}`);
  console.assert(usernames.includes('Alice'), 'Alice should be present');
  console.assert(usernames.includes('Bob'), 'Bob should be present');
  console.assert(usernames.includes('Sal8'), 'Sal8 (legit username starting with S) should be present');
  console.assert(!usernames.some(u => u.toLowerCase().includes('328')), 'No s-ID variants should be present');
  console.assert(!usernames.some(u => u.toLowerCase().includes('322')), 'No s-ID variants should be present');
  console.assert(!usernames.some(u => u.toLowerCase().startsWith('s-')), 'No hyphen s-IDs should be present');

  console.log('PASS: s-ID usernames (all variants) are filtered out');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}
