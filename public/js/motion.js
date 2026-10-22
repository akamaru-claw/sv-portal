/*
 * Bewegung — weiches Scrollen (Lenis) und Auftritte (GSAP/ScrollTrigger).
 *
 * Die Datei fasst keine Ansicht an. `app.js` ruft nach jedem Seitenwechsel
 * genau einmal `seiteFertig()` auf, alles Weitere passiert hier.
 *
 * Fällt sie aus — kein JavaScript, alte Browser, geblockte Datei —, bleibt
 * das Portal vollständig benutzbar: die Anfangszustände im CSS greifen nur
 * unter `body.js-motion`, und die Klasse setzt erst dieses Modul.
 *
 * `prefers-reduced-motion` schaltet alles ab. Für eine Schulseite ist das
 * kein Nebenschauplatz: Bewegung kann Migräne und Schwindel auslösen.
 */

const ruhig = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;
const Lenis = window.Lenis;
const vorhanden = !!(gsap && ScrollTrigger && Lenis);

/* Was beim Hereinscrollen aufblendet. Bewusst sparsam gewählt: das Portal
   ist ein Arbeitsgerät, niemand will beim zehnten Besuch auf Animationen
   warten. Deshalb kurz, nur leicht versetzt, und nur einmal je Seite. */
const AUFTRITT = [
  '.panel', '.meeting', '.pcard', '.post', '.person', '.lane',
  '.facts > *', '.money-sum > div', '.cal', '.table-wrap', '.feed > *',
  '.page-head', '.hello', '.notice', '.empty', '.auth-box',
].join(',');

/* Elemente, die selbst scrollen — die soll Lenis nicht an sich reißen. */
const EIGENSCROLL = '.table-wrap, .md, .menu-list, .drawer-panel, pre, textarea';

let lenis = null;
let meine = [];
let letzterPfad = null;

/* ── Weiches Scrollen ──────────────────────────────────────────────────────
   Genau diese Verdrahtung: Lenis ohne eigene Schleife, getrieben vom
   GSAP-Ticker. Zwei rAF-Schleifen nebeneinander laufen gegeneinander, und
   ScrollTrigger löst dann zu früh aus. */
function scrollenEinrichten() {
  lenis = new Lenis({
    duration: 0.85,
    smoothWheel: true,
    /* Finger auf dem Touchscreen bleibt nativ. Alles andere fühlt sich auf
       Tablets zäh an — und auf dem Tablet wird das Portal in der Sitzung
       benutzt, nicht angeschaut. */
    syncTouch: false,
    prevent: (node) => !!(node.closest && node.closest('[data-lenis-prevent]')),
  });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((zeit) => lenis.raf(zeit * 1000));
  gsap.ticker.lagSmoothing(0);

  /*
   * Liegt ein Dialog oder das Mehr-Menü über der Seite, soll die Seite
   * dahinter stillstehen. Der Browser hält bei `showModal()` zwar das native
   * Scrollen an, Lenis bekommt davon aber nichts mit und schiebt weiter —
   * man scrollt dann durch den Dialog hindurch.
   */
  const davor = () => !!document.querySelector('dialog.dlg[open]') || !!document.querySelector('#drawer.open');
  new MutationObserver(() => { if (davor()) lenis.stop(); else lenis.start(); })
    .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'class'] });
}

/* Beim Seitenwechsel springt `app.js` nach oben. Das muss Lenis mitbekommen,
   sonst scrollt es gleich wieder an die alte Stelle zurück. */
export function nachObenSpringen() {
  if (lenis) lenis.scrollTo(0, { immediate: true });
  else window.scrollTo(0, 0);
}

function aufraeumen() {
  meine.forEach((t) => t.kill());
  meine = [];
}

/* ── Zahlen zählen hoch ───────────────────────────────────────────────────
   Der Kassenstand, die Zahl der Zusagen, die Beteiligung. Der Zielwert steht
   schon als Text im Element — die Ansichten müssen davon nichts wissen.
   Nur echte Zahlen, und `€`, `%`, Punkt und Komma bleiben stehen. */
function zahlenZaehlen(feld) {
  const treffer = feld.querySelectorAll('.money-sum b, .lstat-num, [data-zaehl]');
  treffer.forEach((el) => {
    if (el.dataset.gezaehlt) return;
    const roh = el.textContent.trim();
    const zahl = parseFloat(roh.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
    if (!isFinite(zahl) || Math.abs(zahl) < 2) return;      // 0 und 1 zu zählen wirkt albern
    el.dataset.gezaehlt = '1';
    const nachkomma = /,\d/.test(roh) ? 2 : 0;
    const formt = new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: nachkomma, maximumFractionDigits: nachkomma,
    });
    /* Text drumherum erhalten: „42,50 €" bleibt „… €", „12 %" bleibt „… %". */
    const [vorn, hinten] = roh.split(/[\d.,-]+/);
    const stand = { n: 0 };
    el.textContent = vorn + formt.format(0) + (hinten || '');
    meine.push(ScrollTrigger.create({
      trigger: el, start: 'top 92%', once: true,
      onEnter: () => gsap.to(stand, {
        n: zahl, duration: 1, ease: 'power2.out',
        onUpdate: () => { el.textContent = vorn + formt.format(stand.n) + (hinten || ''); },
      }),
    }));
  });
}

/* ── Balken wachsen ───────────────────────────────────────────────────────
   Abstimmungsergebnisse und Projektfortschritt. Die Breite steht als
   Inline-Stil im Markup; wir merken sie uns und fahren von 0 dorthin. */
function balkenWachsen(feld) {
  feld.querySelectorAll('.result-bar > i, .progress > i').forEach((el) => {
    if (el.dataset.gewachsen) return;
    el.dataset.gewachsen = '1';
    const ziel = el.style.width || getComputedStyle(el).width;
    el.style.width = '0%';
    meine.push(ScrollTrigger.create({
      trigger: el, start: 'top 95%', once: true,
      onEnter: () => gsap.to(el, { width: ziel, duration: .9, ease: 'power3.out' }),
    }));
  });
}

/* ── Der laufende Strich in der Seitenleiste ──────────────────────────────
   Statt dass die Markierung von Punkt zu Punkt springt, fährt sie hin. */
function navStrich() {
  const nav = document.querySelector('.side .nav');
  if (!nav) return;
  let strich = nav.querySelector('.nav-strich');
  if (!strich) {
    strich = document.createElement('span');
    strich.className = 'nav-strich';
    strich.setAttribute('aria-hidden', 'true');
    nav.appendChild(strich);
  }
  const aktiv = nav.querySelector('[aria-current="page"]');
  if (!aktiv) { strich.style.opacity = '0'; return; }
  const oben = aktiv.offsetTop;
  const hoch = aktiv.offsetHeight;
  if (ruhig || strich.style.opacity === '' || strich.style.opacity === '0') {
    gsap.set(strich, { y: oben, height: hoch, opacity: 1 });
  } else {
    gsap.to(strich, { y: oben, height: hoch, opacity: 1, duration: .32, ease: 'power3.out' });
  }
}

/* ── Seitenwechsel ────────────────────────────────────────────────────────
   Kurz und flach. Ein auffälliger Übergang macht eine Anwendung, die man
   zwanzig Mal am Tag benutzt, langsam — gemessen in gefühlter Zeit. */
function seiteEintreten(feld) {
  const inhalt = feld.firstElementChild;
  if (!inhalt) return;
  gsap.fromTo(inhalt, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .34, ease: 'power2.out' });
}

/* ── Auftritte beim Scrollen ───────────────────────────────────────────── */
function auftritte(feld) {
  const stuecke = Array.from(feld.querySelectorAll(AUFTRITT))
    /* Verschachteltes doppelt zu animieren sieht unruhig aus: sitzt ein
       Element schon in einem anderen Auftritt, bleibt es außen vor. */
    .filter((el, _i, alle) => !alle.some((a) => a !== el && a.contains(el)));
  if (!stuecke.length) return;

  stuecke.forEach((el) => el.setAttribute('data-auftritt', ''));
  meine = meine.concat(ScrollTrigger.batch(stuecke, {
    start: 'top 94%',
    once: true,
    onEnter: (gruppe) => gsap.to(gruppe, {
      opacity: 1, y: 0, duration: .55, ease: 'power3.out', stagger: .05,
      onStart() { this.targets().forEach((el) => el.classList.add('ist-da')); },
    }),
  }));
}

/*
 * Rettungsnetz. Der Auslöser steht bei 94 % der Fensterhöhe — ein Element,
 * das darunter liegt und auf einer Seite sitzt, die sich nicht weit genug
 * scrollen lässt, käme dort nie an und bliebe **dauerhaft unsichtbar**.
 * Das passiert genau dann, wenn kaum Inhalt da ist, also im schlimmsten
 * Moment: bei einer frisch eingerichteten SV ohne Projekte und Termine.
 *
 * Deshalb: alles, was nach dem Aufbau noch versteckt ist und auch beim
 * Ganz-nach-unten-Scrollen nicht in den Auslösebereich käme, wird gezeigt.
 */
function niemandVergessen(feld) {
  const restWeg = document.documentElement.scrollHeight - window.innerHeight;
  const grenze = window.innerHeight * 0.94;
  const nachzuegler = Array.from(feld.querySelectorAll('[data-auftritt]:not(.ist-da)'))
    .filter((el) => el.getBoundingClientRect().top - restWeg >= grenze);
  if (!nachzuegler.length) return;
  gsap.to(nachzuegler, {
    opacity: 1, y: 0, duration: .45, ease: 'power3.out', stagger: .04,
    onStart() { this.targets().forEach((el) => el.classList.add('ist-da')); },
  });
}

/*
 * Wird von `app.js` nach jedem fertig gerenderten Seiteninhalt gerufen.
 * `feld` ist der Container, in dem die Ansicht steht (`#main` oder `#app`).
 */
export function seiteFertig(feld) {
  if (!vorhanden || !feld) return;
  aufraeumen();

  feld.querySelectorAll(EIGENSCROLL).forEach((el) => el.setAttribute('data-lenis-prevent', ''));
  navStrich();

  const neuerPfad = location.pathname;
  const gewechselt = neuerPfad !== letzterPfad;
  letzterPfad = neuerPfad;

  if (ruhig) return;

  if (gewechselt) seiteEintreten(feld);
  auftritte(feld);
  zahlenZaehlen(feld);
  balkenWachsen(feld);
  /* Was beim Laden schon im Bild steht, soll sofort da sein — sonst stünde
     die halbe Seite leer, bis jemand scrollt. */
  ScrollTrigger.refresh();
  niemandVergessen(feld);
}

/* ── Start ────────────────────────────────────────────────────────────────
   Einmal beim Laden des Moduls. Ohne Bibliotheken passiert nichts, und die
   Seite bleibt die Seite. */
export function starten() {
  if (!vorhanden) {
    console.warn('Bewegung aus: gsap, ScrollTrigger oder Lenis fehlen.');
    return;
  }
  gsap.registerPlugin(ScrollTrigger);
  if (!ruhig) scrollenEinrichten();
  document.body.classList.add('js-motion');
  /* Die Seitenleiste ist beim ersten Laden noch nicht da — der Strich wird
     in `seiteFertig()` nachgezogen. */
  window.addEventListener('resize', () => { navStrich(); ScrollTrigger.refresh(); });
}
