import { html, $$, get, put, icon, fmtDateLong, fmtDate, eventTime, relDay, ago, today, daysBetween, md, attempt, plural } from '../lib.js';
import { eventRow, rsvpButtons, newEventDialog } from './events.js';

const GREETINGS = ['Hallo', 'Moin', 'Hey'];

export async function render(ctx) {
  const { main, user } = ctx;
  ctx.setTitle('Übersicht');

  const load = async () => {
    const d = await get('/uebersicht');
    if (!ctx.isCurrent()) return;
    const m = d.nextMeeting;
    const pendingPolls = d.polls.filter((p) => p.mayVote && !p.voted);
    const otherPolls = d.polls.filter((p) => !(p.mayVote && !p.voted));
    const firstName = user.displayName.split(/\s+/)[0];
    const greet = GREETINGS[new Date().getDate() % GREETINGS.length];
    const canPlan = user.role !== 'mitglied';
    const running = (d.projects.aktiv || 0) + (d.projects.planung || 0);

    main.innerHTML = String(html`
      <div class="page">
        <div class="hello">
          <h1>${greet} ${firstName}</h1>
          <p>${fmtDateLong(today())}. ${running ? `${plural(running, 'Projekt ist', 'Projekte sind')} in Arbeit` : 'Noch keine Projekte in Arbeit'}${d.projects.idee ? `, ${plural(d.projects.idee, 'Idee wartet', 'Ideen warten')} auf Unterstützung` : ''}.</p>
        </div>

        ${m ? html`
          <section class="meeting" aria-labelledby="next-meeting">
            <div class="meeting-top">
              <div>
                <div class="meeting-kicker" id="next-meeting">Nächste SV-Sitzung</div>
                <div class="meeting-date">${fmtDateLong(m.startsAt)}</div>
                <div class="meeting-facts">
                  <span>${icon('clock', 'icon-s')}${eventTime(m)}</span>
                  ${m.location ? html`<span>${icon('place', 'icon-s')}${m.location}</span>` : ''}
                </div>
              </div>
              ${relDay(m.startsAt) ? html`<div class="meeting-when">${relDay(m.startsAt)}</div>` : ''}
            </div>
            <div class="meeting-body">
              <div>
                <h3>Tagesordnung</h3>
                ${m.agendaPreview.length
                  ? html`<ol class="agenda-mini">${m.agendaPreview.map((t) => html`<li>${t}</li>`)}</ol>${m.agendaCount > m.agendaPreview.length ? html`<p class="small muted">und ${m.agendaCount - m.agendaPreview.length} weitere</p>` : ''}`
                  : html`<p class="muted">Noch keine Punkte. Schlag einen vor, dann weiß der Vorstand, was dir wichtig ist.</p>`}
                <p><a href="/termine/${m.id}">Tagesordnung und Protokoll öffnen</a></p>
              </div>
              <div>
                <h3>Bist du dabei?</h3>
                ${rsvpButtons(m)}
                <div class="rsvp-count">${plural(m.rsvp.ja, 'Zusage', 'Zusagen')}${m.rsvp.nein ? `, ${plural(m.rsvp.nein, 'Absage', 'Absagen')}` : ''}${m.rsvp.vielleicht ? `, ${m.rsvp.vielleicht} vielleicht` : ''}</div>
              </div>
            </div>
          </section>`
        : html`
          <section class="panel" style="margin-bottom:20px">
            <div class="empty"><strong>Noch keine Sitzung geplant</strong>
              ${canPlan ? 'Leg die nächste SV-Sitzung an, dann können alle Tagesordnungspunkte vorschlagen und zusagen.' : 'Sobald der Vorstand die nächste Sitzung einträgt, erscheint sie hier.'}
              ${canPlan ? html`<br><button type="button" class="btn btn-primary" data-plan>${icon('plus')}Sitzung planen</button>` : ''}
            </div>
          </section>`}

        <div class="cols">
          <div>
            ${pendingPolls.length ? html`
              <section class="panel vote-due">
                <div class="panel-head"><h2>Deine Stimme fehlt</h2><a href="/abstimmungen">Alle Abstimmungen</a></div>
                <ul class="rows">${pendingPolls.map((p) => html`<li><a class="row" href="/abstimmungen/${p.id}">
                  <span class="row-main"><span class="row-title">${p.title}</span>
                  <span class="row-sub">${p.closesAt ? html`<span>${icon('clock', 'icon-s')}endet ${relDay(p.closesAt) || fmtDate(p.closesAt)}, ${p.closesAt.slice(11)} Uhr</span>` : html`<span>ohne Enddatum</span>`}</span></span>
                  <span class="row-end"><span class="btn btn-s btn-primary">Abstimmen</span></span></a></li>`)}</ul>
              </section>` : ''}

            <section class="panel">
              <div class="panel-head"><h2>Deine Aufgaben</h2><a href="/projekte">Zu den Projekten</a></div>
              ${d.myTasks.length ? html`<ul class="rows">${d.myTasks.map((t) => {
                const late = t.dueDate && daysBetween(today(), t.dueDate) < 0;
                return html`<li><a class="row" href="/projekte/${t.projectId}">
                  <span class="row-main"><span class="row-title">${t.title}</span>
                  <span class="row-sub"><span>${icon('projects', 'icon-s')}${t.projectTitle}</span>
                  ${t.dueDate ? html`<span class="${late ? 'minus' : ''}">${icon('flag', 'icon-s')}${late ? 'überfällig seit ' : 'bis '}${fmtDate(t.dueDate)}</span>` : ''}</span></span></a></li>`;
              })}</ul>`
              : html`<div class="empty"><strong>Gerade nichts offen.</strong>Schau in die Projekte und übernimm eine Aufgabe.</div>`}
            </section>

            <section class="panel">
              <div class="panel-head"><h2>Demnächst</h2><a href="/termine">Alle Termine</a></div>
              ${d.upcoming.length ? html`<ul class="rows">${d.upcoming.map((e) => html`<li>${eventRow(e)}</li>`)}</ul>`
                : html`<div class="empty">Keine weiteren Termine eingetragen.</div>`}
            </section>

            ${otherPolls.length ? html`
              <section class="panel">
                <div class="panel-head"><h2>Laufende Abstimmungen</h2></div>
                <ul class="rows">${otherPolls.map((p) => html`<li><a class="row" href="/abstimmungen/${p.id}">
                  <span class="row-main"><span class="row-title">${p.title}</span>
                  <span class="row-sub">${p.voted ? html`<span>${icon('check', 'icon-s')}abgestimmt</span>` : html`<span>Lehrkräfte stimmen hier nicht mit ab</span>`}</span></span></a></li>`)}</ul>
              </section>` : ''}
          </div>

          <div>
            <section class="panel">
              <div class="panel-head"><h2>Pinnwand</h2><a href="/pinnwand">Alle Beiträge</a></div>
              ${d.posts.length ? d.posts.map((p) => html`
                <article class="${p.pinned ? 'post pinned' : 'post'}" style="padding:12px 14px">
                  <div class="row-title">${p.pinned ? html`<span class="tag tag-gruen">${icon('pin', 'icon-s')}Angeheftet</span> ` : ''}${p.title}</div>
                  <div class="post-meta">${p.authorName}, ${ago(p.createdAt)}</div>
                  ${p.body ? html`<div class="md small" style="margin-top:6px">${md(p.body.length > 220 ? `${p.body.slice(0, 220)} …` : p.body)}</div>` : ''}
                </article>`)
              : html`<div class="empty">Noch keine Beiträge.</div>`}
            </section>

            <section class="panel">
              <div class="panel-head"><h2>Zuletzt passiert</h2></div>
              ${d.activity.length ? html`<ul class="feed">${d.activity.map((a) => html`<li>
                <span>${a.who ? html`<b>${a.who}:</b> ` : ''}${a.link ? html`<a href="${a.link}">${a.text}</a>` : a.text}</span>
                <time datetime="${a.at}">${ago(a.at)}</time></li>`)}</ul>`
              : html`<div class="empty">Hier erscheint, was im Team passiert.</div>`}
            </section>
          </div>
        </div>
      </div>`);

    $$('[data-rsvp]', main).forEach((b) => b.addEventListener('click', async () => {
      const status = b.getAttribute('aria-pressed') === 'true' ? null : b.dataset.rsvp;
      if (await attempt(() => put(`/termine/${b.dataset.event}/zusage`, { status }))) load();
    }));
    main.querySelector('[data-plan]')?.addEventListener('click', async () => {
      const id = await newEventDialog(ctx, { type: 'sitzung' });
      if (id) ctx.go(`/termine/${id}`);
    });
  };
  await load();
}
