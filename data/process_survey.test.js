const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const assert = require('assert');

const scriptPath = path.join(__dirname, 'process_survey.js');
const inputPath = path.join(__dirname, 'test-input.csv');
const outputPath = path.join(__dirname, 'test-output.csv');
const groupOutputPath = path.join(__dirname, 'test-group-output.csv');
const rosterPath = path.join(__dirname, 'test-roster.csv');
const groupAccountsPath = path.join(__dirname, 'test-group-accounts.csv');
const aliasesPath = path.join(__dirname, 'test-aliases.csv');
const ROSTER_HEADER = 'Username,Email address';
const GROUP_ACCOUNTS_HEADER = 'Username';
const ALIASES_HEADER = 'Registered Username,Alternate Username,Email address';

const DEFAULT_ROSTER = [
  'Alice,alice@example.com',
  'Bob,bob@example.com',
  'Sal8,legit-s-name@example.com',
  'Testa,testa@example.com',
];

function pipelineEnv() {
  return {
    ...process.env,
    SURVEY_INPUT: inputPath,
    SURVEY_OUTPUT: outputPath,
    SURVEY_GROUP_OUTPUT: groupOutputPath,
    ROSTER_INPUT: rosterPath,
    GROUP_ACCOUNTS_INPUT: groupAccountsPath,
    ALIASES_INPUT: aliasesPath,
  };
}

function runPipeline(csvContent, rosterRows = DEFAULT_ROSTER, groupAccountRows = [], aliasRows = []) {
  fs.writeFileSync(inputPath, csvContent, 'utf-8');
  fs.writeFileSync(rosterPath, [ROSTER_HEADER, ...rosterRows].join('\n'), 'utf-8');
  fs.writeFileSync(groupAccountsPath, [GROUP_ACCOUNTS_HEADER, ...groupAccountRows].join('\n'), 'utf-8');
  fs.writeFileSync(aliasesPath, [ALIASES_HEADER, ...aliasRows].join('\n'), 'utf-8');
  execSync(`node ${scriptPath}`, { env: pipelineEnv() });
  return fs.readFileSync(outputPath, 'utf-8');
}

function outputUsernames(output) {
  return output.trim().split('\n').slice(1).map(line => line.split(',')[0]);
}

function cleanup() {
  for (const f of [inputPath, outputPath, groupOutputPath, rosterPath, groupAccountsPath, aliasesPath]) {
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
    'S516-ng,latedash@example.com,Greenfield,1700000000000',
    'Sal8,legit-s-name@example.com,Shadyside,1700000000000',
  ].join('\n');

  const output = runPipeline(input);
  const lines = output.trim().split('\n');
  const dataLines = lines.slice(1); // skip header

  const usernames = dataLines.map(line => line.split(',')[0]);

  assert.strictEqual(dataLines.length, 3, `Expected 3 rows, got ${dataLines.length}`);
  assert.ok(usernames.includes('Alice'), 'Alice should be present');
  assert.ok(usernames.includes('Bob'), 'Bob should be present');
  assert.ok(usernames.includes('Sal8'), 'Sal8 (legit username starting with S) should be present');
  assert.ok(!usernames.some(u => u.toLowerCase().includes('328')), 'No s-ID variants should be present');
  assert.ok(!usernames.some(u => u.toLowerCase().includes('322')), 'No s-ID variants should be present');
  assert.ok(!usernames.some(u => u.toLowerCase().includes('516')), 'Dash after the digits is still an s-ID');
  assert.ok(!usernames.some(u => u.toLowerCase().startsWith('s-')), 'No hyphen s-IDs should be present');

  console.log('PASS: s-ID usernames (all variants) are filtered out');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}

// Test: shared group-account (s-ID) surveys are kept in their own file so they
// count toward the survey goal without appearing on the leaderboard
try {
  const input = [
    'Username,Email address,Neighborhood,CreationDate',
    's-411sb,crew@example.com,Shadyside,1700000000001',
    'Alice,alice@example.com,Squirrel Hill,1700000000002',
    'S\u2014822ng,crew2@example.com,Oakland,1700000000003',
    'Training,trainer@example.com,Oakland,1700000000004',
  ].join('\n');

  runPipeline(input);
  const groupLines = fs.readFileSync(groupOutputPath, 'utf-8').trim().split('\n');

  assert.strictEqual(groupLines[0], 'Username,Neighborhood,CreationDate', 'emails must not be served publicly');
  assert.deepStrictEqual(
    groupLines.slice(1).map(line => line.split(',')[0]),
    ['s-411sb', 'S\u2014822ng'],
    'only s-ID rows belong in the group file (not Training, not players)'
  );

  console.log('PASS: s-ID surveys are written to the group-surveys file');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}

// Test: "Test" account surveys are dropped from both outputs, like Training
try {
  const input = [
    'Username,Email address,Neighborhood,CreationDate',
    'Test,tester@example.com,Oakland,1700000000001',
    'TEST,tester2@example.com,Oakland,1700000000002',
    'Alice,alice@example.com,Squirrel Hill,1700000000003',
    'Testa,testa@example.com,Shadyside,1700000000004',
  ].join('\n');

  const output = runPipeline(input);
  const usernames = output.trim().split('\n').slice(1).map(line => line.split(',')[0]);
  const groupLines = fs.readFileSync(groupOutputPath, 'utf-8').trim().split('\n');

  assert.deepStrictEqual(usernames, ['Alice', 'Testa'], 'Test rows removed; names merely starting with "Test" kept');
  assert.strictEqual(groupLines.length, 1, 'Test rows must not land in the group file either');

  console.log('PASS: Test-account surveys are excluded');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}

// Test: any username marked as a training walk is dropped, not just "Training"
try {
  const input = [
    'Username,Email address,Neighborhood,CreationDate',
    'Mindy - training walk,mindy@example.com,Oakland,1700000000001',
    'Alice,alice@example.com,Squirrel Hill,1700000000002',
  ].join('\n');

  const output = runPipeline(input);
  const usernames = output.trim().split('\n').slice(1).map(line => line.split(',')[0]);

  assert.deepStrictEqual(usernames, ['Alice'], 'training-walk rows removed');

  console.log('PASS: training-walk usernames are excluded');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}

// Test: a typo'd username from a registered email is credited to the roster username
try {
  const input = [
    'Username,Email address,Neighborhood,CreationDate',
    'ajn5,andrew@example.com,Oakland,1700000000001',
    'Anawn5,Andrew@Example.com ,Oakland,1700000000002',
  ].join('\n');

  const output = runPipeline(input, ['ANaw5,andrew@example.com']);

  assert.deepStrictEqual(outputUsernames(output), ['ANaw5', 'ANaw5'], 'both typos credited to the roster username');
  assert.ok(!output.includes('andrew@example.com'.toLowerCase()), 'emails must not be written');

  console.log('PASS: typo usernames resolve to the roster username via email');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}

// Test: a typed username matches the roster case-insensitively even from an unknown email
try {
  const input = [
    'Username,Email address,Neighborhood,CreationDate',
    ' anaw5 ,other@example.com,Oakland,1700000000001',
  ].join('\n');

  const output = runPipeline(input, ['ANaw5,andrew@example.com']);

  assert.deepStrictEqual(outputUsernames(output), ['ANaw5'], 'roster spelling is used');

  console.log('PASS: username fallback matches roster case-insensitively');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}

// Test: email match takes precedence over username match
try {
  const input = [
    'Username,Email address,Neighborhood,CreationDate',
    'Bob,alice@example.com,Oakland,1700000000001',
  ].join('\n');

  const output = runPipeline(input);

  assert.deepStrictEqual(outputUsernames(output), ['Alice'], 'email owner wins over the typed username');

  console.log('PASS: email match beats username match');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}

// Test: rows matching neither email nor username are dropped from both outputs
try {
  const input = [
    'Username,Email address,Neighborhood,CreationDate',
    'Stranger,stranger@example.com,Oakland,1700000000001',
    'Alice,alice@example.com,Squirrel Hill,1700000000002',
  ].join('\n');

  const output = runPipeline(input);
  const groupLines = fs.readFileSync(groupOutputPath, 'utf-8').trim().split('\n');

  assert.deepStrictEqual(outputUsernames(output), ['Alice'], 'unregistered row dropped from leaderboard');
  assert.strictEqual(groupLines.length, 1, 'unregistered row must not land in the group file');
  assert.ok(!output.includes('Stranger'), 'unregistered username must not appear');

  console.log('PASS: unregistered rows are dropped');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}

// Test: first roster occurrence wins for duplicate emails/usernames; blank usernames are skipped
try {
  const input = [
    'Username,Email address,Neighborhood,CreationDate',
    'x,dup@example.com,Oakland,1700000000001',
    'second,other@example.com,Oakland,1700000000002',
    'ghost,blank@example.com,Oakland,1700000000003',
  ].join('\n');

  const output = runPipeline(input, [
    'First,dup@example.com',
    'Second,DUP@example.com',
    'second,',
    ',blank@example.com',
  ]);

  assert.deepStrictEqual(outputUsernames(output), ['First', 'Second'], 'first occurrence wins; blank-username row ignored');

  console.log('PASS: roster duplicates and blanks are handled');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}

// Test: group-account rows still reach the group file even when not on the roster
try {
  const input = [
    'Username,Email address,Neighborhood,CreationDate',
    's-411sb,crew@example.com,Shadyside,1700000000001',
  ].join('\n');

  runPipeline(input, ['Alice,alice@example.com']);
  const groupLines = fs.readFileSync(groupOutputPath, 'utf-8').trim().split('\n');

  assert.deepStrictEqual(groupLines.slice(1).map(line => line.split(',')[0]), ['s-411sb']);

  console.log('PASS: group rows bypass the roster filter');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}

// Test: without ROSTER_INPUT the script fails rather than publishing an unfiltered board
try {
  fs.writeFileSync(inputPath, 'Username,Email address,Neighborhood,CreationDate\nAlice,alice@example.com,Oakland,1', 'utf-8');
  const env = pipelineEnv();
  delete env.ROSTER_INPUT;

  assert.throws(
    () => execSync(`node ${scriptPath}`, { env, stdio: 'pipe' }),
    err => err.status !== 0 && /ROSTER_INPUT/.test(String(err.stderr)),
    'script must exit non-zero and name ROSTER_INPUT'
  );

  console.log('PASS: missing ROSTER_INPUT fails the build');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}

// Test: a listed group username that doesn't fit the s-pattern goes to the group
// file, even if it is also on the roster or typed with a registered volunteer's email
try {
  const input = [
    'Username,Email address,Neighborhood,CreationDate',
    'ccac1,leader@example.com,Oakland,1700000000001',
    'ccac1,alice@example.com,Oakland,1700000000002',
    'Alice,alice@example.com,Squirrel Hill,1700000000003',
  ].join('\n');

  const output = runPipeline(input, [...DEFAULT_ROSTER, 'CCAC1,ccac1@example.com'], ['CCAC1']);
  const groupLines = fs.readFileSync(groupOutputPath, 'utf-8').trim().split('\n');

  assert.deepStrictEqual(outputUsernames(output), ['Alice'], 'listed group username stays off the leaderboard');
  assert.deepStrictEqual(
    groupLines.slice(1).map(line => line.split(',')[0]),
    ['ccac1', 'ccac1'],
    'listed group rows keep the username as typed'
  );

  console.log('PASS: listed non-pattern group usernames go to the group file');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}

// Test: an unlisted s-pattern username is still a group account
try {
  const input = [
    'Username,Email address,Neighborhood,CreationDate',
    's-999zz,crew@example.com,Oakland,1700000000001',
  ].join('\n');

  const output = runPipeline(input, DEFAULT_ROSTER, ['CCAC1']);
  const groupLines = fs.readFileSync(groupOutputPath, 'utf-8').trim().split('\n');

  assert.deepStrictEqual(outputUsernames(output), [], 'not on the leaderboard');
  assert.deepStrictEqual(groupLines.slice(1).map(line => line.split(',')[0]), ['s-999zz']);

  console.log('PASS: unlisted s-pattern usernames remain group accounts');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}

// Test: without GROUP_ACCOUNTS_INPUT the script fails rather than mis-sorting group surveys
try {
  fs.writeFileSync(inputPath, 'Username,Email address,Neighborhood,CreationDate\nAlice,alice@example.com,Oakland,1', 'utf-8');
  fs.writeFileSync(rosterPath, ROSTER_HEADER, 'utf-8');
  fs.writeFileSync(aliasesPath, ALIASES_HEADER, 'utf-8');
  const env = pipelineEnv();
  delete env.GROUP_ACCOUNTS_INPUT;

  assert.throws(
    () => execSync(`node ${scriptPath}`, { env, stdio: 'pipe' }),
    err => err.status !== 0 && /GROUP_ACCOUNTS_INPUT/.test(String(err.stderr)),
    'script must exit non-zero and name GROUP_ACCOUNTS_INPUT'
  );

  console.log('PASS: missing GROUP_ACCOUNTS_INPUT fails the build');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}

// Test: an alternate username typed from an unregistered email is credited to the registered spelling
try {
  const input = [
    'Username,Email address,Neighborhood,CreationDate',
    'Zel2,other@example.com,Oakland,1700000000001',
  ].join('\n');

  const output = runPipeline(input, ['zell2,zell2@example.com'], [], ['zell2,Zel2,']);

  assert.deepStrictEqual(outputUsernames(output), ['zell2'], 'credited to the roster spelling');

  console.log('PASS: alternate username resolves to the registered username');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}

// Test: an alternate email credits the registered username whatever name was typed
try {
  const input = [
    'Username,Email address,Neighborhood,CreationDate',
    'Whatever,Second@Example.com ,Oakland,1700000000001',
  ].join('\n');

  const output = runPipeline(input, ['zell2,zell2@example.com'], [], ['ZELL2,,second@example.com']);

  assert.deepStrictEqual(outputUsernames(output), ['zell2'], 'registered name matched case-insensitively');

  console.log('PASS: alternate email resolves to the registered username');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}

// Test: an alias for a username that is not on the roster cannot admit anyone
try {
  const input = [
    'Username,Email address,Neighborhood,CreationDate',
    'Ghosty,ghost2@example.com,Oakland,1700000000001',
    'Ghost,ghost@example.com,Oakland,1700000000002',
  ].join('\n');

  const output = runPipeline(input, DEFAULT_ROSTER, [], ['Ghost,Ghosty,ghost2@example.com']);

  assert.deepStrictEqual(outputUsernames(output), [], 'unregistered rows stay dropped');

  console.log('PASS: aliases for unregistered usernames are ignored');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}

// Test: an alias can't take over an email or username that belongs to a registered volunteer
try {
  const input = [
    'Username,Email address,Neighborhood,CreationDate',
    'Whoever,bob@example.com,Oakland,1700000000001',
    'Bob,unknown@example.com,Oakland,1700000000002',
  ].join('\n');

  const output = runPipeline(input, DEFAULT_ROSTER, [], ['Alice,Bob,bob@example.com']);

  assert.deepStrictEqual(outputUsernames(output), ['Bob', 'Bob'], 'registration spellings and emails always win');

  console.log('PASS: aliases cannot hijack registered emails or usernames');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}

// Test: among aliases the first occurrence of an email or username wins
try {
  const input = [
    'Username,Email address,Neighborhood,CreationDate',
    'Nick,x@example.com,Oakland,1700000000001',
    'Other,nick@example.com,Oakland,1700000000002',
  ].join('\n');

  const output = runPipeline(input, DEFAULT_ROSTER, [], [
    'Alice,Nick,x@example.com',
    'Bob,Nick,nick@example.com',
  ]);

  assert.deepStrictEqual(outputUsernames(output), ['Alice', 'Bob'], 'first alias keeps Nick and x@; second alias adds only its new email');

  console.log('PASS: first alias occurrence wins');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}

// Test: without ALIASES_INPUT the script fails rather than silently dropping alternate logins
try {
  fs.writeFileSync(inputPath, 'Username,Email address,Neighborhood,CreationDate\nAlice,alice@example.com,Oakland,1', 'utf-8');
  fs.writeFileSync(rosterPath, ROSTER_HEADER, 'utf-8');
  fs.writeFileSync(groupAccountsPath, GROUP_ACCOUNTS_HEADER, 'utf-8');
  const env = pipelineEnv();
  delete env.ALIASES_INPUT;

  assert.throws(
    () => execSync(`node ${scriptPath}`, { env, stdio: 'pipe' }),
    err => err.status !== 0 && /ALIASES_INPUT/.test(String(err.stderr)),
    'script must exit non-zero and name ALIASES_INPUT'
  );

  console.log('PASS: missing ALIASES_INPUT fails the build');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  cleanup();
}
