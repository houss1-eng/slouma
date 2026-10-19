// Serveur de l'application : API + fichiers du site (dossier public/).
// Démarrage : npm start  →  http://localhost:3000
process.env.TZ = process.env.TZ || 'Africa/Tunis'; // toutes les heures sont celles du salon

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const webpush = require('web-push');
const { db, init, getSettings, saveSettings } = require('./db');

const PORT = process.env.PORT || 3000;
const STEP = 15; // les créneaux commencent toutes les 15 minutes
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '6mb' }));

// ===== Outils date / heure =====
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
const addDays = (date, n) => { const d = new Date(date + 'T12:00'); d.setDate(d.getDate() + n); return ymd(d); };
const weekday = date => new Date(date + 'T12:00').getDay();
const startMs = (date, min) => new Date(`${date}T${hhmm(min)}`).getTime();
const now = () => { const d = new Date(); return { date: ymd(d), min: d.getHours() * 60 + d.getMinutes(), ms: d.getTime() }; };
const fdate = date => new Date(date + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const when = (date, min) => `${fdate(date)} à ${hhmm(min)}`;
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(new Date(s + 'T12:00'));
const round2 = x => Math.round(x * 100) / 100;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (msg, status = 400) => { throw new HttpError(status, msg); };
// enveloppe les routes : renvoie { error } lisible au lieu de planter
const h = fn => async (req, res) => {
  try { const out = await fn(req, res); if (!res.headersSent) res.json(out ?? { ok: true }); }
  catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    res.status(e.status || 500).json({ error: e instanceof HttpError ? e.message : 'Erreur serveur' });
  }
};
const int = v => { const n = Number(v); return Number.isInteger(n) ? n : null; };
const cleanPhone = p => String(p || '').replace(/[^\d+]/g, '');

// ===== Notifications (dans l'application + push sur le téléphone) =====
// clés VAPID : variables d'environnement, sinon créées au premier démarrage et gardées dans la base
let VAPID;
async function loadVapid() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) VAPID = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  else {
    await db.run('INSERT INTO app_keys(name,value) VALUES(?,?) ON CONFLICT DO NOTHING', 'vapid', JSON.stringify(webpush.generateVAPIDKeys()));
    VAPID = JSON.parse((await db.get("SELECT value FROM app_keys WHERE name='vapid'")).value);
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:contact@example.com', VAPID.publicKey, VAPID.privateKey);
}

async function notify(userId, message) {
  const shop = getSettings().shop_name;
  const { id } = (await db.run('INSERT INTO notifications(user_id,message) VALUES(?,?) RETURNING id', userId, message)).rows[0];
  const subs = await db.all('SELECT * FROM push_subs WHERE user_id=?', userId);
  const payload = JSON.stringify({ title: shop, body: message, tag: 'n' + id, url: '/' });
  for (const s of subs) {
    webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload).then(() => console.log(`[push] envoyée à l'utilisateur #${userId}`)).catch(e => {
      // abonnement expiré (application désinstallée, permission retirée…)
      if (e.statusCode === 404 || e.statusCode === 410) db.run('DELETE FROM push_subs WHERE endpoint=?', s.endpoint).catch(() => { });
      else console.warn('push', e.statusCode || '', e.message);
    });
  }
}
const staffIds = async () => (await db.all("SELECT id FROM users WHERE role='admin' AND active=1")).map(r => r.id);
// prévient le barbier concerné, et l'admin s'il s'agit d'un autre barbier
async function notifyStaff(barberId, message) {
  for (const id of new Set([barberId, ...await staffIds()])) await notify(id, message);
}

// ===== Sessions =====
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
async function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.run('INSERT INTO sessions(token,user_id) VALUES(?,?)', token, userId);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 86400}${req.secure ? '; Secure' : ''}`);
}
app.use(async (req, res, next) => {
  if (!req.path.startsWith('/api/')) return next(); // fichiers du site : pas besoin de la session
  try {
    const sid = parseCookies(req).sid;
    req.user = sid ? await db.get('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND u.active=1', sid) : null;
    req.sid = sid;
    next();
  } catch (e) { next(e); }
});
const auth = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Connectez-vous' });
const staff = (req, res, next) => req.user && req.user.role !== 'client' ? next() : res.status(403).json({ error: 'Réservé aux barbiers' });
const admin = (req, res, next) => req.user && req.user.role === 'admin' ? next() : res.status(403).json({ error: "Réservé à l'admin" });
const publicUser = u => ({ id: u.id, name: u.name, phone: u.phone, role: u.role, points: u.points });

// ===== Disponibilités =====
const getBarber = id => db.get("SELECT * FROM users WHERE id=? AND role IN ('barber','admin') AND active=1", id);
const getService = id => db.get('SELECT * FROM services WHERE id=? AND active=1', id);
// services choisis par le client (un ou plusieurs, ex : Coupe + Barbe)
async function pickServices(ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : String(ids ?? '').split(',')).map(int).filter(Boolean))];
  if (!list.length) fail('Choisissez au moins un service');
  if (list.length > 6) fail('6 services maximum par réservation');
  const out = [];
  for (const id of list) out.push(await getService(id) || fail('Service introuvable', 404));
  return out;
}
const itemsOf = b => b.items || [];
// « Coupe cheveux + Barbe » : nom affiché d'une réservation
const withLabel = b => ({ ...b, service: itemsOf(b).map(x => x.name).join(' + ') || b.service });

// tous les créneaux d'un barbier pour un jour et une durée ; free=false si déjà pris
const closedDays = () => (getSettings().closed_days || '').split(',').filter(x => x !== '').map(Number);
async function daySlots(barberId, date, duration, ignoreBookingId = 0) {
  if (closedDays().includes(weekday(date))) return { closed: true, slots: [] }; // repos hebdomadaire du salon
  const hrs = await db.get('SELECT * FROM hours WHERE barber_id=? AND weekday=?', barberId, weekday(date));
  if (!hrs) return { closed: true, slots: [] };
  const brk = hrs.break_start != null && hrs.break_end != null ? [hrs.break_start, hrs.break_end] : null;
  const busy = [
    ...await db.all("SELECT start_min s,end_min e FROM bookings WHERE barber_id=? AND date=? AND status IN ('booked','done') AND id<>?", barberId, date, ignoreBookingId),
    ...await db.all('SELECT start_min s,end_min e FROM absences WHERE barber_id=? AND date=?', barberId, date),
  ];
  const n = now(), slots = [];
  for (let s = hrs.start_min; s + duration <= hrs.end_min; s += STEP) {
    if (date < n.date || (date === n.date && s <= n.min)) continue; // déjà passé
    const e = s + duration;
    if (brk && s < brk[1] && brk[0] < e) continue; // pendant la pause du barbier
    slots.push({ start: s, time: hhmm(s), free: !busy.some(b => s < b.e && b.s < e) });
  }
  return { closed: false, slots };
}
function checkDate(date) {
  if (!isDate(date)) fail('Date invalide');
  const n = now(), last = addDays(n.date, +getSettings().booking_days - 1);
  if (date < n.date) fail('Cette date est déjà passée');
  if (date > last) fail(`Réservation possible jusqu'au ${fdate(last)} seulement`);
}
async function checkSlot(barberId, date, start, duration, ignoreBookingId) {
  checkDate(date);
  const slot = (await daySlots(barberId, date, duration, ignoreBookingId)).slots.find(x => x.start === start);
  if (!slot) fail("Ce créneau n'est pas disponible (hors horaires ou déjà passé)");
  if (!slot.free) fail('Ce créneau vient d\'être réservé, choisissez-en un autre', 409);
}

// un créneau se libère : on prévient la liste d'attente de ce jour-là (start=null : plusieurs créneaux, ex. absence retirée)
async function slotFreed(barberId, date, start = null) {
  const n = now();
  if (date < n.date || (date === n.date && start !== null && start <= n.min)) return;
  const barber = await db.get('SELECT name FROM users WHERE id=?', barberId);
  const list = await db.all('SELECT * FROM waitlist WHERE date=? AND notified=0 AND (barber_id=? OR barber_id IS NULL)', date, barberId);
  const what = start === null ? `Des créneaux se sont libérés chez ${barber.name} le ${fdate(date)}` : `Un créneau s'est libéré chez ${barber.name} le ${when(date, start)}`;
  for (const w of list) {
    await notify(w.client_id, `⏰ ${what}. Réservez vite avant les autres !`);
    await db.run('UPDATE waitlist SET notified=1 WHERE id=?', w.id);
  }
}
const canChange = b => startMs(b.date, b.start_min) - Date.now() >= +getSettings().cancel_hours * 3600e3;
// rappel déjà « envoyé » si le RDV commence avant l'heure du rappel (évite un rappel juste après la réservation)
const reminderDue = (date, start) => startMs(date, start) - Date.now() <= +getSettings().reminder_minutes * 60e3 ? 1 : 0;

// ===== Comptes =====
app.post('/api/auth/register', h(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60), phone = cleanPhone(req.body.phone), pass = String(req.body.password || '');
  if (!name) fail('Indiquez votre nom');
  if (phone.replace(/\D/g, '').length < 8) fail('Numéro de téléphone invalide');
  if (pass.length < 6) fail('Mot de passe : 6 caractères minimum');
  if (await db.get('SELECT 1 FROM users WHERE phone=?', phone)) fail('Ce numéro a déjà un compte : connectez-vous');
  const r = await db.run('INSERT INTO users(name,phone,password_hash) VALUES(?,?,?) ON CONFLICT(phone) DO NOTHING RETURNING id', name, phone, bcrypt.hashSync(pass, 10));
  if (!r.rows.length) fail('Ce numéro a déjà un compte : connectez-vous');
  await startSession(req, res, r.rows[0].id);
  return publicUser(await db.get('SELECT * FROM users WHERE id=?', r.rows[0].id));
}));
app.post('/api/auth/login', h(async (req, res) => {
  const u = await db.get('SELECT * FROM users WHERE phone=?', cleanPhone(req.body.phone));
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.password_hash)) fail('Téléphone ou mot de passe incorrect', 401);
  if (!u.active) fail('Ce compte est désactivé', 403);
  await startSession(req, res, u.id);
  return publicUser(u);
}));
app.post('/api/auth/logout', h(async (req, res) => {
  if (req.sid) await db.run('DELETE FROM sessions WHERE token=?', req.sid);
  if (req.body.endpoint) await db.run('DELETE FROM push_subs WHERE endpoint=?', String(req.body.endpoint));
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}));
// null si personne n'est connecté (visiteur)
app.get('/api/me', h((req, res) => res.json(req.user ? publicUser(req.user) : null)));
app.put('/api/me', auth, h(async req => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!name) fail('Le nom est obligatoire');
  if (req.body.password) {
    if (!bcrypt.compareSync(String(req.body.current_password || ''), req.user.password_hash)) fail('Mot de passe actuel incorrect');
    if (String(req.body.password).length < 6) fail('Nouveau mot de passe : 6 caractères minimum');
    await db.run('UPDATE users SET password_hash=? WHERE id=?', bcrypt.hashSync(String(req.body.password), 10), req.user.id);
  }
  await db.run('UPDATE users SET name=? WHERE id=?', name, req.user.id);
  return publicUser(await db.get('SELECT * FROM users WHERE id=?', req.user.id));
}));

// ===== Données publiques (page d'accueil) =====
const HOURS_SQL = 'SELECT weekday,start_min,end_min,break_start,break_end FROM hours WHERE barber_id=? ORDER BY weekday';
app.get('/api/public', h(async () => {
  const s = getSettings();
  const barbers = await db.all("SELECT id,name,photo,bio FROM users WHERE role IN ('admin','barber') AND active=1 ORDER BY role='admin' DESC, id");
  return {
    shop: { name: s.shop_name, phone: s.shop_phone, address: s.shop_address },
    rules: { cancel_hours: +s.cancel_hours, booking_days: +s.booking_days, loyalty_every: +s.loyalty_every, loyalty_discount: +s.loyalty_discount, reminder_minutes: +s.reminder_minutes, closed_days: closedDays() },
    today: now().date,
    services: await db.all('SELECT id,name,duration,price,loyalty FROM services WHERE active=1 ORDER BY id'),
    barbers: await Promise.all(barbers.map(async b => ({ ...b, days: await db.all(HOURS_SQL, b.id) }))),
    styles: await db.all('SELECT s.id,s.title,s.file,s.barber_id,u.name barber FROM styles s LEFT JOIN users u ON u.id=s.barber_id ORDER BY s.id DESC'),
    // application Android disponible au téléchargement (construite par android/build-apk.ps1)
    apk: fs.existsSync(path.join(__dirname, 'public', 'download', 'elegance-barbershop.apk')),
    offers: await db.all('SELECT id,title,description,ends_on FROM offers WHERE ends_on IS NULL OR ends_on>=? ORDER BY id DESC', now().date),
  };
}));

app.get('/api/slots', h(async req => {
  const barber = await getBarber(int(req.query.barber_id)) || fail('Barbier introuvable', 404);
  // modification d'un RDV : même durée que le RDV existant, qui ne bloque pas son propre créneau
  const ignore = int(req.query.ignore) || 0;
  const own = ignore && await db.get('SELECT start_min,end_min FROM bookings WHERE id=?', ignore);
  const duration = own ? own.end_min - own.start_min : (await pickServices(req.query.service_ids ?? req.query.service_id)).reduce((t, x) => t + x.duration, 0);
  checkDate(req.query.date);
  const absent = await db.all('SELECT start_min,end_min,reason FROM absences WHERE barber_id=? AND date=?', barber.id, req.query.date);
  return { ...await daySlots(barber.id, req.query.date, duration, ignore), absent };
}));

// ===== Réservations du client =====
async function loyaltyFor(user, ignoreBookingId = 0) {
  const s = getSettings();
  const pending = await db.get("SELECT 1 FROM bookings WHERE client_id=? AND loyalty=1 AND status='booked' AND id<>?", user.id, ignoreBookingId);
  return user.points >= +s.loyalty_every && !pending;
}
app.get('/api/bookings/mine', auth, h(async req => (await db.all(`
  SELECT b.*, s.name service, u.name barber, st.file style_file, st.title style_title
  FROM bookings b JOIN services s ON s.id=b.service_id JOIN users u ON u.id=b.barber_id LEFT JOIN styles st ON st.id=b.style_id
  WHERE b.client_id=? ORDER BY b.date DESC, b.start_min DESC LIMIT 100`, req.user.id))
  .map(withLabel).map(b => ({ ...b, time: hhmm(b.start_min), upcoming: b.status === 'booked' && startMs(b.date, b.start_min) > Date.now(), can_change: b.status === 'booked' && canChange(b) }))));

app.post('/api/bookings', auth, h(async req => {
  if (req.user.role !== 'client') fail('Connectez-vous avec un compte client pour réserver');
  const barber = await getBarber(int(req.body.barber_id)) || fail('Barbier introuvable', 404);
  const services = await pickServices(req.body.service_ids ?? [req.body.service_id]);
  const duration = services.reduce((t, x) => t + x.duration, 0), full = round2(services.reduce((t, x) => t + x.price, 0));
  const label = services.map(x => x.name).join(' + ');
  const items = JSON.stringify(services.map(x => ({ id: x.id, name: x.name, price: x.price, duration: x.duration, loyalty: x.loyalty })));
  const date = req.body.date, start = int(req.body.start);
  const styleId = int(req.body.style_id);
  if (styleId && !await db.get('SELECT 1 FROM styles WHERE id=?', styleId)) fail('Style introuvable');
  const note = String(req.body.note || '').trim().slice(0, 200);
  // vérification + insertion sous verrou : deux clients ne peuvent pas prendre le même créneau
  const booking = await db.exclusive(async () => {
    await checkSlot(barber.id, date, start, duration);
    // la réduction fidélité porte sur une coupe (le service « fidélité » le plus cher), pas sur toute la note
    const eligible = services.filter(x => x.loyalty).map(x => x.price);
    const loyalty = eligible.length > 0 && await loyaltyFor(req.user);
    const price = loyalty ? round2(full - Math.max(...eligible) * +getSettings().loyalty_discount / 100) : full;
    const b = (await db.run(`INSERT INTO bookings(client_id,barber_id,service_id,style_id,date,start_min,end_min,price,full_price,loyalty,note,reminder_sent,items)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`, req.user.id, barber.id, services[0].id, styleId || null, date, start, start + duration,
      price, full, loyalty ? 1 : 0, note, reminderDue(date, start), items)).rows[0];
    await db.run('DELETE FROM waitlist WHERE client_id=? AND date=?', req.user.id, date);
    return b;
  });
  await notifyStaff(barber.id, `📅 Nouveau RDV : ${req.user.name} - ${label} avec ${barber.name}, ${when(date, start)}${note ? ' | 📝 ' + note : ''}`);
  return booking;
}));

app.post('/api/bookings/:id/cancel', auth, h(async req => {
  const b = await db.get("SELECT * FROM bookings WHERE id=? AND client_id=? AND status='booked'", int(req.params.id), req.user.id) || fail('Réservation introuvable', 404);
  if (!canChange(b)) fail(`Annulation impossible moins de ${getSettings().cancel_hours} h avant : appelez le salon`);
  await db.run("UPDATE bookings SET status='cancelled' WHERE id=?", b.id);
  await notifyStaff(b.barber_id, `❌ ${req.user.name} a annulé son RDV du ${when(b.date, b.start_min)}`);
  await slotFreed(b.barber_id, b.date, b.start_min);
}));

app.post('/api/bookings/:id/reschedule', auth, h(async req => {
  const b = await db.get("SELECT * FROM bookings WHERE id=? AND client_id=? AND status='booked'", int(req.params.id), req.user.id) || fail('Réservation introuvable', 404);
  if (!canChange(b)) fail(`Modification impossible moins de ${getSettings().cancel_hours} h avant : appelez le salon`);
  const barber = await getBarber(int(req.body.barber_id)) || fail('Barbier introuvable', 404);
  const date = req.body.date, start = int(req.body.start), dur = b.end_min - b.start_min;
  await db.exclusive(async () => {
    await checkSlot(barber.id, date, start, dur, b.id);
    await db.run('UPDATE bookings SET barber_id=?,date=?,start_min=?,end_min=?,reminder_sent=? WHERE id=?', barber.id, date, start, start + dur, reminderDue(date, start), b.id);
    await db.run('DELETE FROM waitlist WHERE client_id=? AND date=?', req.user.id, date);
  });
  const msg = `🔄 ${req.user.name} a déplacé son RDV : ${when(b.date, b.start_min)} → ${when(date, start)} avec ${barber.name}`;
  await notifyStaff(barber.id, msg);
  if (barber.id !== b.barber_id) await notify(b.barber_id, msg);
  await slotFreed(b.barber_id, b.date, b.start_min);
}));

// ===== Liste d'attente =====
app.get('/api/waitlist', auth, h(req => db.all(`
  SELECT w.*, u.name barber FROM waitlist w LEFT JOIN users u ON u.id=w.barber_id
  WHERE w.client_id=? AND w.date>=? ORDER BY w.date`, req.user.id, now().date)));
app.post('/api/waitlist', auth, h(async req => {
  const barberId = int(req.body.barber_id) || null;
  if (barberId && !await getBarber(barberId)) fail('Barbier introuvable', 404);
  checkDate(req.body.date);
  const dup = await db.get('SELECT id FROM waitlist WHERE client_id=? AND date=? AND barber_id IS NOT DISTINCT FROM ?::int AND notified=0', req.user.id, req.body.date, barberId);
  if (dup) fail("Vous êtes déjà sur la liste d'attente pour ce jour");
  await db.run('INSERT INTO waitlist(client_id,barber_id,date) VALUES(?,?,?)', req.user.id, barberId, req.body.date);
}));
app.delete('/api/waitlist/:id', auth, h(async req => {
  await db.run('DELETE FROM waitlist WHERE id=? AND client_id=?', int(req.params.id), req.user.id);
}));

// ===== Notifications =====
app.get('/api/notifications', auth, h(async req => ({
  unread: (await db.get('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0', req.user.id)).n,
  items: await db.all('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50', req.user.id),
})));
app.post('/api/notifications/read', auth, h(async req => { await db.run('UPDATE notifications SET read=1 WHERE user_id=? AND read=0', req.user.id); }));
app.get('/api/push/key', h(() => ({ key: VAPID.publicKey })));
// notification de test : vérifie qu'elle arrive bien sur l'écran du téléphone
app.post('/api/push/test', auth, h(async req => {
  await notify(req.user.id, '🔔 Notification de test : les notifications fonctionnent sur ce téléphone !');
  return { devices: (await db.get('SELECT COUNT(*) n FROM push_subs WHERE user_id=?', req.user.id)).n };
}));
// état des notifications de ce téléphone (écran « Compte ») et erreurs remontées par les téléphones
app.post('/api/push/status', auth, h(async req => ({
  devices: (await db.get('SELECT COUNT(*) n FROM push_subs WHERE user_id=?', req.user.id)).n,
  known: !!await db.get('SELECT 1 FROM push_subs WHERE user_id=? AND endpoint=?', req.user.id, String(req.body.endpoint || '')),
})));
app.post('/api/push/report', auth, h(req => {
  const b = req.body || {}, clip = (v, n) => String(v ?? '').slice(0, n);
  console.warn(`[push] ${req.user.name} (#${req.user.id}) ${clip(b.step, 40)} : ${clip(b.error, 300)} | permission=${clip(b.permission, 12)} installée=${!!b.standalone} | ${clip(b.ua, 200)}`);
}));
app.post('/api/push/subscribe', auth, h(async req => {
  const s = req.body.subscription || {};
  if (!/^https:\/\//.test(s.endpoint || '') || !s.keys || !s.keys.p256dh || !s.keys.auth) fail('Abonnement invalide');
  await db.run('INSERT INTO push_subs(endpoint,user_id,keys) VALUES(?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, keys=excluded.keys',
    s.endpoint, req.user.id, JSON.stringify({ p256dh: String(s.keys.p256dh), auth: String(s.keys.auth) }));
  console.log(`[push] téléphone enregistré pour ${req.user.name} (#${req.user.id})`);
}));

// ===== Barbiers : planning, absences, galerie =====
// un barbier ne voit et ne gère que les siens ; l'admin gère tout le monde
const scopeBarber = (req, wanted) => req.user.role === 'admin' ? (int(wanted) || null) : req.user.id;

app.get('/api/staff/bookings', staff, h(async req => {
  const date = isDate(req.query.date) ? req.query.date : now().date;
  const barberId = scopeBarber(req, req.query.barber_id);
  return (await db.all(`
    SELECT b.*, s.name service, c.name client, c.phone client_phone, c.points client_points, u.name barber, st.file style_file, st.title style_title
    FROM bookings b JOIN services s ON s.id=b.service_id JOIN users c ON c.id=b.client_id JOIN users u ON u.id=b.barber_id
    LEFT JOIN styles st ON st.id=b.style_id
    WHERE b.date=? AND (?::int IS NULL OR b.barber_id=?) ORDER BY b.start_min, u.id`, date, barberId, barberId))
    .map(withLabel).map(b => ({ ...b, time: hhmm(b.start_min), end: hhmm(b.end_min) }));
}));

app.post('/api/staff/bookings/:id/status', staff, h(async req => {
  const status = req.body.status;
  if (!['done', 'no_show', 'cancelled'].includes(status)) fail('Statut invalide');
  const b = await db.get("SELECT * FROM bookings WHERE id=? AND status='booked'", int(req.params.id)) || fail('Réservation introuvable ou déjà traitée', 404);
  if (req.user.role !== 'admin' && b.barber_id !== req.user.id) fail('Ce RDV ne vous appartient pas', 403);
  const s = getSettings(), every = +s.loyalty_every;
  const earns = itemsOf(b).some(x => x.loyalty); // seuls les services « fidélité » (coupes) donnent un point
  // le statut ne change qu'une fois, même si deux personnes cliquent en même temps
  if (!(await db.run("UPDATE bookings SET status=? WHERE id=? AND status='booked'", status, b.id)).rowCount) fail('Réservation introuvable ou déjà traitée', 404);
  if (status === 'done') {
    // la coupe à prix réduit « consomme » les points ; sinon +1 point
    if (b.loyalty) await db.run('UPDATE users SET points=GREATEST(0,points-?) WHERE id=?', every, b.client_id);
    else if (earns) await db.run('UPDATE users SET points=points+1 WHERE id=?', b.client_id);
    const pts = (await db.get('SELECT points FROM users WHERE id=?', b.client_id)).points;
    await notify(b.client_id, !earns && !b.loyalty ? '✂️ Merci pour votre visite, à bientôt !' : pts >= every
      ? `🎉 Merci ! Votre prochaine coupe est à -${s.loyalty_discount} % (carte fidélité complète)`
      : `✂️ Merci pour votre visite ! Fidélité : ${pts}/${every} — encore ${every - pts} et la suivante est à -${s.loyalty_discount} %`);
  } else if (status === 'cancelled') {
    await notify(b.client_id, `❌ Votre RDV du ${when(b.date, b.start_min)} a été annulé par le salon. Réservez un autre créneau depuis l'application.`);
    await slotFreed(b.barber_id, b.date, b.start_min);
  }
}));

app.get('/api/staff/absences', staff, h(async req => {
  const barberId = scopeBarber(req, req.query.barber_id);
  return (await db.all(`SELECT a.*, u.name barber FROM absences a JOIN users u ON u.id=a.barber_id
    WHERE a.date>=? AND (?::int IS NULL OR a.barber_id=?) ORDER BY a.date, a.start_min`, now().date, barberId, barberId))
    .map(a => ({ ...a, from: hhmm(a.start_min), to: hhmm(a.end_min) }));
}));
app.post('/api/staff/absences', staff, h(async req => {
  const barberId = req.user.role === 'admin' ? int(req.body.barber_id) : req.user.id;
  const barber = await getBarber(barberId) || fail('Barbier introuvable', 404);
  const date = req.body.date;
  if (!isDate(date) || date < now().date) fail('Choisissez un jour à venir');
  const full = !req.body.from && !req.body.to;
  const s = full ? 0 : toMin(req.body.from), e = full ? 24 * 60 : toMin(req.body.to);
  if (!(e > s)) fail("L'heure de fin doit être après l'heure de début");
  await db.run('INSERT INTO absences(barber_id,date,start_min,end_min,reason) VALUES(?,?,?,?,?)', barber.id, date, s, e, String(req.body.reason || '').slice(0, 80));
  // les RDV déjà pris pendant l'absence sont signalés (pas annulés automatiquement)
  const clash = (await db.get("SELECT COUNT(*) n FROM bookings WHERE barber_id=? AND date=? AND status='booked' AND start_min<? AND ?<end_min", barber.id, date, e, s)).n;
  return { ok: true, clash };
}));
app.delete('/api/staff/absences/:id', staff, h(async req => {
  const a = await db.get('SELECT * FROM absences WHERE id=?', int(req.params.id)) || fail('Absence introuvable', 404);
  if (req.user.role !== 'admin' && a.barber_id !== req.user.id) fail('Action non autorisée', 403);
  await db.run('DELETE FROM absences WHERE id=?', a.id);
  await slotFreed(a.barber_id, a.date);
}));

// photos envoyées : gardées dans la table files, servies par /uploads/<nom>
async function saveImage(dataUrl, maxBytes, tooBig) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '') || fail('Image invalide');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > maxBytes) fail(tooBig);
  const file = crypto.randomBytes(12).toString('hex') + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
  await db.run('INSERT INTO files(name,mime,data) VALUES(?,?,?)', file, 'image/' + m[1], buf);
  return file;
}
const deleteImage = file => db.run('DELETE FROM files WHERE name=?', path.basename(file)).catch(e => console.warn('photo', e.message));
app.post('/api/staff/styles', staff, h(async req => {
  const title = String(req.body.title || '').trim().slice(0, 60) || fail('Donnez un nom au style (ex : Dégradé bas)');
  const file = await saveImage(req.body.image, 4 * 1024 * 1024, 'Image trop lourde (4 Mo max)');
  const barberId = req.user.role === 'admin' ? (int(req.body.barber_id) || req.user.id) : req.user.id;
  await db.run('INSERT INTO styles(title,file,barber_id) VALUES(?,?,?)', title, file, barberId);
}));
// profil du portfolio : photo + présentation (le barbier pour lui-même, l'admin pour toute l'équipe)
app.put('/api/staff/profile', staff, h(async req => {
  const id = req.user.role === 'admin' && int(req.body.barber_id) ? int(req.body.barber_id) : req.user.id;
  const b = await db.get("SELECT * FROM users WHERE id=? AND role IN ('admin','barber')", id) || fail('Barbier introuvable', 404);
  if (req.body.bio !== undefined) await db.run('UPDATE users SET bio=? WHERE id=?', String(req.body.bio).trim().slice(0, 200), id);
  const oldPhoto = b.photo;
  if (req.body.photo) await db.run('UPDATE users SET photo=? WHERE id=?', await saveImage(req.body.photo, 2 * 1024 * 1024, 'Photo trop lourde (2 Mo max)'), id);
  else if (req.body.remove_photo) await db.run('UPDATE users SET photo=NULL WHERE id=?', id);
  if (oldPhoto && (req.body.photo || req.body.remove_photo)) await deleteImage(oldPhoto);
  const u = await db.get('SELECT photo,bio FROM users WHERE id=?', id);
  return { ok: true, photo: u.photo, bio: u.bio };
}));
app.delete('/api/staff/styles/:id', staff, h(async req => {
  const s = await db.get('SELECT * FROM styles WHERE id=?', int(req.params.id)) || fail('Photo introuvable', 404);
  if (req.user.role !== 'admin' && s.barber_id !== req.user.id) fail('Action non autorisée', 403);
  await db.run('DELETE FROM styles WHERE id=?', s.id);
  await deleteImage(s.file);
}));

// ===== Admin : équipe, services, clients, réglages, statistiques =====
app.get('/api/admin/barbers', admin, h(async () => {
  const list = await db.all("SELECT id,name,phone,role,active,photo FROM users WHERE role IN ('admin','barber') ORDER BY role='admin' DESC, id");
  return Promise.all(list.map(async b => ({ ...b, days: await db.all(HOURS_SQL, b.id) })));
}));
app.post('/api/admin/barbers', admin, h(async req => {
  const name = String(req.body.name || '').trim().slice(0, 60), phone = cleanPhone(req.body.phone), pass = String(req.body.password || '');
  if (!name) fail('Indiquez le nom');
  if (phone.replace(/\D/g, '').length < 8) fail('Numéro de téléphone invalide');
  if (pass.length < 6) fail('Mot de passe : 6 caractères minimum');
  await db.exclusive(async () => {
    const existing = await db.get('SELECT * FROM users WHERE phone=?', phone);
    if (existing && existing.role !== 'client') fail('Ce numéro appartient déjà à un barbier');
    let id;
    if (existing) { // un client devient barbier
      await db.run("UPDATE users SET role='barber', name=?, password_hash=?, active=1 WHERE id=?", name, bcrypt.hashSync(pass, 10), existing.id);
      id = existing.id;
    } else id = (await db.run("INSERT INTO users(name,phone,password_hash,role) VALUES(?,?,?,'barber') RETURNING id", name, phone, bcrypt.hashSync(pass, 10))).rows[0].id;
    // horaires de départ : ceux de l'admin
    const model = await db.all("SELECT h.* FROM hours h JOIN users u ON u.id=h.barber_id WHERE u.role='admin' ORDER BY u.id");
    const base = model.length ? model.filter(r => r.barber_id === model[0].barber_id) : [0, 2, 3, 4, 5, 6].map(weekday => ({ weekday, start_min: 540, end_min: 1200 }));
    await db.run('DELETE FROM hours WHERE barber_id=?', id);
    for (const r of base) await db.run('INSERT INTO hours(barber_id,weekday,start_min,end_min,break_start,break_end) VALUES(?,?,?,?,?,?)', id, r.weekday, r.start_min, r.end_min, r.break_start ?? null, r.break_end ?? null);
  });
}));
app.put('/api/admin/barbers/:id', admin, h(async req => {
  const b = await db.get("SELECT * FROM users WHERE id=? AND role IN ('admin','barber')", int(req.params.id)) || fail('Barbier introuvable', 404);
  const name = String(req.body.name ?? b.name).trim().slice(0, 60) || fail('Le nom est obligatoire');
  const active = req.body.active === undefined ? b.active : (req.body.active ? 1 : 0);
  if (b.id === req.user.id && !active) fail('Vous ne pouvez pas désactiver votre propre compte');
  if (req.body.password && String(req.body.password).length < 6) fail('Mot de passe : 6 caractères minimum');
  await db.run('UPDATE users SET name=?, active=? WHERE id=?', name, active, b.id);
  if (req.body.password) {
    await db.run('UPDATE users SET password_hash=? WHERE id=?', bcrypt.hashSync(String(req.body.password), 10), b.id);
    await db.run('DELETE FROM sessions WHERE user_id=? AND token<>?', b.id, req.sid || '');
  }
  let cancelled = 0;
  if (b.active && !active) {
    // barbier désactivé : ses RDV à venir sont annulés et les clients prévenus
    await db.run('DELETE FROM sessions WHERE user_id=?', b.id);
    const n = now();
    const future = await db.all("SELECT * FROM bookings WHERE barber_id=? AND status='booked' AND (date>? OR (date=? AND start_min>?))", b.id, n.date, n.date, n.min);
    for (const x of future) {
      await db.run("UPDATE bookings SET status='cancelled' WHERE id=?", x.id);
      await notify(x.client_id, `❌ Votre RDV du ${when(x.date, x.start_min)} avec ${b.name} est annulé (barbier indisponible). Réservez avec un autre barbier.`);
    }
    cancelled = future.length;
  }
  return { ok: true, cancelled };
}));
const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
// days = [{weekday, from, to, break_from?, break_to?}] ; un jour absent = jour de repos du barbier
async function saveHours(barberId, days) {
  if (!Array.isArray(days)) fail('Horaires invalides');
  const closed = closedDays();
  const rows = days.map(d => {
    const wd = int(d.weekday);
    if (wd === null || wd < 0 || wd > 6) fail('Jour invalide');
    const s = toMin(d.from), e = toMin(d.to), day = DAY_NAMES[wd];
    if (closed.includes(wd)) fail(`Le salon est fermé le ${day} (repos hebdomadaire)`);
    if (!(e > s)) fail(`${day} : l'heure de fin doit être après l'heure de début`);
    let bs = null, be = null;
    if (d.break_from || d.break_to) {
      bs = toMin(d.break_from); be = toMin(d.break_to);
      if (!(be > bs)) fail(`${day} : la fin de la pause doit être après son début`);
      if (bs < s || be > e) fail(`${day} : la pause doit être pendant les heures de travail`);
    }
    return { wd, s, e, bs, be };
  });
  if (new Set(rows.map(r => r.wd)).size !== rows.length) fail('Un jour est en double');
  await db.exclusive(async () => {
    await db.run('DELETE FROM hours WHERE barber_id=?', barberId);
    for (const r of rows) await db.run('INSERT INTO hours(barber_id,weekday,start_min,end_min,break_start,break_end) VALUES(?,?,?,?,?,?)', barberId, r.wd, r.s, r.e, r.bs, r.be);
  });
  // RDV déjà pris hors des nouveaux horaires ou pendant la pause : on les signale (pas d'annulation automatique)
  const n = now();
  return (await db.all("SELECT * FROM bookings WHERE barber_id=? AND status='booked' AND date>=?", barberId, n.date))
    .filter(x => {
      const r = rows.find(y => y.wd === weekday(x.date));
      return !r || x.start_min < r.s || x.end_min > r.e || (r.bs != null && x.start_min < r.be && r.bs < x.end_min);
    }).length;
}
app.put('/api/admin/barbers/:id/hours', admin, h(async req => {
  const b = await db.get("SELECT * FROM users WHERE id=? AND role IN ('admin','barber')", int(req.params.id)) || fail('Barbier introuvable', 404);
  return { ok: true, clash: await saveHours(b.id, req.body.days) };
}));
// le barbier gère lui-même ses horaires et sa pause
app.get('/api/staff/hours', staff, h(req => db.all(HOURS_SQL, req.user.id)));
app.put('/api/staff/hours', staff, h(async req => ({ ok: true, clash: await saveHours(req.user.id, req.body.days) })));

app.get('/api/admin/services', admin, h(() => db.all('SELECT * FROM services ORDER BY active DESC, id')));
function serviceBody(body) {
  const name = String(body.name || '').trim().slice(0, 60) || fail('Indiquez le nom du service');
  const duration = int(body.duration), price = Number(body.price);
  if (!duration || duration < STEP || duration % STEP) fail(`Durée en minutes, multiple de ${STEP} (15, 30, 45, 60…)`);
  if (!(price >= 0)) fail('Prix invalide');
  return [name, duration, round2(price), body.active === false ? 0 : 1, body.loyalty ? 1 : 0];
}
app.post('/api/admin/services', admin, h(async req => { await db.run('INSERT INTO services(name,duration,price,active,loyalty) VALUES(?,?,?,?,?)', ...serviceBody(req.body)); }));
app.put('/api/admin/services/:id', admin, h(async req => {
  const r = await db.run('UPDATE services SET name=?,duration=?,price=?,active=?,loyalty=? WHERE id=?', ...serviceBody(req.body), int(req.params.id));
  if (!r.rowCount) fail('Service introuvable', 404);
}));

app.get('/api/admin/clients', admin, h(() => db.all(`
  SELECT u.id,u.name,u.phone,u.points,u.created_at,
    SUM((b.status='done')::int) visits, SUM((b.status='no_show')::int) no_shows, MAX(CASE WHEN b.status='done' THEN b.date END) last_visit
  FROM users u LEFT JOIN bookings b ON b.client_id=u.id WHERE u.role='client'
  GROUP BY u.id ORDER BY last_visit DESC NULLS LAST, u.id DESC`)));

// ===== Offres : chaque nouvelle offre est envoyée en notification à tous les clients =====
app.get('/api/admin/offers', admin, h(async () => (await db.all('SELECT * FROM offers ORDER BY id DESC'))
  .map(o => ({ ...o, expired: !!o.ends_on && o.ends_on < now().date }))));
app.post('/api/admin/offers', admin, h(async req => {
  const title = String(req.body.title || '').trim().slice(0, 80) || fail("Donnez un titre à l'offre (ex : -20 % sur la barbe)");
  const description = String(req.body.description || '').trim().slice(0, 300);
  const endsOn = req.body.ends_on || null;
  if (endsOn && (!isDate(endsOn) || endsOn < now().date)) fail('La date de fin doit être aujourd\'hui ou plus tard');
  await db.run('INSERT INTO offers(title,description,ends_on) VALUES(?,?,?)', title, description, endsOn);
  const clients = await db.all("SELECT id FROM users WHERE role='client' AND active=1");
  const msg = `🔥 ${title}${description ? ' : ' + description : ''}${endsOn ? ` (jusqu'au ${fdate(endsOn)})` : ''}`;
  for (const c of clients) await notify(c.id, msg);
  return { ok: true, sent: clients.length };
}));
app.delete('/api/admin/offers/:id', admin, h(async req => { await db.run('DELETE FROM offers WHERE id=?', int(req.params.id)); }));

app.get('/api/admin/settings', admin, h(() => getSettings()));
app.put('/api/admin/settings', admin, h(async req => {
  const nums = { cancel_hours: [0, 72], booking_days: [1, 90], reminder_minutes: [10, 1440], loyalty_every: [1, 50], loyalty_discount: [1, 100] };
  // tout est vérifié avant d'enregistrer : une valeur invalide ne modifie rien
  const values = {};
  for (const k of ['shop_name', 'shop_phone', 'shop_address']) if (req.body[k] !== undefined) values[k] = String(req.body[k]).trim().slice(0, 100);
  if (req.body.closed_days !== undefined) {
    const days = Array.isArray(req.body.closed_days) ? [...new Set(req.body.closed_days.map(int))] : fail('Jours de fermeture invalides');
    if (days.some(d => d === null || d < 0 || d > 6)) fail('Jours de fermeture invalides');
    if (days.length === 7) fail('Le salon ne peut pas être fermé tous les jours');
    values.closed_days = days.sort().join(',');
  }
  for (const [k, [lo, hi]] of Object.entries(nums)) if (req.body[k] !== undefined) {
    const v = Number(req.body[k]);
    if (!Number.isFinite(v) || v < lo || v > hi) fail(`Valeur invalide pour ${k} (entre ${lo} et ${hi})`);
    values[k] = String(v);
  }
  await saveSettings(values);
  return getSettings();
}));

app.get('/api/admin/stats', admin, h(async () => {
  const n = now(), month = n.date.slice(0, 7);
  return {
    today: (await db.get("SELECT COUNT(*) n FROM bookings WHERE date=? AND status IN ('booked','done')", n.date)).n,
    upcoming: (await db.get("SELECT COUNT(*) n FROM bookings WHERE status='booked' AND date>=?", n.date)).n,
    month_revenue: (await db.get("SELECT COALESCE(SUM(price),0) v FROM bookings WHERE status='done' AND substr(date,1,7)=?", month)).v,
    month_visits: (await db.get("SELECT COUNT(*) n FROM bookings WHERE status='done' AND substr(date,1,7)=?", month)).n,
    month_no_shows: (await db.get("SELECT COUNT(*) n FROM bookings WHERE status='no_show' AND substr(date,1,7)=?", month)).n,
    clients: (await db.get("SELECT COUNT(*) n FROM users WHERE role='client'")).n,
    by_barber: await db.all(`SELECT u.name, COUNT(b.id) visits, COALESCE(SUM(b.price),0) revenue FROM users u
      LEFT JOIN bookings b ON b.barber_id=u.id AND b.status='done' AND substr(b.date,1,7)=?
      WHERE u.role IN ('admin','barber') AND u.active=1 GROUP BY u.id ORDER BY revenue DESC`, month),
  };
}));

// ===== Rappel automatique avant le rendez-vous (vérifié chaque minute) =====
async function sendReminders() {
  const lead = +getSettings().reminder_minutes * 60e3, t = Date.now(), n = now();
  const list = await db.all(`SELECT b.*, s.name service, u.name barber FROM bookings b JOIN services s ON s.id=b.service_id JOIN users u ON u.id=b.barber_id
    WHERE b.status='booked' AND b.reminder_sent=0 AND b.date BETWEEN ? AND ?`, n.date, addDays(n.date, 1));
  for (const b of list.map(withLabel)) {
    const diff = startMs(b.date, b.start_min) - t;
    if (diff > lead || diff < 0) continue;
    // marqué avant l'envoi : jamais deux rappels pour le même RDV
    if ((await db.run('UPDATE bookings SET reminder_sent=1 WHERE id=? AND reminder_sent=0', b.id)).rowCount)
      await notify(b.client_id, `⏰ Rappel : ${b.service} avec ${b.barber} aujourd'hui à ${hhmm(b.start_min)} (dans ${Math.round(diff / 60e3)} min). À tout à l'heure !`);
  }
}
const reminders = () => sendReminders().catch(e => console.error('rappels', e));

// ===== Fichiers du site =====
// assetlinks.json : prouve à Android que l'application Elegance Barber Shop appartient à ce site (plein écran, sans barre d'adresse)
app.use('/.well-known', express.static(path.join(__dirname, 'public', '.well-known')));
app.get('/uploads/:file', async (req, res) => {
  try {
    const f = await db.get('SELECT mime,data FROM files WHERE name=?', req.params.file);
    if (!f) return res.sendStatus(404);
    res.set({ 'Content-Type': f.mime, 'Cache-Control': 'public, max-age=2592000, immutable' }).send(f.data);
  } catch (e) { console.error(e); res.sendStatus(500); }
});
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, p) => { if (/sw\.js$|\.html$/.test(p)) res.setHeader('Cache-Control', 'no-cache'); },
}));
app.use('/api', (req, res) => res.status(404).json({ error: 'Introuvable' }));
// erreur de la base pendant la lecture de la session
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Erreur serveur' }); });

init().then(loadVapid).then(() => {
  setInterval(reminders, 60e3);
  reminders();
  app.listen(PORT, process.env.HOST, () => console.log(`✂️  Application prête : http://localhost:${PORT}`));
}).catch(e => {
  console.error('❌ Connexion à PostgreSQL impossible :', e.message);
  console.error('   Vérifiez DATABASE_URL (Neon › Connection string).');
  process.exit(1);
});

// arrêt propre (Ctrl+C)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { db.pool.end().finally(() => { console.log('\nServeur arrêté.'); process.exit(0); }); });
