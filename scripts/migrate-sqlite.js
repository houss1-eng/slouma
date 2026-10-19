// Copie l'ancienne base SQLite (data/barber.db) dans PostgreSQL : comptes, RDV, services, réglages…
// + les photos (data/uploads) et les clés des notifications (data/vapid.json, les téléphones restent abonnés).
// À lancer une seule fois, depuis le PC, avec DATABASE_URL dans .env :
//   npm run migrate              (refuse si la base PostgreSQL contient déjà des comptes)
//   npm run migrate -- --force   (vide d'abord la base PostgreSQL, puis copie)
// Dossier des anciennes données ailleurs : npm run migrate -- chemin/vers/data
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { db, init } = require('../db');

const args = process.argv.slice(2);
const force = args.includes('--force');
const DATA = args.find(a => !a.startsWith('--')) || path.join(__dirname, '..', 'data');

// dans l'ordre des dépendances (un RDV a besoin de son client, de son service…)
const TABLES = ['users', 'sessions', 'hours', 'absences', 'services', 'styles', 'bookings', 'waitlist', 'notifications', 'push_subs', 'offers', 'settings'];
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

(async () => {
  const sq = new Database(path.join(DATA, 'barber.db'), { readonly: true, fileMustExist: true });
  await init(); // crée les tables (et les comptes de départ si la base est vide)
  const real = await db.get("SELECT COUNT(*) n FROM users WHERE phone NOT IN ('20000000','20000002','20000003')");
  if (real.n && !force) throw new Error('La base PostgreSQL contient déjà des comptes. Relancez avec --force pour la vider et tout recopier.');
  await db.exec(`TRUNCATE ${[...TABLES, 'files'].join(',')} RESTART IDENTITY CASCADE`);

  for (const t of TABLES) {
    const pgCols = (await db.all('SELECT column_name FROM information_schema.columns WHERE table_name=?', t)).map(c => c.column_name);
    const rows = sq.prepare(`SELECT * FROM ${t}`).all();
    for (const r of rows) {
      const cols = Object.keys(r).filter(c => pgCols.includes(c));
      await db.run(`INSERT INTO ${t}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, ...cols.map(c => r[c]));
    }
    // les prochains ids continuent après les anciens
    if (pgCols.includes('id')) await db.exec(`SELECT setval(pg_get_serial_sequence('${t}','id'), GREATEST((SELECT MAX(id) FROM ${t}), 1), (SELECT MAX(id) FROM ${t}) IS NOT NULL)`);
    console.log(`${t.padEnd(14)} ${rows.length}`);
  }
  sq.close();

  const up = path.join(DATA, 'uploads');
  const files = fs.existsSync(up) ? fs.readdirSync(up).filter(f => MIME[path.extname(f).slice(1).toLowerCase()]) : [];
  for (const f of files) await db.run('INSERT INTO files(name,mime,data) VALUES(?,?,?) ON CONFLICT DO NOTHING', f, MIME[path.extname(f).slice(1).toLowerCase()], fs.readFileSync(path.join(up, f)));
  console.log(`${'photos'.padEnd(14)} ${files.length}`);

  const vapid = path.join(DATA, 'vapid.json');
  if (fs.existsSync(vapid)) {
    await db.run('INSERT INTO app_keys(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value', 'vapid', fs.readFileSync(vapid, 'utf8'));
    console.log('clés push      reprises');
  }
  console.log('\n✅ Données copiées dans PostgreSQL.');
})().catch(e => { console.error('❌', e.message); process.exitCode = 1; }).finally(() => db.pool.end());
