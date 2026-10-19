// Base de données PostgreSQL (Neon ou autre), créée et remplie au premier démarrage.
// Configuration : DATABASE_URL (obligatoire), dans les variables d'environnement ou dans le fichier .env.
// Tout est dans la base, y compris les photos : le serveur n'a besoin d'aucun disque (Render…).
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');
const bcrypt = require('bcryptjs');

// .env : KEY=valeur par ligne (les variables déjà définies gardent la priorité)
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL manquant : ajoutez la chaîne de connexion PostgreSQL (Neon) dans le fichier .env (voir .env.example)');
  process.exit(1);
}
// COUNT et SUM renvoient des bigint / numeric : on les veut en nombres JavaScript
types.setTypeParser(20, Number);
types.setTypeParser(1700, Number);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
pool.on('error', e => console.warn('[pg]', e.message));

// requêtes avec des « ? » comme avant (convertis en $1, $2…)
const sql = s => { let i = 0; return s.replace(/\?/g, () => '$' + ++i); };
const db = {
  pool,
  all: async (s, ...p) => (await pool.query(sql(s), p)).rows,
  get: async (s, ...p) => (await pool.query(sql(s), p)).rows[0],
  run: (s, ...p) => pool.query(sql(s), p), // → { rowCount, rows } (rows avec RETURNING)
  exec: s => pool.query(s),
  // fn s'exécute seule : verrou partagé par tous les serveurs (deux clients ne prennent pas le même créneau).
  // File d'attente locale d'abord : une seule connexion attend le verrou, les autres restent libres pour fn
  exclusive(fn) {
    const p = queue.then(() => locked(fn));
    queue = p.catch(() => { });
    return p;
  },
};
let queue = Promise.resolve();
async function locked(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(7)');
    const out = await fn();
    await c.query('COMMIT');
    return out;
  } catch (e) { await c.query('ROLLBACK').catch(() => { }); throw e; }
  finally { c.release(); }
}

// date et heure locales du salon, même format qu'avant : « 2026-10-15 14:30:00 »
const NOW = `to_char(now() AT TIME ZONE '${(process.env.TZ || 'Africa/Tunis').replace(/'/g, '')}', 'YYYY-MM-DD HH24:MI:SS')`;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'client' CHECK(role IN ('client','barber','admin')),
  active INTEGER NOT NULL DEFAULT 1,
  points INTEGER NOT NULL DEFAULT 0,
  photo TEXT,                         -- portfolio : photo de profil et courte présentation de chaque barbier
  bio TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
-- horaires de travail de chaque barbier : un jour absent = jour de repos ; pause quotidienne facultative
CREATE TABLE IF NOT EXISTS hours(
  barber_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  break_start INTEGER,
  break_end INTEGER,
  PRIMARY KEY(barber_id, weekday)
);
-- absences ponctuelles (congé, rendez-vous…)
CREATE TABLE IF NOT EXISTS absences(
  id SERIAL PRIMARY KEY,
  barber_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS services(
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  duration INTEGER NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  loyalty INTEGER NOT NULL DEFAULT 0  -- compte pour la carte fidélité (gagne un point, peut être à prix réduit)
);
-- galerie : photos des coupes / styles
CREATE TABLE IF NOT EXISTS styles(
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  file TEXT NOT NULL,
  barber_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS bookings(
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  barber_id INTEGER NOT NULL REFERENCES users(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  style_id INTEGER REFERENCES styles(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  full_price DOUBLE PRECISION NOT NULL,
  loyalty INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'booked' CHECK(status IN ('booked','done','cancelled','no_show')),
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  items JSONB NOT NULL DEFAULT '[]', -- détail des services : [{id,name,price,duration,loyalty}]
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS bookings_day ON bookings(barber_id, date);
CREATE INDEX IF NOT EXISTS bookings_client ON bookings(client_id);
-- liste d'attente : le client est prévenu quand un créneau se libère ce jour-là
CREATE TABLE IF NOT EXISTS waitlist(
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  barber_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS notifications(
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, id);
CREATE TABLE IF NOT EXISTS push_subs(
  endpoint TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  keys JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- offres / promos publiées par l'admin (tous les clients sont prévenus)
CREATE TABLE IF NOT EXISTS offers(
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  ends_on TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
-- photos envoyées (galerie, profils) : dans la base, pas sur le disque du serveur
CREATE TABLE IF NOT EXISTS files(
  name TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data BYTEA NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
-- clés internes du serveur (notifications push), jamais envoyées au site
CREATE TABLE IF NOT EXISTS app_keys(name TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

// Tarifs du salon : [nom, durée (min), prix (DT), compte pour la fidélité]
const CATALOG = [
  ['Coupe cheveux', 30, 8, 1],
  ['Barbe', 15, 5, 0],
  ['Brushing', 15, 7, 0],
  ['Shampooing', 15, 2, 0],
  ['Coupe enfants', 30, 7, 1],
  ['Masque', 15, 7, 0],
  ['Gommage', 15, 3, 0],
  ['Cire visage', 15, 7, 0],
  ['Soin visage mini', 30, 35, 0],
  ['Soin visage complet', 60, 45, 0],
  ['Protéine', 90, 80, 0],
  ['Pack Mariage', 120, 200, 0],
];

// ===== Réglages par défaut (modifiables par l'admin dans l'application) =====
const DEFAULTS = {
  shop_name: 'Elegance Barber Shop',
  shop_phone: '',
  shop_address: '',
  closed_days: '1',       // jours de repos du salon : 0=dimanche 1=lundi … 6=samedi (séparés par des virgules)
  cancel_hours: '2',      // annulation / modification possible jusqu'à 2 h avant
  booking_days: '14',     // réservation possible sur les 14 prochains jours
  reminder_minutes: '60', // rappel 1 h avant le rendez-vous
  loyalty_every: '4',     // après 4 coupes…
  loyalty_discount: '50', // …la suivante est à -50 %
};

// réglages gardés en mémoire : lus au démarrage, mis à jour par saveSettings
const settings = { ...DEFAULTS };
const getSettings = () => ({ ...settings });
async function saveSettings(values) {
  await db.exclusive(async () => {
    for (const [k, v] of Object.entries(values)) await db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v));
  });
  Object.assign(settings, values);
}

async function init() {
  // un seul serveur crée les tables à la fois
  await db.exclusive(async () => {
    await db.exec(SCHEMA);
    for (const [k, v] of Object.entries(DEFAULTS)) await db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT DO NOTHING', k, v);

    // ===== Premier démarrage : Salim (admin) + Mahmoud et Houssem (barbiers) + services =====
    if (await db.get('SELECT 1 FROM users LIMIT 1')) return;
    const team = [
      ['Salim', '20000000', 'admin123', 'admin'],
      ['Mahmoud', '20000001', 'barber123', 'barber'],
      ['Houssem', '20000002', 'barber123', 'barber'],
    ];
    for (const [name, phone, pass, role] of team) {
      const { id } = (await db.run('INSERT INTO users(name,phone,password_hash,role) VALUES(?,?,?,?) RETURNING id', name, phone, bcrypt.hashSync(pass, 10), role)).rows[0];
      // mardi → dimanche, 9h-20h ; fermé le lundi (1)
      for (const wd of [0, 2, 3, 4, 5, 6]) await db.run('INSERT INTO hours(barber_id,weekday,start_min,end_min) VALUES(?,?,?,?)', id, wd, 9 * 60, 20 * 60);
    }
    if (!await db.get('SELECT 1 FROM services LIMIT 1')) for (const row of CATALOG) await db.run('INSERT INTO services(name,duration,price,loyalty) VALUES(?,?,?,?)', ...row);
    console.log('\n✅ Base créée. Comptes de départ (à changer dans l\'application) :');
    console.log('   Salim (admin)     : 20000000 / admin123');
    console.log('   Mahmoud (barbier) : 20000001 / barber123');
    console.log('   Houssem (barbier) : 20000002 / barber123\n');
  });
  for (const r of await db.all('SELECT key,value FROM settings')) settings[r.key] = r.value;
}

module.exports = { db, init, getSettings, saveSettings };
