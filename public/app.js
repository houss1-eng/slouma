// Interface de l'application (client, barbier, admin). Toutes les données passent par l'API du serveur.
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const hhmm = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (date, n) => { const d = new Date(date + 'T12:00'); d.setDate(d.getDate() + n); return ymd(d); };
const weekday = date => new Date(date + 'T12:00').getDay();
const fdate = date => new Date(date + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const DT = n => `${+(+n).toFixed(2)} DT`;
const initials = n => String(n || '?').trim().split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();
const avatar = (u, cls = '') => u && u.photo ? `<img class="avatar ${cls}" src="/uploads/${esc(u.photo)}" alt="">` : `<span class="avatar ${cls}">${esc(initials(u && u.name))}</span>`;
const STATUS = { booked: ['À venir', 'gold'], done: ['Terminé', 'ok'], cancelled: ['Annulé', 'bad'], no_show: ['Absent', 'warn'] };
const pill = st => `<span class="pill ${STATUS[st][1]}">${STATUS[st][0]}</span>`;

let toastT;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 4500); }

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && me) { me = null; render('auth'); }
    throw new Error(data.error || 'Erreur réseau');
  }
  return data;
}
// exécute une action ; en cas d'erreur, l'affiche (dans #id si fourni, sinon en toast)
async function run(fn, errId) {
  try { if (errId && $(errId)) $(errId).textContent = ''; return await fn(); }
  catch (e) { if (errId && $(errId)) $(errId).textContent = e.message; else toast('⚠️ ' + e.message); }
}

let pub = null, me = null, view = '', unread = 0;

// ===== Navigation =====
const TABS = {
  guest: [['book', '📅', 'Réserver'], ['gallery', '💈', 'Galerie'], ['auth', '👤', 'Connexion']],
  client: [['book', '📅', 'Réserver'], ['mine', '📋', 'Mes RDV'], ['gallery', '💈', 'Galerie'], ['loyalty', '🎁', 'Fidélité'], ['account', '👤', 'Compte']],
  barber: [['planning', '🗓️', 'Planning'], ['hours', '🕘', 'Horaires'], ['absences', '🚪', 'Absences'], ['gallery', '📸', 'Portfolio'], ['account', '👤', 'Compte']],
  admin: [['planning', '🗓️', 'Planning'], ['offers', '🔥', 'Offres'], ['team', '✂️', 'Équipe'], ['services', '🏷️', 'Services'], ['clients', '👥', 'Clients'], ['more', '⚙️', 'Plus']],
};
const roleTabs = () => TABS[me ? me.role : 'guest'];
function render(v) {
  // nouvel onglet : petite animation d'entrée de la page
  if (v && v !== view) { const m = $('m'); m.classList.remove('enter'); void m.offsetWidth; m.classList.add('enter'); }
  view = v || view;
  $('nav').hidden = false;
  const tabs = roleTabs();
  $('nav').innerHTML = tabs.map(([k, i, l]) => `<button class="${k === view ? 'on' : ''}" onclick="render('${k}')"><span>${i}</span>${l}</button>`).join('');
  $('bell').hidden = !me;
  window.scrollTo(0, 0);
  Promise.resolve().then(() => (V[view] || V.book)()).catch(e => toast('⚠️ ' + e.message));
}
const homeView = () => !me ? 'book' : me.role === 'client' ? 'book' : 'planning';

const V = {};
const A = {}; // actions appelées depuis le HTML (onclick="A.xxx()")

// ===== Connexion / inscription =====
let authMode = 'login', afterLogin = null;
V.auth = () => {
  const reg = authMode === 'reg';
  const s = pub.shop;
  $('m').innerHTML = `<div class="hero"><img src="/icons/logo-full.png" alt="${esc(s.name)}">
    ${s.address ? `<div class="muted">📍 ${esc(s.address)}</div>` : ''}${s.phone ? `<div class="muted">📞 <a href="tel:${esc(s.phone)}">${esc(s.phone)}</a></div>` : ''}</div>
    ${afterLogin ? '<p class="card center">Connectez-vous ou créez un compte pour confirmer votre réservation 👇</p>' : ''}
    <div class="tabs" style="margin-top:16px"><button class="${reg ? '' : 'on'}" onclick="A.authMode('login')">Connexion</button><button class="${reg ? 'on' : ''}" onclick="A.authMode('reg')">Créer un compte</button></div>
    <form onsubmit="A.auth(event)">
      ${reg ? '<label>Nom et prénom</label><input id="a_name" autocomplete="name" required>' : ''}
      <label>Téléphone</label><input id="a_phone" type="tel" inputmode="tel" autocomplete="tel" required>
      <label>Mot de passe</label><input id="a_pass" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required minlength="6">
      <button class="main" id="a_go">${reg ? 'Créer mon compte' : 'Se connecter'}</button><p id="a_err" class="err"></p>
    </form>
    ${reg ? `<p class="small muted center">🎁 Avec votre compte : après ${pub.rules.loyalty_every} coupes, la suivante est à -${pub.rules.loyalty_discount} %.</p>` : ''}`;
};
A.authMode = m => { authMode = m; V.auth(); };
A.auth = e => {
  e.preventDefault();
  run(async () => {
    $('a_go').disabled = true;
    try {
      const body = { phone: $('a_phone').value, password: $('a_pass').value };
      if (authMode === 'reg') body.name = $('a_name').value;
      me = await api('POST', authMode === 'reg' ? '/api/auth/register' : '/api/auth/login', body);
    } finally { if ($('a_go')) $('a_go').disabled = false; }
    await onLogin();
  }, 'a_err');
};
async function onLogin() {
  pollNotifs();
  pushRefresh();
  const back = afterLogin; afterLogin = null;
  if (back && me.role === 'client') { render('book'); toast('Vérifiez puis confirmez votre réservation'); }
  else render(homeView());
}
A.logout = () => run(async () => {
  let endpoint;
  try { const reg = await navigator.serviceWorker?.ready; endpoint = (await reg?.pushManager?.getSubscription())?.endpoint; } catch (e) { }
  await api('POST', '/api/auth/logout', { endpoint });
  me = null; unread = 0; updateBell(); authMode = 'login'; showPushBanner(); render('book');
});

// ===== Réserver (client) =====
// bk = sélection en cours ; resched = id du RDV en cours de modification
const bk = { barber: null, services: [], date: null, start: null, style: null, note: '', resched: null, slots: null, absent: [] };
let myBookings = [];
const barberById = id => pub.barbers.find(b => b.id === id);
const serviceById = id => pub.services.find(s => s.id === id);
const chosen = () => bk.services.map(serviceById).filter(Boolean);
const svcKey = () => bk.services.join(',');
const shopClosed = date => pub.rules.closed_days.includes(weekday(date));
const worksOn = (b, date) => !shopClosed(date) && b.days.some(d => d.weekday === weekday(date));
const closedTxt = () => pub.rules.closed_days.map(d => DAYS[d].toLowerCase()).join(' et ');
const loyaltyReady = () => me && me.role === 'client' && me.points >= pub.rules.loyalty_every && !myBookings.some(b => b.status === 'booked' && b.loyalty);

V.book = async () => {
  await loadPublic().catch(() => { }); // réglages à jour (jours de fermeture, horaires…) même si la page est ouverte depuis longtemps
  if (me && me.role === 'client') myBookings = await api('GET', '/api/bookings/mine').catch(() => myBookings);
  bk.services = bk.services.filter(serviceById);
  if (!bk.services.length && pub.services.length) bk.services = [(pub.services.find(s => s.loyalty) || pub.services[0]).id];
  if (bk.barber && !barberById(bk.barber)) bk.barber = null;
  if (!bk.date) bk.date = pub.today;
  // jour choisi devenu fermé : premier jour ouvert
  if (shopClosed(bk.date)) { bk.date = Array.from({ length: pub.rules.booking_days }, (_, i) => addDays(pub.today, i)).find(d => !shopClosed(d)) || bk.date; bk.start = null; bk.slots = null; }
  drawBook();
  if (bk.barber && bk.slots === null) loadSlots();
};
function drawBook() {
  const r = pub.rules, svcs = chosen(), resched = bk.resched && myBookings.find(b => b.id === bk.resched);
  const dates = Array.from({ length: r.booking_days }, (_, i) => addDays(pub.today, i));
  const b = barberById(bk.barber);
  let slotsHtml = '<p class="muted">Choisissez un barbier pour voir ses disponibilités.</p>';
  if (b) {
    const dayH = b.days.find(d => d.weekday === weekday(bk.date));
    if (shopClosed(bk.date)) slotsHtml = `<p class="card center muted">🚫 Le salon est fermé le ${DAYS[weekday(bk.date)].toLowerCase()} (repos hebdomadaire).</p>`;
    else if (!worksOn(b, bk.date)) slotsHtml = `<p class="card center muted">${esc(b.name)} ne travaille pas le ${DAYS[weekday(bk.date)].toLowerCase()}.</p>`;
    else if (bk.slots === null) slotsHtml = '<p class="muted">Chargement des créneaux…</p>';
    else {
      const free = bk.slots.filter(s => s.free);
      slotsHtml = bk.slots.length ? `<div class="slots">${bk.slots.map(s => `<button class="slot ${bk.start === s.start ? 'on' : ''}" ${s.free ? '' : 'disabled'} onclick="A.slot(${s.start})">${s.time}</button>`).join('')}</div>` : '';
      if (dayH) slotsHtml = `<p class="small muted">🕘 ${hhmm(dayH.start_min)} - ${hhmm(dayH.end_min)}${dayH.break_start != null ? ` · ☕ pause ${hhmm(dayH.break_start)} - ${hhmm(dayH.break_end)}` : ''}</p>` + slotsHtml;
      if (bk.absent.length) slotsHtml = `<p class="small muted">🚪 Absent : ${bk.absent.map(a => a.start_min === 0 && a.end_min === 1440 ? 'toute la journée' : hhmm(a.start_min) + '-' + hhmm(a.end_min)).join(', ')}</p>` + slotsHtml;
      if (!free.length) slotsHtml += `<div class="card center"><b>😕 Complet ce jour-là</b><p class="small muted">Inscrivez-vous sur la liste d'attente : vous recevez une notification dès qu'un créneau se libère.</p>
        <div class="row wrap" style="justify-content:center"><button onclick="A.wait(${b.id})">⏳ Attendre ${esc(b.name)}</button><button onclick="A.wait(0)">⏳ N'importe quel barbier</button></div></div>`;
    }
  }
  const full = svcs.reduce((t, x) => t + x.price, 0), dur = svcs.reduce((t, x) => t + x.duration, 0);
  const elig = svcs.filter(x => x.loyalty).map(x => x.price);
  const disc = loyaltyReady() && !resched && elig.length ? Math.max(...elig) * r.loyalty_discount / 100 : 0;
  const price = resched ? `<b>${DT(resched.price)}</b>` : disc ? `<span class="price-old">${DT(full)}</span><b>${DT(full - disc)}</b> <span class="pill gold">🎁 fidélité</span>` : `<b>${DT(full)}</b>`;
  const durTxt = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + pad(m % 60) : ''}` : m + ' min';
  $('m').innerHTML = `
    ${resched ? `<div class="card sel"><b>🔄 Modifier mon RDV</b><div class="small muted">Actuel : ${esc(resched.service)} avec ${esc(resched.barber)}, ${fdate(resched.date)} à ${resched.time}</div>
      <button style="margin-top:8px" onclick="A.cancelResched()">Annuler la modification</button></div>` : (me ? `<h2>Bonjour ${esc(me.name.split(' ')[0])} 👋</h2>` : `<div class="hero"><img src="/icons/logo-full.png" alt="${esc(pub.shop.name)}"><p class="muted">Choisissez votre barbier et réservez en quelques secondes ✂️</p>${pub.shop.address ? `<div class="small muted">📍 ${esc(pub.shop.address)}</div>` : ''}${pub.rules.closed_days.length ? `<div class="small muted">🚫 Fermé le ${closedTxt()}</div>` : ''}${installBtn('main')}</div>`)}
    ${resched ? '' : offersHtml()}
    <h3>1 · Barbier</h3>
    <div class="barbers">${pub.barbers.map(x => `<button class="barber ${x.id === bk.barber ? 'on' : ''}" onclick="A.barber(${x.id})"><div class="row">${avatar(x)}<span class="grow"><b>${esc(x.name)}</b>${worksOf(x.id).length ? `<span class="pf-link" onclick="event.stopPropagation();A.portfolio(${x.id})">📸 Voir ses coupes (${worksOf(x.id).length})</span>` : ''}</span></div></button>`).join('') || '<p class="muted">Aucun barbier disponible</p>'}</div>
    ${resched ? '' : `<h3>2 · Services <span class="small" style="text-transform:none;letter-spacing:0">(un ou plusieurs)</span></h3>
      <div class="services">${pub.services.map(s => `<button class="svc ${bk.services.includes(s.id) ? 'on' : ''}" onclick="A.service(${s.id})"><span class="grow">${esc(s.name)}${s.loyalty ? ' <span title="Compte pour la carte fidélité">🎁</span>' : ''}<small>${durTxt(s.duration)}</small></span><b>${DT(s.price)}</b></button>`).join('')}</div>
      <div class="total row between"><span>${svcs.length} service(s) · ${durTxt(dur)}</span><b>${DT(full)}</b></div>`}
    <h3>${resched ? 2 : 3} · Jour</h3>
    <div class="chips">${dates.map((d, i) => {
      const off = shopClosed(d) || (b && !worksOn(b, d)), dt = new Date(d + 'T12:00');
      return `<button class="chip ${d === bk.date ? 'on' : ''}" ${off ? 'disabled' : ''} onclick="A.date('${d}')">${i === 0 ? 'Auj.' : i === 1 ? 'Dem.' : DAYS[dt.getDay()].slice(0, 3)}<b>${dt.getDate()}</b></button>`;
    }).join('')}</div>
    <h3>${resched ? 3 : 4} · Heure${b ? ' avec ' + esc(b.name) : ''}</h3>${slotsHtml}
    ${resched ? '' : `${pub.styles.length ? `<h3>5 · Style souhaité (facultatif)</h3>
      <div class="styles"><div class="photo ${!bk.style ? 'on' : ''}" onclick="A.style(0)"><div class="none">Aucun</div><div class="cap">Pas de style</div></div>
      ${[...pub.styles].sort((a, c) => (c.barber_id === bk.barber) - (a.barber_id === bk.barber)).map(s => `<div class="photo ${bk.style === s.id ? 'on' : ''}" onclick="A.style(${s.id})"><img src="/uploads/${esc(s.file)}" alt="" loading="lazy"><div class="cap">${esc(s.title)}</div></div>`).join('')}</div>` : ''}
      <label>Remarque pour le barbier (facultatif)</label><textarea id="bk_note" maxlength="200" placeholder="Ex : dégradé bas, garder la longueur sur le dessus…" oninput="bk.note=this.value">${esc(bk.note)}</textarea>`}
    ${svcs.length && bk.start !== null ? `<div class="card sel"><div class="row between"><span>${esc(resched ? resched.service : svcs.map(x => x.name).join(' + '))} · ${esc(b.name)}<div class="small muted">${fdate(bk.date)} à ${hhmm(bk.start)}</div></span><span>${price}</span></div></div>` : ''}
    <button class="main" id="bk_go" ${bk.start === null || !svcs.length ? 'disabled' : ''} onclick="A.confirm()">${resched ? 'Valider le nouveau créneau' : 'Confirmer la réservation'}</button>
    <p id="bk_err" class="err"></p>
    <p class="small muted center">Annulation ou modification gratuite jusqu'à ${r.cancel_hours} h avant · rappel ${r.reminder_minutes >= 60 ? r.reminder_minutes / 60 + ' h' : r.reminder_minutes + ' min'} avant</p>`;
}
// lien de téléchargement de l'application Android (pas affiché dans l'application elle-même)
const offerCard = o => `<div class="offer"><b>🔥 ${esc(o.title)}</b>${o.description ? `<div>${esc(o.description)}</div>` : ''}${o.ends_on ? `<div class="small">Jusqu'au ${fdate(o.ends_on)}</div>` : ''}</div>`;
const offersHtml = () => pub.offers.length ? `<h3>Offres du moment</h3>${pub.offers.map(offerCard).join('')}` : '';

async function loadSlots() {
  const b = barberById(bk.barber);
  if (!b || !worksOn(b, bk.date)) { bk.slots = []; bk.absent = []; return drawBook(); }
  if (!bk.resched && !bk.services.length) { bk.slots = []; return drawBook(); }
  const want = `${bk.barber}|${bk.date}|${svcKey()}`;
  bk.slots = null; drawBook();
  const r = await api('GET', `/api/slots?barber_id=${bk.barber}&date=${bk.date}&${bk.resched ? 'ignore=' + bk.resched : 'service_ids=' + svcKey()}`).catch(e => { toast('⚠️ ' + e.message); return { slots: [], absent: [] }; });
  if (want !== `${bk.barber}|${bk.date}|${svcKey()}` || view !== 'book') return; // la sélection a changé entre-temps
  bk.slots = r.slots; bk.absent = r.absent || [];
  if (!bk.slots.some(s => s.start === bk.start && s.free)) bk.start = null;
  drawBook();
}
A.barber = id => { bk.barber = id; bk.start = null; bk.slots = null; loadSlots(); };
A.service = id => {
  bk.services = bk.services.includes(id) ? bk.services.filter(x => x !== id) : [...bk.services, id];
  bk.start = null; bk.slots = null; loadSlots();
};
A.date = d => { bk.date = d; bk.start = null; bk.slots = null; loadSlots(); };
A.slot = s => { bk.start = s; drawBook(); $('bk_go').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
A.style = id => { bk.style = id || null; drawBook(); };
A.cancelResched = () => { bk.resched = null; bk.start = null; bk.slots = null; render('mine'); };
A.confirm = () => run(async () => {
  if (!me) { afterLogin = true; authMode = 'reg'; render('auth'); return; }
  if (me.role !== 'client') throw new Error('Les réservations se font avec un compte client');
  $('bk_go').disabled = true;
  try {
    if (bk.resched) {
      await api('POST', `/api/bookings/${bk.resched}/reschedule`, { barber_id: bk.barber, date: bk.date, start: bk.start });
      toast('✅ Rendez-vous déplacé');
    } else {
      await api('POST', '/api/bookings', { barber_id: bk.barber, service_ids: bk.services, date: bk.date, start: bk.start, style_id: bk.style, note: bk.note });
      toast('✅ Réservation confirmée ! Vous recevrez un rappel avant le rendez-vous.');
    }
  } catch (e) {
    bk.slots = null; loadSlots(); // le créneau a peut-être été pris : on rafraîchit
    throw e;
  }
  Object.assign(bk, { start: null, style: null, note: '', resched: null, slots: null });
  render('mine');
}, 'bk_err');
A.wait = barberId => run(async () => {
  if (!me) { afterLogin = true; authMode = 'reg'; render('auth'); return; }
  await api('POST', '/api/waitlist', { barber_id: barberId || null, date: bk.date });
  toast(`✅ Vous êtes sur la liste d'attente du ${fdate(bk.date)}. On vous prévient dès qu'une place se libère.`);
});

// ===== Mes rendez-vous (client) =====
let cfmCancel = null;
V.mine = async () => {
  const [list, wl] = await Promise.all([api('GET', '/api/bookings/mine'), api('GET', '/api/waitlist')]);
  myBookings = list;
  const up = list.filter(b => b.upcoming).reverse();
  const past = list.filter(b => !up.includes(b));
  const card = b => `<div class="card ${b.status === 'cancelled' ? 'dim' : ''}"><div class="row">
      ${b.style_file ? `<img class="thumb" src="/uploads/${esc(b.style_file)}" alt="">` : `<span class="avatar">${esc(initials(b.barber))}</span>`}
      <div class="grow"><b>${esc(b.service)}</b> · ${esc(b.barber)}<div class="small muted">${fdate(b.date)} à ${b.time}${b.style_title ? ' · ' + esc(b.style_title) : ''}</div></div>
      <div style="text-align:right">${b.loyalty ? `<div class="price-old small">${DT(b.full_price)}</div>` : ''}<b>${DT(b.price)}</b><div>${pill(b.status)}</div></div></div>
      ${b.loyalty && b.status === 'booked' ? `<div class="small" style="margin-top:6px">🎁 Réduction fidélité -${pub.rules.loyalty_discount} %</div>` : ''}
      ${b.note ? `<div class="small muted" style="margin-top:6px">📝 ${esc(b.note)}</div>` : ''}
      ${up.includes(b) ? (b.can_change ? `<div class="row" style="margin-top:10px;justify-content:flex-end">
          <button onclick="A.resched(${b.id})">🔄 Modifier</button><button class="danger" onclick="A.cancel(${b.id})">${cfmCancel === b.id ? 'Confirmer l\'annulation ?' : 'Annuler'}</button></div>`
        : `<div class="small muted" style="margin-top:8px">Moins de ${pub.rules.cancel_hours} h avant : pour annuler, appelez le salon${pub.shop.phone ? ` (<a href="tel:${esc(pub.shop.phone)}">${esc(pub.shop.phone)}</a>)` : ''}.</div>`) : ''}
    </div>`;
  $('m').innerHTML = `<h2>Mes rendez-vous</h2>
    ${up.length ? up.map(card).join('') : `<div class="card center"><p>Aucun rendez-vous à venir.</p><button class="main" onclick="render('book')">Réserver maintenant</button></div>`}
    ${wl.length ? `<h3>⏳ Liste d'attente</h3>${wl.map(w => `<div class="card row"><div class="grow">${fdate(w.date)} · ${w.barber ? esc(w.barber) : "n'importe quel barbier"}
        <div class="small ${w.notified ? 'okt' : 'muted'}">${w.notified ? '✅ Une place s\'est libérée : réservez vite !' : 'En attente d\'une place…'}</div></div>
        ${w.notified ? `<button onclick="A.fromWait(${w.barber_id || 0},'${w.date}')">Réserver</button>` : ''}<button class="danger" onclick="A.unwait(${w.id})">✕</button></div>`).join('')}` : ''}
    ${past.length ? `<h3>Historique</h3>${past.map(card).join('')}` : ''}`;
};
A.cancel = id => run(async () => {
  if (cfmCancel !== id) { cfmCancel = id; return V.mine(); }
  cfmCancel = null;
  await api('POST', `/api/bookings/${id}/cancel`);
  toast('Rendez-vous annulé');
  V.mine();
});
A.resched = id => {
  const b = myBookings.find(x => x.id === id);
  Object.assign(bk, { resched: id, barber: b.barber_id, date: b.date, start: null, slots: null });
  render('book');
};
A.unwait = id => run(async () => { await api('DELETE', '/api/waitlist/' + id); V.mine(); });
A.fromWait = (barberId, date) => { Object.assign(bk, { barber: barberId || null, date, start: null, slots: null, resched: null }); render('book'); };

// ===== Fidélité (client) =====
V.loyalty = async () => {
  me = await api('GET', '/api/me');
  const r = pub.rules, n = Math.min(me.points, r.loyalty_every), ready = me.points >= r.loyalty_every;
  $('m').innerHTML = `<h2>Ma carte fidélité</h2><div class="card center">
    <div class="stamps">${Array.from({ length: r.loyalty_every }, (_, i) => `<div class="stamp ${i < n ? 'on' : ''}">${i < n ? '✂️' : ''}</div>`).join('')}<div class="stamp gift">-${r.loyalty_discount}%</div></div>
    ${ready ? `<h2>🎉 Votre prochaine coupe est à -${r.loyalty_discount} % !</h2><p class="muted">La réduction s'applique automatiquement à votre prochaine réservation.</p><button class="main" onclick="render('book')">Réserver maintenant</button>`
      : `<p><b>${n} / ${r.loyalty_every}</b> coupes</p><p class="muted">Encore ${r.loyalty_every - n} coupe(s) et la suivante est à <b>-${r.loyalty_discount} %</b>.</p>`}
    </div><p class="small muted center">Un point est ajouté à chaque coupe (${pub.services.filter(s => s.loyalty).map(s => esc(s.name)).join(', ') || 'services 🎁'}) validée par le barbier. La réduction s'applique sur la coupe.</p>`;
};

// ===== Portfolios des barbiers =====
const worksOf = id => pub.styles.filter(s => s.barber_id === id);
const photoGrid = (list, del) => `<div class="gallery">${list.map(s => `<div class="photo" onclick="A.zoom(${s.id})" style="cursor:pointer">
  <img src="/uploads/${esc(s.file)}" alt="${esc(s.title)}" loading="lazy"><div class="cap"><b>${esc(s.title)}</b></div>
  ${del && del(s) ? `<button class="del danger" onclick="event.stopPropagation();A.delPhoto(${s.id})">🗑</button>` : ''}</div>`).join('') || '<p class="muted">Aucune photo pour le moment.</p>'}</div>`;
let gFilter = 0, pfId = null;
// clients et visiteurs : les barbiers et leurs coupes ; barbiers : leur portfolio
V.gallery = () => {
  if (me && me.role !== 'client') return V.myPortfolio();
  $('m').innerHTML = `<h2>Nos barbiers</h2><p class="muted small">Découvrez le travail de chaque barbier, puis réservez avec celui qui vous plaît.</p>
    ${pub.barbers.map(b => `<div class="card pf-card" onclick="A.portfolio(${b.id})">${avatar(b, 'lg')}<div class="grow"><b>${esc(b.name)}</b>${b.bio ? `<div class="small muted">${esc(b.bio)}</div>` : ''}
      <div class="pf-strip">${worksOf(b.id).slice(0, 4).map(s => `<img src="/uploads/${esc(s.file)}" alt="" loading="lazy">`).join('') || '<span class="small muted">Photos bientôt disponibles</span>'}</div></div><span class="muted">›</span></div>`).join('')}
    <h3>Toutes les coupes</h3>
    <div class="chips"><button class="chip ${!gFilter ? 'on' : ''}" onclick="A.gFilter(0)">Tous</button>${pub.barbers.map(b => `<button class="chip ${gFilter === b.id ? 'on' : ''}" onclick="A.gFilter(${b.id})">${esc(b.name)}</button>`).join('')}</div>
    ${photoGrid(gFilter ? worksOf(gFilter) : pub.styles)}`;
};
A.gFilter = id => { gFilter = id; V.gallery(); };
A.portfolio = id => { pfId = id; render('portfolio'); };
V.portfolio = () => {
  const b = barberById(pfId);
  if (!b) return render('gallery');
  const h = WEEK.map(wd => b.days.find(d => d.weekday === wd)).filter(d => d && !pub.rules.closed_days.includes(d.weekday));
  $('m').innerHTML = `<button class="back" onclick="render('gallery')">‹ Tous les barbiers</button>
    <div class="pf-head">${avatar(b, 'xl')}<h2>${esc(b.name)}</h2>${b.bio ? `<p class="muted">${esc(b.bio)}</p>` : ''}
      <div class="small muted">🗓️ ${h.map(d => DAYS[d.weekday].slice(0, 3)).join(' · ') || '—'} · 📸 ${worksOf(b.id).length} coupe(s)</div></div>
    ${me && me.role !== 'client' ? '' : `<button class="main" onclick="A.bookWith(${b.id})">📅 Réserver avec ${esc(b.name)}</button>`}
    <h3>Ses coupes</h3>${photoGrid(worksOf(b.id))}`;
};
A.bookWith = id => { Object.assign(bk, { barber: id, resched: null, start: null, slots: null }); render('book'); };
// photo en grand
A.zoom = id => {
  const s = pub.styles.find(x => x.id === id); if (!s) return;
  const client = !me || me.role === 'client';
  const lb = $('lb'); lb.hidden = false;
  lb.innerHTML = `<div class="lb-box" onclick="event.stopPropagation()"><img src="/uploads/${esc(s.file)}" alt="">
    <div class="row between" style="margin-top:10px"><div><b>${esc(s.title)}</b>${s.barber ? `<div class="small muted">✂️ ${esc(s.barber)}</div>` : ''}</div>
    ${client ? `<button class="small-btn" onclick="$('lb').hidden=true;A.bookStyle(${s.id})">Je veux ce style</button>` : ''}</div></div>`;
};
// barbier : son portfolio (photo, présentation, coupes) ; l'admin peut gérer celui de chaque barbier
let myPf = null;
V.myPortfolio = () => {
  const id = me.role === 'admin' ? (myPf || me.id) : me.id;
  const b = barberById(id) || { id, name: me.name, photo: null, bio: '' };
  $('m').innerHTML = `<h2>${id === me.id ? 'Mon portfolio' : 'Portfolio de ' + esc(b.name)}</h2>
    ${me.role === 'admin' ? `<div class="chips">${pub.barbers.map(x => `<button class="chip ${x.id === id ? 'on' : ''}" onclick="A.myPf(${x.id})">${esc(x.name)}</button>`).join('')}</div>` : ''}
    <div class="card"><div class="row">${avatar(b, 'lg')}<div class="grow"><b>Photo de profil</b><div class="small muted">Visible par les clients sur votre carte</div></div></div>
      <div class="row wrap" style="margin-top:10px"><label class="filebtn">📷 Choisir une photo<input type="file" accept="image/*" hidden onchange="A.pfPhoto(this.files[0])"></label>${b.photo ? '<button class="danger" onclick="A.pfPhoto(null)">Retirer</button>' : ''}</div>
      <label>Présentation (facultatif)</label><textarea id="pf_bio" maxlength="200" placeholder="Ex : 8 ans d'expérience, spécialiste des dégradés et de la barbe">${esc(b.bio || '')}</textarea>
      <button class="main" onclick="A.pfBio()">Enregistrer</button><p id="pf_err" class="err"></p></div>
    <button onclick="A.portfolio(${id})">👁 Voir comme un client</button>
    <div class="card"><b>📸 Ajouter une coupe</b>
      <label>Nom du style</label><input id="g_t" maxlength="60" placeholder="Ex : Dégradé américain">
      <label>Photo</label><input id="g_f" type="file" accept="image/*">
      <button class="main" id="g_go" onclick="A.addPhoto()">Publier</button><p id="g_err" class="err"></p></div>
    <h3>Coupes publiées (${worksOf(id).length})</h3>${photoGrid(worksOf(id), () => true)}`;
};
A.myPf = id => { myPf = id; V.myPortfolio(); };
const pfTarget = () => me.role === 'admin' ? (myPf || me.id) : me.id;
A.pfPhoto = file => run(async () => {
  await api('PUT', '/api/staff/profile', file ? { barber_id: pfTarget(), photo: await shrink(file, 600) } : { barber_id: pfTarget(), remove_photo: true });
  await loadPublic(); V.myPortfolio(); toast(file ? '✅ Photo de profil enregistrée' : 'Photo retirée');
}, 'pf_err');
A.pfBio = () => run(async () => {
  await api('PUT', '/api/staff/profile', { barber_id: pfTarget(), bio: $('pf_bio').value });
  await loadPublic(); toast('✅ Présentation enregistrée');
}, 'pf_err');
A.bookStyle = id => { const s = pub.styles.find(x => x.id === id); Object.assign(bk, { style: id, resched: null, start: null, slots: null }); if (s.barber_id && barberById(s.barber_id)) bk.barber = s.barber_id; render('book'); };
// réduit la photo dans le navigateur avant l'envoi (plus rapide, moins de stockage)
const shrink = (file, max = 1080) => new Promise((ok, ko) => {
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src); ok(c.toDataURL('image/jpeg', 0.82));
  };
  img.onerror = () => ko(new Error('Image illisible'));
  img.src = URL.createObjectURL(file);
});
A.addPhoto = () => run(async () => {
  const f = $('g_f').files[0];
  if (!f) throw new Error('Choisissez une photo');
  $('g_go').disabled = true;
  try { await api('POST', '/api/staff/styles', { title: $('g_t').value, image: await shrink(f), barber_id: pfTarget() }); }
  finally { if ($('g_go')) $('g_go').disabled = false; }
  await loadPublic(); V.myPortfolio(); toast('✅ Coupe ajoutée au portfolio');
}, 'g_err');
A.delPhoto = id => run(async () => {
  if (!confirm('Supprimer cette photo ?')) return;
  await api('DELETE', '/api/staff/styles/' + id); await loadPublic(); V.myPortfolio();
});

// ===== Planning (barbier / admin) =====
let plDate = null, plBarber = 0, cfmAct = null;
V.planning = async () => {
  plDate = plDate || pub.today;
  const list = await api('GET', `/api/staff/bookings?date=${plDate}${plBarber ? '&barber_id=' + plBarber : ''}`);
  const active = list.filter(b => b.status !== 'cancelled');
  const total = active.filter(b => b.status !== 'no_show').reduce((s, b) => s + b.price, 0);
  $('m').innerHTML = `<h2>Planning</h2>
    <div class="row"><button onclick="A.plDay(-1)">◀</button><input type="date" value="${plDate}" onchange="A.plSet(this.value)" class="grow"><button onclick="A.plDay(1)">▶</button>
    ${plDate !== pub.today ? `<button onclick="A.plSet('${pub.today}')">Auj.</button>` : ''}</div>
    ${me.role === 'admin' ? `<div class="chips" style="margin-top:10px"><button class="chip ${!plBarber ? 'on' : ''}" onclick="A.plBarber(0)">Tous</button>${pub.barbers.map(b => `<button class="chip ${plBarber === b.id ? 'on' : ''}" onclick="A.plBarber(${b.id})">${esc(b.name)}</button>`).join('')}</div>` : ''}
    <p class="muted">${fdate(plDate)} · ${active.length} RDV · ${DT(total)}</p>
    ${list.map(b => `<div class="card ${b.status === 'cancelled' ? 'dim' : ''}">
      <div class="row"><b style="font-size:18px">${b.time}</b><span class="muted small">→ ${b.end}</span><span class="grow"></span>${pill(b.status)}</div>
      <div class="row" style="margin-top:8px">${b.style_file ? `<a href="/uploads/${esc(b.style_file)}" target="_blank"><img class="thumb" src="/uploads/${esc(b.style_file)}" alt=""></a>` : ''}
        <div class="grow"><b>${esc(b.client)}</b> <a class="small" href="tel:${esc(b.client_phone)}">📞 ${esc(b.client_phone)}</a>
        <div>${esc(b.service)}${b.style_title ? ' · 💈 ' + esc(b.style_title) : ''}${me.role === 'admin' && !plBarber ? ` · ✂️ ${esc(b.barber)}` : ''}</div>
        <div class="small">${b.loyalty ? `<span class="price-old">${DT(b.full_price)}</span><b>${DT(b.price)}</b> 🎁 fidélité` : `<b>${DT(b.price)}</b>`} · <span class="muted">${b.client_points}/${pub.rules.loyalty_every} pts</span></div></div></div>
      ${b.note ? `<div class="small" style="margin-top:6px">📝 ${esc(b.note)}</div>` : ''}
      ${b.status === 'booked' ? `<div class="row wrap" style="margin-top:10px;justify-content:flex-end">
        <button class="ok" onclick="A.status(${b.id},'done')">✓ Terminé</button><button onclick="A.status(${b.id},'no_show')">${cfmAct === b.id + 'no_show' ? 'Confirmer absent ?' : '🚫 Absent'}</button>
        <button class="danger" onclick="A.status(${b.id},'cancelled')">${cfmAct === b.id + 'cancelled' ? 'Confirmer ?' : 'Annuler'}</button></div>` : ''}
    </div>`).join('') || '<p class="card center muted">Aucun rendez-vous ce jour-là.</p>'}`;
};
A.plDay = n => { plDate = addDays(plDate, n); V.planning(); };
A.plSet = d => { if (d) { plDate = d; V.planning(); } };
A.plBarber = id => { plBarber = id; V.planning(); };
A.status = (id, st) => run(async () => {
  if (st !== 'done' && cfmAct !== id + st) { cfmAct = id + st; return V.planning(); }
  cfmAct = null;
  await api('POST', `/api/staff/bookings/${id}/status`, { status: st });
  toast(st === 'done' ? '✅ Terminé, point fidélité ajouté' : st === 'no_show' ? 'Marqué absent' : 'RDV annulé, client prévenu');
  V.planning();
});

// ===== Absences (barbier / admin) =====
V.absences = async () => {
  const list = await api('GET', '/api/staff/absences');
  $('m').innerHTML = `<h2>Absences</h2><div class="card"><p class="small muted">Pendant une absence, les clients ne peuvent pas réserver.</p>
    ${me.role === 'admin' ? `<label>Barbier</label><select id="ab_b">${pub.barbers.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select>` : ''}
    <label>Jour</label><input id="ab_d" type="date" min="${pub.today}" value="${pub.today}">
    <label class="row" style="color:var(--fg)"><input type="checkbox" id="ab_full" onchange="$('ab_h').hidden=this.checked"> Toute la journée</label>
    <div id="ab_h" class="row"><div class="grow"><label>De</label><input id="ab_f" type="time" value="12:00"></div><div class="grow"><label>À</label><input id="ab_t" type="time" value="14:00"></div></div>
    <label>Motif (facultatif)</label><input id="ab_r" maxlength="80" placeholder="Ex : pause déjeuner, congé…">
    <button class="main" onclick="A.addAbs()">Ajouter l'absence</button><p id="ab_err" class="err"></p></div>
    ${list.map(a => `<div class="card row"><div class="grow"><b>${fdate(a.date)}</b>${me.role === 'admin' ? ' · ' + esc(a.barber) : ''}
      <div class="small muted">${a.start_min === 0 && a.end_min === 1440 ? 'Toute la journée' : a.from + ' - ' + a.to}${a.reason ? ' · ' + esc(a.reason) : ''}</div></div>
      <button class="danger" onclick="A.delAbs(${a.id})">🗑</button></div>`).join('') || '<p class="muted center">Aucune absence prévue.</p>'}`;
};
A.addAbs = () => run(async () => {
  const full = $('ab_full').checked;
  const r = await api('POST', '/api/staff/absences', { barber_id: $('ab_b') ? +$('ab_b').value : undefined, date: $('ab_d').value, from: full ? '' : $('ab_f').value, to: full ? '' : $('ab_t').value, reason: $('ab_r').value });
  await V.absences();
  toast(r.clash ? `⚠️ Absence ajoutée, mais ${r.clash} RDV déjà pris pendant ce temps : vérifiez le planning` : '✅ Absence ajoutée');
}, 'ab_err');
A.delAbs = id => run(async () => { await api('DELETE', '/api/staff/absences/' + id); V.absences(); });

// ===== Horaires : jours de travail, heures et pause de chaque jour =====
const WEEK = [1, 2, 3, 4, 5, 6, 0];
function hoursEditor(days) {
  return `<div class="days">${WEEK.map(wd => {
    const h = days.find(d => d.weekday === wd);
    if (pub.rules.closed_days.includes(wd)) return `<div class="day off"><b>${DAYS[wd]}</b><span class="pill">🚫 Repos hebdomadaire</span></div>`;
    return `<div class="day ${h ? '' : 'rest'}">
      <label class="row" style="margin:0;color:var(--fg)"><input type="checkbox" id="w_${wd}" ${h ? 'checked' : ''} onchange="this.closest('.day').classList.toggle('rest',!this.checked)"><b class="grow">${DAYS[wd]}</b><span class="small muted rest-txt">Repos</span></label>
      <div class="dayf"><div class="row"><span class="lbl">🕘 Travail</span><input type="time" id="wf_${wd}" value="${h ? hhmm(h.start_min) : '09:00'}"><span>→</span><input type="time" id="wt_${wd}" value="${h ? hhmm(h.end_min) : '20:00'}"></div>
      <div class="row"><span class="lbl">☕ Pause</span><input type="time" id="pf_${wd}" value="${h && h.break_start != null ? hhmm(h.break_start) : ''}"><span>→</span><input type="time" id="pt_${wd}" value="${h && h.break_end != null ? hhmm(h.break_end) : ''}"></div></div></div>`;
  }).join('')}</div>
  <button style="margin-top:4px" onclick="A.copyDay()">📋 Copier les heures du premier jour sur les autres jours</button>
  <p class="small muted">La pause est facultative : laissez-la vide si vous n'en prenez pas ce jour-là.</p>`;
}
const readHours = () => WEEK.filter(wd => $('w_' + wd)?.checked)
  .map(wd => ({ weekday: wd, from: $('wf_' + wd).value, to: $('wt_' + wd).value, break_from: $('pf_' + wd).value, break_to: $('pt_' + wd).value }));
A.copyDay = () => {
  const on = WEEK.filter(wd => $('w_' + wd)?.checked);
  if (!on.length) return toast('Cochez au moins un jour de travail');
  for (const wd of on.slice(1)) for (const k of ['wf_', 'wt_', 'pf_', 'pt_']) $(k + wd).value = $(k + on[0]).value;
  toast(`Heures de ${DAYS[on[0]].toLowerCase()} copiées : pensez à enregistrer`);
};
const clashMsg = n => n ? `⚠️ Horaires enregistrés. ${n} RDV déjà pris tombent hors des nouvelles heures ou pendant la pause : vérifiez le planning.` : '<span class="okt">✅ Horaires enregistrés</span>';
V.hours = async () => {
  const days = await api('GET', '/api/staff/hours');
  $('m').innerHTML = `<h2>Mes horaires</h2><p class="small muted">Choisissez vos jours de travail, vos heures et votre pause. Les clients réservent uniquement pendant vos heures, jamais pendant la pause.</p>
    ${hoursEditor(days)}<button class="main" onclick="A.myHoursSave()">Enregistrer mes horaires</button><p id="h_err" class="err"></p>`;
};
A.myHoursSave = () => run(async () => {
  const r = await api('PUT', '/api/staff/hours', { days: readHours() });
  await loadPublic(); $('h_err').innerHTML = clashMsg(r.clash);
}, 'h_err');

// ===== Équipe (admin) =====
let teamEdit = null;
V.team = async () => {
  const list = await api('GET', '/api/admin/barbers');
  $('m').innerHTML = `<h2>Équipe</h2>${list.map(b => {
    const open = teamEdit === b.id;
    const days = WEEK.map(wd => ({ wd, h: !pub.rules.closed_days.includes(wd) && b.days.find(d => d.weekday === wd) }));
    return `<div class="card ${b.active ? '' : 'dim'}"><div class="row">${avatar(b)}
      <div class="grow"><b>${esc(b.name)}</b> ${b.role === 'admin' ? '<span class="pill gold">Admin</span>' : ''}${b.active ? '' : ' <span class="pill bad">Désactivé</span>'}
      <div class="small muted">📞 ${esc(b.phone)} · ${days.filter(d => d.h).map(d => DAYS[d.wd].slice(0, 3)).join(' ') || 'aucun jour'}</div></div>
      <button onclick="A.teamEdit(${b.id})">${open ? 'Fermer' : 'Modifier'}</button></div>
      ${open ? `<label>Nom</label><input id="t_n" value="${esc(b.name)}">
        <label>Nouveau mot de passe (laisser vide pour ne pas changer)</label><input id="t_p" type="text" autocomplete="off">
        ${b.id !== me.id ? `<label class="row" style="color:var(--fg)"><input type="checkbox" id="t_a" ${b.active ? 'checked' : ''}> Compte actif (visible pour les réservations)</label>` : ''}
        <button class="main" onclick="A.teamSave(${b.id},${b.active})">Enregistrer</button>
        <h3>Horaires et pause</h3>${hoursEditor(b.days)}
        <button class="main" onclick="A.hoursSave(${b.id})">Enregistrer les horaires</button><p id="t_err" class="err"></p>` : ''}</div>`;
  }).join('')}
  <h3>➕ Ajouter un barbier</h3><div class="card">
    <label>Nom</label><input id="nb_n"><label>Téléphone (identifiant de connexion)</label><input id="nb_t" type="tel">
    <label>Mot de passe provisoire</label><input id="nb_p" type="text" autocomplete="off">
    <button class="main" onclick="A.teamAdd()">Ajouter</button><p id="nb_err" class="err"></p>
    <p class="small muted">Ses horaires de départ sont les vôtres : modifiez-les ensuite si besoin.</p></div>`;
};
A.teamEdit = id => { teamEdit = teamEdit === id ? null : id; V.team(); };
A.teamSave = (id, wasActive) => run(async () => {
  const active = $('t_a') ? $('t_a').checked : true;
  if (wasActive && !active && !confirm('Désactiver ce barbier ? Ses rendez-vous à venir seront annulés et les clients prévenus.')) return;
  const r = await api('PUT', '/api/admin/barbers/' + id, { name: $('t_n').value, password: $('t_p').value || undefined, active });
  await loadPublic(); await V.team();
  toast('✅ Enregistré' + (r.cancelled ? ` · ${r.cancelled} RDV annulé(s), clients prévenus` : ''));
}, 't_err');
A.hoursSave = id => run(async () => {
  const r = await api('PUT', `/api/admin/barbers/${id}/hours`, { days: readHours() });
  await loadPublic();
  $('t_err').innerHTML = clashMsg(r.clash);
}, 't_err');
A.teamAdd = () => run(async () => {
  await api('POST', '/api/admin/barbers', { name: $('nb_n').value, phone: $('nb_t').value, password: $('nb_p').value });
  await loadPublic(); await V.team(); toast('✅ Barbier ajouté : il se connecte avec son téléphone et ce mot de passe');
}, 'nb_err');

// ===== Offres (admin) : chaque offre publiée est envoyée à tous les clients =====
V.offers = async () => {
  const list = await api('GET', '/api/admin/offers');
  $('m').innerHTML = `<h2>Offres</h2><div class="card"><p class="small muted">Tous les clients reçoivent l'offre en notification sur leur téléphone, et elle s'affiche sur la page de réservation.</p>
    <label>Titre</label><input id="of_t" maxlength="80" placeholder="Ex : -20 % sur Coupe + Barbe">
    <label>Description (facultatif)</label><textarea id="of_d" maxlength="300" placeholder="Ex : Valable du mardi au jeudi, sur réservation dans l'application"></textarea>
    <label>Valable jusqu'au (facultatif)</label><input id="of_e" type="date" min="${pub.today}">
    <button class="main" id="of_go" onclick="A.addOffer()">📣 Publier et prévenir les clients</button><p id="of_err" class="err"></p></div>
    ${list.map(o => `<div class="card row ${o.expired ? 'dim' : ''}"><div class="grow"><b>🔥 ${esc(o.title)}</b>${o.description ? `<div class="small">${esc(o.description)}</div>` : ''}
      <div class="small muted">Publiée le ${new Date(o.created_at.replace(' ', 'T')).toLocaleDateString('fr-FR')}${o.ends_on ? ` · ${o.expired ? 'terminée le' : "jusqu'au"} ${new Date(o.ends_on + 'T12:00').toLocaleDateString('fr-FR')}` : ''}</div></div>
      <button class="danger" onclick="A.delOffer(${o.id})">🗑</button></div>`).join('') || '<p class="muted center">Aucune offre publiée.</p>'}`;
};
A.addOffer = () => run(async () => {
  if (!$('of_t').value.trim()) throw new Error("Donnez un titre à l'offre");
  if (!confirm('Publier cette offre et envoyer une notification à tous les clients ?')) return;
  $('of_go').disabled = true;
  try {
    const r = await api('POST', '/api/admin/offers', { title: $('of_t').value, description: $('of_d').value, ends_on: $('of_e').value || null });
    await loadPublic(); await V.offers();
    toast(`✅ Offre publiée : ${r.sent} client(s) prévenu(s)`);
  } finally { if ($('of_go')) $('of_go').disabled = false; }
}, 'of_err');
A.delOffer = id => run(async () => {
  if (!confirm('Supprimer cette offre ? Elle ne sera plus affichée aux clients.')) return;
  await api('DELETE', '/api/admin/offers/' + id); await loadPublic(); V.offers();
});

// ===== Services (admin) =====
V.services = async () => {
  const list = await api('GET', '/api/admin/services');
  const form = (s, id) => `<div class="row wrap"><input id="${id}_n" class="grow" style="min-width:140px" value="${esc(s.name || '')}" placeholder="Nom">
    <input id="${id}_d" type="number" step="15" min="15" style="width:90px" value="${s.duration || 30}" title="Durée (min)"><span class="small muted">min</span>
    <input id="${id}_p" type="number" step="0.5" min="0" style="width:90px" value="${s.price ?? ''}" placeholder="Prix"><span class="small muted">DT</span></div>`;
  $('m').innerHTML = `<h2>Services et tarifs</h2><p class="small muted">🎁 Fidélité : le service donne un point et peut être à -${pub.rules.loyalty_discount} % (mettez-le sur les coupes).</p>${list.map(s => `<div class="card ${s.active ? '' : 'dim'}">${form(s, 's' + s.id)}
    <div class="row" style="margin-top:8px"><label class="row grow" style="margin:0;color:var(--fg)"><input type="checkbox" id="s${s.id}_a" ${s.active ? 'checked' : ''}> Proposé aux clients</label>
    <label class="row" style="margin:0;color:var(--fg)"><input type="checkbox" id="s${s.id}_l" ${s.loyalty ? 'checked' : ''}> 🎁 Fidélité</label>
    <button onclick="A.svcSave(${s.id})">Enregistrer</button></div></div>`).join('')}
    <h3>➕ Nouveau service</h3><div class="card">${form({}, 'ns')}<label class="row" style="color:var(--fg)"><input type="checkbox" id="ns_l"> 🎁 Compte pour la fidélité</label><button class="main" onclick="A.svcAdd()">Ajouter</button></div><p id="sv_err" class="err"></p>`;
};
const svcBody = id => ({ name: $(id + '_n').value, duration: +$(id + '_d').value, price: +$(id + '_p').value, active: $(id + '_a') ? $(id + '_a').checked : true, loyalty: $(id + '_l') ? $(id + '_l').checked : false });
A.svcSave = id => run(async () => { await api('PUT', '/api/admin/services/' + id, svcBody('s' + id)); await loadPublic(); await V.services(); toast('✅ Service enregistré'); }, 'sv_err');
A.svcAdd = () => run(async () => { await api('POST', '/api/admin/services', svcBody('ns')); await loadPublic(); await V.services(); toast('✅ Service ajouté'); }, 'sv_err');

// ===== Clients (admin) =====
let clients = [];
V.clients = async () => {
  clients = await api('GET', '/api/admin/clients');
  $('m').innerHTML = `<h2>Clients (${clients.length})</h2><input id="cl_q" type="search" placeholder="🔎 Nom ou téléphone" oninput="A.clFilter()"><div id="cl_l"></div>`;
  A.clFilter();
};
A.clFilter = () => {
  const q = ($('cl_q').value || '').toLowerCase().trim(), every = pub.rules.loyalty_every;
  $('cl_l').innerHTML = clients.filter(c => !q || c.name.toLowerCase().includes(q) || c.phone.includes(q)).map(c => `<div class="card row">
    <span class="avatar">${esc(initials(c.name))}</span><div class="grow"><b>${esc(c.name)}</b> <a class="small" href="tel:${esc(c.phone)}">${esc(c.phone)}</a>
    <div class="small muted">${c.visits || 0} visite(s)${c.no_shows ? ` · <span style="color:var(--warn)">${c.no_shows} absence(s)</span>` : ''}${c.last_visit ? ' · dernière : ' + new Date(c.last_visit + 'T12:00').toLocaleDateString('fr-FR') : ''}</div></div>
    <span class="pill ${c.points >= every ? 'gold' : ''}">🎁 ${Math.min(c.points, every)}/${every}</span></div>`).join('') || '<p class="muted center">Aucun client</p>';
};

// ===== Plus (admin) : statistiques, réglages =====
V.more = async () => {
  const [st, s] = await Promise.all([api('GET', '/api/admin/stats'), api('GET', '/api/admin/settings')]);
  $('m').innerHTML = `<h2>Ce mois-ci</h2><div class="stats">
    <div class="stat"><span class="muted small">Chiffre d'affaires</span><b>${DT(st.month_revenue)}</b></div>
    <div class="stat"><span class="muted small">Coupes</span><b>${st.month_visits}</b></div>
    <div class="stat"><span class="muted small">RDV aujourd'hui</span><b>${st.today}</b></div>
    <div class="stat"><span class="muted small">RDV à venir</span><b>${st.upcoming}</b></div>
    <div class="stat"><span class="muted small">Clients</span><b>${st.clients}</b></div>
    <div class="stat"><span class="muted small">Absents (no-show)</span><b>${st.month_no_shows}</b></div></div>
    ${st.by_barber.map(b => `<div class="card row between"><span>✂️ ${esc(b.name)}</span><span>${b.visits} coupe(s) · <b>${DT(b.revenue)}</b></span></div>`).join('')}
    <h3>Raccourcis</h3><div class="row wrap"><button onclick="render('hours')">🕘 Mes horaires</button><button onclick="render('absences')">🚪 Absences</button><button onclick="render('gallery')">📸 Galerie</button><button onclick="render('account')">👤 Mon compte</button></div>
    <h3>Réglages du salon</h3><div class="card">
      <label>Nom du salon</label><input id="st_shop_name" value="${esc(s.shop_name)}">
      <label>Téléphone du salon</label><input id="st_shop_phone" type="tel" value="${esc(s.shop_phone)}">
      <label>Adresse</label><input id="st_shop_address" value="${esc(s.shop_address)}">
      <label>Jours de fermeture du salon (repos hebdomadaire)</label><div class="row wrap">${WEEK.map(wd => `<label class="row" style="margin:4px 12px 4px 0;color:var(--fg)"><input type="checkbox" id="cd_${wd}" ${s.closed_days.split(',').includes(String(wd)) ? 'checked' : ''}> ${DAYS[wd]}</label>`).join('')}</div>
      <label>Annulation / modification possible jusqu'à (heures avant le RDV)</label><input id="st_cancel_hours" type="number" min="0" value="${s.cancel_hours}">
      <label>Réservation possible sur (jours à l'avance)</label><input id="st_booking_days" type="number" min="1" value="${s.booking_days}">
      <label>Rappel envoyé (minutes avant le RDV)</label><input id="st_reminder_minutes" type="number" min="10" value="${s.reminder_minutes}">
      <label>Fidélité : nombre de coupes avant la réduction</label><input id="st_loyalty_every" type="number" min="1" value="${s.loyalty_every}">
      <label>Fidélité : réduction (%)</label><input id="st_loyalty_discount" type="number" min="1" max="100" value="${s.loyalty_discount}">
      <button class="main" onclick="A.saveSettings()">Enregistrer</button><p id="st_err" class="err"></p></div>
    <button class="main danger" style="background:none;border:1px solid #f2c6cb;box-shadow:none" onclick="A.logout()">🚪 Se déconnecter</button>`;
};
A.saveSettings = () => run(async () => {
  const keys = ['shop_name', 'shop_phone', 'shop_address', 'cancel_hours', 'booking_days', 'reminder_minutes', 'loyalty_every', 'loyalty_discount'];
  await api('PUT', '/api/admin/settings', { ...Object.fromEntries(keys.map(k => [k, $('st_' + k).value])), closed_days: WEEK.filter(wd => $('cd_' + wd).checked) });
  await loadPublic(); toast('✅ Réglages enregistrés');
}, 'st_err');

// ===== Compte =====
V.account = () => {
  $('m').innerHTML = `<h2>Mon compte</h2><div class="card">
    <div class="muted small">📞 ${esc(me.phone)} · ${me.role === 'admin' ? 'Admin' : me.role === 'barber' ? 'Barbier' : 'Client'}</div>
    <label>Nom</label><input id="u_n" value="${esc(me.name)}">
    <label>Mot de passe actuel (pour le changer)</label><input id="u_c" type="password" autocomplete="current-password">
    <label>Nouveau mot de passe</label><input id="u_p" type="password" autocomplete="new-password">
    <button class="main" onclick="A.saveMe()">Enregistrer</button><p id="u_err" class="err"></p></div>
    ${installBtn('main')}
    <h3>🔔 Notifications sur ce téléphone</h3><div class="card"><p id="push_st" class="small">${pushStatus()}</p>
    <div id="push_diag" class="diag small"></div><button style="margin-top:10px" onclick="A.pushRepair()">🛠 Réparer les notifications</button>
    ${pushOn ? '<button class="main" onclick="A.pushTest()">🔔 Recevoir une notification de test</button>' : '<button class="main" onclick="A.pushEnable()">Activer les notifications</button>'}</div>
    <button class="main danger" style="background:none;border:1px solid #f2c6cb" onclick="A.logout()">Se déconnecter</button>`;
  pushDiag();
};
A.saveMe = () => run(async () => {
  me = await api('PUT', '/api/me', { name: $('u_n').value, current_password: $('u_c').value, password: $('u_p').value || undefined });
  $('u_c').value = $('u_p').value = ''; $('u_err').innerHTML = '<span class="okt">✅ Enregistré</span>';
  loadPublic();
}, 'u_err');

// ===== Notifications =====
V.notifs = async () => {
  const r = await api('GET', '/api/notifications');
  if (r.unread) { await api('POST', '/api/notifications/read'); unread = 0; updateBell(); }
  $('m').innerHTML = `<h2>Notifications</h2>${r.items.map(n => `<div class="card ${n.read ? '' : 'sel'}">${esc(n.message)}<div class="small muted">${new Date(n.created_at.replace(' ', 'T')).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</div></div>`).join('') || '<p class="muted center">Aucune notification</p>'}`;
};
$('bell').onclick = () => { view = 'notifs'; document.querySelectorAll('#nav button').forEach(b => b.classList.remove('on')); V.notifs(); };
function updateBell() { $('badge').textContent = unread; $('badge').hidden = !unread; }
let lastNotifId = null;
async function pollNotifs() {
  if (!me) return;
  try {
    const r = await api('GET', '/api/notifications');
    const more = r.unread > unread;
    unread = r.unread; updateBell();
    // téléphone sans push (ex. Android sans services Google) : tant que l'application tourne, on affiche
    // nous-mêmes les nouvelles notifications sur l'écran
    const fresh = lastNotifId === null ? [] : r.items.filter(n => n.id > lastNotifId && !n.read);
    if (r.items.length) lastNotifId = Math.max(lastNotifId || 0, r.items[0].id);
    if (fresh.length && !pushOn && window.Notification && Notification.permission === 'granted') {
      const reg = await navigator.serviceWorker.ready;
      for (const n of fresh.reverse()) reg.showNotification(pub.shop.name, { body: n.message, icon: '/icons/icon-192.png', badge: '/icons/badge.png', tag: 'n' + n.id, vibrate: [200, 100, 200] });
    }
    // nouvelle notification : on rafraîchit les écrans qui en dépendent
    if (more && ['mine', 'planning', 'notifs'].includes(view)) V[view]();
  } catch (e) { }
}
setInterval(pollNotifs, 30e3);
document.addEventListener('visibilitychange', pollNotifs);

// ===== Notifications push (même application fermée) =====
let pushOn = false;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushOk = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function pushStatus() {
  if (pushOn) return "✅ Activées : vous recevez les rappels et les alertes même quand l'application est fermée.";
  if (pushFailed()) return "📵 Ce téléphone ne peut pas recevoir les notifications quand l'application est fermée (services Google indisponibles ou bloqués). Elles s'affichent quand l'application est ouverte, et restent dans 🔔. Vérifiez : Google Play Services à jour, date et heure automatiques, pas de VPN, puis « Réparer ».";
  if (isIOS && !standalone()) return "📲 Sur iPhone : touchez Partager ⬆️ puis « Sur l'écran d'accueil », ouvrez l'application depuis l'icône, puis activez les notifications ici.";
  if (!pushOk()) return '⚠️ Ce navigateur ne permet pas les notifications.';
  if (Notification.permission === 'denied') return '🚫 Notifications bloquées : autorisez-les dans les réglages du navigateur pour ce site.';
  return 'Activez les notifications pour recevoir le rappel avant votre rendez-vous et les places libérées.';
}
const b64u8 = s => { const p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
const APP_VERSION = '2026-10-15.2'; // affichée dans « Compte » : permet de voir si le téléphone a la dernière version
// envoie au serveur l'erreur d'un téléphone (visible dans le journal du serveur)
const pushReport = (step, e) => api('POST', '/api/push/report', {
  step, error: String((e && (e.name ? e.name + ': ' : '') + (e.message || e)) || ''), ua: navigator.userAgent,
  permission: window.Notification ? Notification.permission : 'absent', standalone: standalone(),
}).catch(() => { });
async function pushSubscribe() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const { key } = await api('GET', '/api/push/key');
    let sub = await reg.pushManager.getSubscription();
    // abonnement créé avec une autre clé (ancien serveur) : il ne recevrait rien, on le refait
    const same = sub && sub.options && sub.options.applicationServerKey && btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === key;
    if (sub && sub.options && sub.options.applicationServerKey && !same) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u8(key) });
    await api('POST', '/api/push/subscribe', { subscription: sub.toJSON() });
    pushOn = true;
  } catch (e) { pushReport('abonnement', e); throw e; }
}
// diagnostic affiché dans « Compte »
async function pushDiag() {
  const el = $('push_diag'); if (!el) return;
  let sub = null, swOk = false;
  try { const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, ko) => setTimeout(() => ko(new Error('timeout')), 4000))]); swOk = true; sub = await reg.pushManager.getSubscription(); } catch (e) { }
  const st = await api('POST', '/api/push/status', { endpoint: sub ? sub.endpoint : '' }).catch(() => null);
  const perm = window.Notification ? { granted: '✅ autorisée', denied: '🚫 bloquée', default: '⏳ pas encore demandée' }[Notification.permission] : '❌ non disponible';
  const rows = [
    ['Navigateur compatible', pushOk() ? '✅' : '❌'], ['Ouverte comme application', standalone() ? '✅' : 'non (navigateur)'],
    ['Service worker', swOk ? '✅' : '❌'], ['Permission', perm], ['Abonnement de ce téléphone', sub ? '✅' : '❌'],
    ['Reconnu par le serveur', st ? (st.known ? '✅' : '❌') : '?'], ['Téléphones de ce compte', st ? st.devices : '?'], ['Version', APP_VERSION],
  ];
  el.innerHTML = rows.map(([k, v]) => `<div class="row between"><span class="muted">${k}</span><b>${v}</b></div>`).join('');
}
A.pushRepair = () => run(async () => {
  try { const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) { }
  pushOn = false;
  await A.pushEnable();
  pushDiag();
});
A.pushEnable = () => run(async () => {
  if (!pushOk() || (isIOS && !standalone())) return toast(pushStatus());
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { pushReport('permission', perm); showPushBanner(); return toast(pushStatus()); }
  try { await pushSubscribe(); }
  catch (e) {
    // téléphone sans services Google (ou bloqués) : impossible de s'abonner, inutile de redemander à chaque ouverture
    pushFailed(true); showPushBanner();
    if (view === 'account') V.account();
    return toast("📵 Ce téléphone ne peut pas recevoir les notifications quand l'application est fermée (services Google indisponibles). Vous les verrez dans 🔔 en ouvrant l'application.");
  }
  pushFailed(false);
  showPushBanner();
  await api('POST', '/api/push/test');
  toast('✅ Notifications activées : une notification de test arrive sur votre écran');
  if (view === 'account') V.account();
});
// à la connexion : réabonne ce téléphone en silence si la permission est déjà donnée
async function pushRefresh() {
  pushOn = false;
  if (pushOk() && Notification.permission === 'granted') try { await pushSubscribe(); pushFailed(false); } catch (e) { pushFailed(true); }
  showPushBanner();
}
// mémorise sur ce téléphone que l'abonnement push a échoué (« push service error »)
function pushFailed(set) {
  try {
    if (set === undefined) return localStorage.getItem('ib_pushFail') === '1';
    if (set) localStorage.setItem('ib_pushFail', '1'); else localStorage.removeItem('ib_pushFail');
  } catch (e) { return false; }
}
// bandeau en haut de l'écran tant que les notifications ne sont pas activées sur ce téléphone
function showPushBanner() {
  const b = $('pb');
  let dismissed = false;
  try { dismissed = sessionStorage.getItem('ib_noPush') === '1'; } catch (e) { }
  const ask = me && !pushOn && pushOk() && !pushFailed() && !(isIOS && !standalone()) && !dismissed;
  b.hidden = !ask;
  if (!ask) return;
  b.innerHTML = Notification.permission === 'denied'
    ? `<span class="grow small">🔕 Notifications bloquées : autorisez-les dans les réglages du téléphone (Paramètres › Applications › ${standalone() ? 'Elegance Barber Shop' : 'Chrome'} › Notifications)</span><button class="icon" aria-label="Fermer" onclick="A.hidePush()">✕</button>`
    : `<span class="grow"><b>🔔 Activez les notifications</b><div class="small muted">Rappel avant votre RDV, places libérées, offres…</div></span>
      <button class="small-btn" onclick="A.pushEnable()">Activer</button><button class="icon" aria-label="Fermer" onclick="A.hidePush()">✕</button>`;
}
A.hidePush = () => { $('pb').hidden = true; try { sessionStorage.setItem('ib_noPush', '1'); } catch (e) { } };
A.pushTest = () => run(async () => {
  const r = await api('POST', '/api/push/test');
  toast(r.devices ? '🔔 Notification envoyée : regardez le haut de votre écran' : "⚠️ Ce téléphone n'est pas encore abonné : réactivez les notifications");
});

// ===== Installer l'application =====
// Android : l'APK (vraie application) ; PC / Chrome : installation directe ; iPhone : explication (Apple n'autorise pas de bouton)
let installEv = null;
const isAndroid = /android/i.test(navigator.userAgent);
const installMode = () => {
  if (standalone()) return '';              // déjà dans l'application
  if (isAndroid && pub && pub.apk) return 'apk';
  if (installEv) return 'prompt';
  if (isIOS) return 'ios';
  return '';
};
const installBtn = cls => installMode() ? `<button class="${cls} install" onclick="A.install()">📲 Installer l'application</button>` : '';
const noBanner = () => { try { return localStorage.getItem('ib_noInstall') === '1'; } catch (e) { return false; } };
function showInstallBanner() {
  const b = $('inst');
  if (!installMode() || noBanner()) { b.hidden = true; return; }
  b.hidden = false;
  b.innerHTML = `<img src="/icons/icon-192.png" alt=""><div class="grow"><b>Elegance Barber Shop</b><div class="small muted">Réservez plus vite depuis l'application</div></div>
    <button class="small-btn" onclick="A.install()">Installer</button><button class="icon" aria-label="Fermer" onclick="A.hideInstall()">✕</button>`;
}
A.hideInstall = () => { $('inst').hidden = true; try { localStorage.setItem('ib_noInstall', '1'); } catch (e) { } };
A.install = async () => {
  const mode = installMode();
  if (mode === 'apk') {
    location.href = '/download/elegance-barbershop.apk';
    toast("📥 Téléchargement lancé : ouvrez le fichier puis touchez « Installer » (autorisez l'installation si Android le demande).");
  } else if (mode === 'prompt') {
    installEv.prompt();
    const { outcome } = await installEv.userChoice;
    installEv = null;
    if (outcome === 'accepted') toast('✅ Application installée');
    showInstallBanner(); if (view === 'account') V.account();
  } else if (mode === 'ios') {
    const h = $('iosHelp');
    h.hidden = false;
    h.innerHTML = `<div class="sheet"><b>Installer sur iPhone</b>
      <p>1. Touchez <b>Partager</b> <span class="ios-share">⬆️</span> en bas de Safari</p>
      <p>2. Choisissez <b>« Sur l'écran d'accueil »</b> puis <b>Ajouter</b></p>
      <p class="small muted">Ouvrez ensuite Elegance Barber Shop depuis l'icône pour recevoir les notifications.</p>
      <button class="main" onclick="$('iosHelp').hidden=true">J'ai compris</button></div>`;
  }
};
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEv = e; showInstallBanner(); });
window.addEventListener('appinstalled', () => { installEv = null; $('inst').hidden = true; });

// ===== Démarrage =====
async function loadPublic() {
  pub = await api('GET', '/api/public');
  $('shop').textContent = pub.shop.name;
  document.title = pub.shop.name;
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { });
(async () => {
  try {
    await loadPublic();
    me = await api('GET', '/api/me');
    showInstallBanner();
    if (me) { pollNotifs(); pushRefresh(); }
    render(homeView());
  } catch (e) {
    $('m').innerHTML = `<div class="card center"><p>⚠️ Impossible de joindre le serveur.</p><button class="main" onclick="location.reload()">Réessayer</button></div>`;
  }
})();
