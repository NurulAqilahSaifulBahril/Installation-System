// Dumps everything the dashboard owns in the shared database to a local JSON
// file. Run this before shipping a version that changes the schema — the tables
// live in someone else's database and there is no point-in-time restore.
//
//   npm run backup
//   npm run backup -- --out "D:/backups"
//
// Reads the same PG_PROXY_* settings the app uses, so a backup always targets
// whatever database the build is actually pointed at.

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

// Every table the dashboard creates and writes. Source tables (invoice,
// customer, …) are deliberately absent: the dashboard only reads those, and
// they belong to the upstream system that owns them.
const OWNED_TABLES = [
  'installation_ops_state',
  'installation_jobs',
  'job_team_assignments',
  'job_status_history',
  'app_users',
  'app_sessions',
  'app_audit_log',
];

function loadEnvFile() {
  const envPath = path.join(ROOT_DIR, '.env.local');
  if (!fs.existsSync(envPath)) {
    return;
  }

  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim().replace(/^\ufeff/, '');
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const eq = trimmed.indexOf('=');
    if (eq <= 0) {
      continue;
    }

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function readOutputDir() {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--out');
  if (flag >= 0 && args[flag + 1]) {
    return path.resolve(args[flag + 1]);
  }
  return path.join(ROOT_DIR, 'backups');
}

async function queryProxy(config, sql, params = []) {
  const response = await fetch(config.proxyUrl, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + config.token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ db_name: config.database, sql, params }),
    signal: AbortSignal.timeout(60_000),
  });

  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error || 'Proxy returned status ' + response.status + '.');
  }

  return payload.rows ?? [];
}

async function main() {
  loadEnvFile();

  const config = {
    proxyUrl: process.env.PG_PROXY_URL,
    database: process.env.PG_PROXY_DATABASE,
    token: process.env.PG_PROXY_TOKEN,
  };

  if (!config.proxyUrl || !config.database || !config.token) {
    throw new Error(
      'PG_PROXY_URL, PG_PROXY_DATABASE and PG_PROXY_TOKEN must be set in .env.local.',
    );
  }

  console.log('Backing up ' + config.database + ' via ' + config.proxyUrl);

  const existing = await queryProxy(
    config,
    [
      'select table_name from information_schema.tables',
      "where table_schema = 'public' and table_name = any($1::text[])",
    ].join('\n'),
    [OWNED_TABLES],
  );
  const present = new Set(existing.map((row) => row.table_name));

  const dump = {
    database: config.database,
    takenAt: new Date().toISOString(),
    tables: {},
  };

  for (const table of OWNED_TABLES) {
    if (!present.has(table)) {
      console.log('  ' + table + ': not created yet, skipped');
      dump.tables[table] = null;
      continue;
    }

    const rows = await queryProxy(config, 'select * from public.' + table);
    dump.tables[table] = rows;
    console.log('  ' + table + ': ' + rows.length + ' rows');
  }

  const outputDir = readOutputDir();
  fs.mkdirSync(outputDir, { recursive: true });
  const stamp = dump.takenAt.replace(/[:.]/g, '-');
  const outputPath = path.join(outputDir, config.database + '-' + stamp + '.json');
  fs.writeFileSync(outputPath, JSON.stringify(dump, null, 2), 'utf8');

  console.log('Saved ' + outputPath);
}

main().catch((error) => {
  console.error('\nBackup failed: ' + (error instanceof Error ? error.message : error));
  console.error(
    'Nothing was written. If the database is unreachable, retry once it is back up —\n' +
      'do not ship a schema change until a backup has succeeded.',
  );
  process.exit(1);
});
