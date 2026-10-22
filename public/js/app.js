import { html, $, $$, get, post, icon, loadMark, mark, avatar, setAuthHandler, ROLE_LABEL, toast } from './lib.js';
import { starten as bewegungStarten, seiteFertig, nachObenSpringen } from './motion.js';

const views = {
  dashboard: () => import('./views/dashboard.js'),
  events: () => import('./views/events.js'),
  projects: () => import('./views/projects.js'),
  polls: () => import('./views/polls.js'),
  board: () => import('./views/board.js'),
  files: () => import('./views/files.js'),
  finance: () => import('./views/finance.js'),
  members: () => import('./views/members.js'),
  profile: () => import('./views/profile.js'),
  auth: () => import('./views/auth.js'),
};

// [Pfad, Modul, Funktion, Navigationspunkt]
const ROUTES = [
  ['/', 'dashboard', 'render', 'start'],
  ['/termine', 'events', 'list', 'termine'],
  ['/termine/:id', 'events', 'detail', 'termine'],
  ['/projekte', 'projects', 'list', 'projekte'],
  ['/projekte/:id', 'projects', 'detail', 'projekte'],
  ['/abstimmungen', 'polls', 'list', 'abstimmungen'],
  ['/abstimmungen/:id', 'polls', 'detail', 'abstimmungen'],
  ['/pinnwand', 'board', 'render', 'pinnwand'],
  ['/dateien', 'files', 'render', 'dateien'],
  ['/kasse', 'finance', 'render', 'kasse'],
  ['/mitglieder', 'members', 'render', 'mitglieder'],
  ['/profil', 'profile', 'render', 'profil'],
];

const NAV = [
  ['start', '/', 'Übersicht', 'home'],
  ['termine', '/termine', 'Termine', 'calendar'],
  ['projekte', '/projekte', 'Projekte', 'projects'],
  ['abstimmungen', '/abstimmungen', 'Abstimmungen', 'vote'],
  ['pinnwand', '/pinnwand', 'Pinnwand', 'pin'],
  ['dateien', '/dateien', 'Dateien', 'folder'],
  ['kasse', '/kasse', 'Kasse', 'coins'],
  ['mitglieder', '/mitglieder', 'Mitglieder', 'users'],
];
const MOBILE_MAIN = ['start', 'termine', 'projekte', 'abstimmungen'];

const state = { user: null, site: null, shell: false, navToken: 0 };

function match(path) {
  for (const [pattern, mod, fn, nav] of ROUTES) {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
    const m = path.match(re);
    if (m) return { mod, fn, nav, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

export function go(path, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  route();
}

function setTitle(title) {
  document.title = title ? `${title} – ${state.site.name}` : state.site.name;
  const t = $('.topbar-title');
  if (t) t.textContent = title || state.site.name;
}

async function renderAuth(fnName, params = {}) {
  state.shell = false;
  const mod = await views.auth();
  const root = $('#app');
  await mod[fnName]({ root, params, site: state.site, user: state.user, onDone: boot, setTitle: (t) => { document.title = `${t} – ${state.site.name}`; } });
  seiteFertig(root);
}

function renderShell() {
  const u = state.user;
  const navLink = ([key, href, label, ic]) => html`<a href="${href}" data-nav="${key}">${icon(ic)}<span>${label}</span></a>`;
  $('#app').innerHTML = String(html`
    <div class="shell">
      <aside class="side" aria-label="Hauptnavigation">
        <a class="brand" href="/">${mark()}<span class="brand-text"><span class="brand-name">${state.site.name}</span><br><span class="brand-school">${state.site.school}</span></span></a>
        <nav class="nav">${NAV.map(navLink)}</nav>
        <div class="side-foot">
          <a class="me-link" href="/profil" data-nav="profil">${avatar(u.displayName)}
            <span><span class="me-name">${u.displayName}</span><br><span class="me-role">${u.amt || ROLE_LABEL[u.role]}</span></span></a>
          <button type="button" class="logout" data-logout>${icon('logout')}Abmelden</button>
        </div>
      </aside>
      <header class="topbar">${mark()}<span class="topbar-title"></span></header>
      <main class="main" id="main" tabindex="-1"></main>
      <nav class="bottomnav" aria-label="Navigation">
        ${NAV.filter((n) => MOBILE_MAIN.includes(n[0])).map(([key, href, label, ic]) => html`<a href="${href}" data-nav="${key}">${icon(ic)}<span>${label === 'Abstimmungen' ? 'Abstimmen' : label}</span></a>`)}
        <button type="button" data-drawer>${icon('more')}<span>Mehr</span></button>
      </nav>
      <div class="drawer" id="drawer">
        <div class="drawer-backdrop" data-drawer-close></div>
        <div class="drawer-panel" role="dialog" aria-label="Weitere Bereiche">
          <div class="drawer-grip"></div>
          ${NAV.filter((n) => !MOBILE_MAIN.includes(n[0])).map(navLink)}
          <a href="/profil" data-nav="profil">${icon('user')}<span>Mein Profil</span></a>
          <button type="button" data-logout>${icon('logout')}<span>Abmelden</span></button>
        </div>
      </div>
    </div>`);
  state.shell = true;
}

function markNav(key) {
  $$('[data-nav]').forEach((a) => {
    if (a.dataset.nav === key) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const more = $('[data-drawer]');
  if (more) {
    if (!MOBILE_MAIN.includes(key)) more.setAttribute('aria-current', 'page');
    else more.removeAttribute('aria-current');
  }
}

async function route() {
  const path = location.pathname;
  const token = ++state.navToken;
  $('#drawer')?.classList.remove('open');

  if (path === '/einladung' || path.startsWith('/einladung/')) {
    return renderAuth('invite', { code: decodeURIComponent(path.split('/')[2] || '') });
  }
  if (!state.user) {
    if (path !== '/') sessionStorage.setItem('sv-after-login', path + location.search);
    return renderAuth('login');
  }
  if (state.user.mustChangePassword) return renderAuth('forcePassword');

  if (!state.shell) renderShell();
  const r = match(path);
  const main = $('#main');
  if (!r) {
    markNav('');
    setTitle('Nicht gefunden');
    main.innerHTML = String(html`<div class="page error-page"><h1>Diese Seite gibt es nicht</h1><p><a href="/">Zur Übersicht</a></p></div>`);
    seiteFertig(main);
    return;
  }
  markNav(r.nav);
  main.innerHTML = '<div class="page loading">Wird geladen …</div>';
  const ctx = {
    main,
    params: r.params,
    query: new URLSearchParams(location.search),
    user: state.user,
    site: state.site,
    go,
    setTitle,
    reload: () => { if (token === state.navToken) route(); },
    isCurrent: () => token === state.navToken,
    refreshUser: async () => { const me = await get('/me'); state.user = me.user; renderShell(); route(); },
  };
  try {
    const mod = await views[r.mod]();
    if (token !== state.navToken) return;
    await mod[r.fn](ctx);
    if (token === state.navToken && !history.state?.keepScroll) nachObenSpringen();
    if (token === state.navToken) seiteFertig(main);
  } catch (err) {
    if (token !== state.navToken || err.status === 401 || err.code === 'MUST_CHANGE_PW') return;
    console.error(err);
    main.innerHTML = String(html`<div class="page error-page"><h1>${err.status === 404 ? 'Nicht gefunden' : 'Das hat nicht geklappt'}</h1>
      <p>${err.message}</p><p><a href="/">Zur Übersicht</a></p></div>`);
    seiteFertig(main);
  }
}

async function logout() {
  await post('/logout').catch(() => {});
  state.user = null;
  state.shell = false;
  history.replaceState(null, '', '/');
  toast('Du bist abgemeldet.');
  route();
}

async function boot() {
  const me = await get('/me');
  state.user = me.user;
  state.site = me.site;
  state.shell = false;
  if (state.user && !state.user.mustChangePassword) {
    const after = sessionStorage.getItem('sv-after-login');
    if (after) {
      sessionStorage.removeItem('sv-after-login');
      if (!after.startsWith('/einladung')) history.replaceState(null, '', after);
    } else if (location.pathname.startsWith('/einladung')) {
      history.replaceState(null, '', '/');
    }
  }
  route();
}

setAuthHandler(async (err) => {
  if (err.code === 'MUST_CHANGE_PW') state.user = { ...(state.user || {}), mustChangePassword: true };
  else state.user = null;
  state.shell = false;
  route();
});

// Interne Links ohne Neuladen öffnen
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-logout]')) return logout();
  if (e.target.closest('[data-drawer]')) return $('#drawer').classList.add('open');
  if (e.target.closest('[data-drawer-close]')) return $('#drawer').classList.remove('open');
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (a.target || a.hasAttribute('download')) return;
  const href = a.getAttribute('href');
  if (!href.startsWith('/') || href.startsWith('//') || href.startsWith('/api/') || href.startsWith('/kalender/')) return;
  e.preventDefault();
  if (href !== location.pathname + location.search) go(href);
  else route();
});
window.addEventListener('popstate', route);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#drawer')?.classList.remove('open'); });

(async () => {
  try {
    bewegungStarten();
    await loadMark();
    await boot();
  } catch (err) {
    $('#app').innerHTML = String(html`<div class="auth"><div class="auth-card"><div class="auth-box"><h1>Keine Verbindung</h1>
      <p>${err.message || 'Der Server antwortet nicht.'}</p><button type="button" class="btn btn-primary" id="reload">Neu laden</button></div></div></div>`);
    $('#reload').addEventListener('click', () => location.reload());
  }
})();

