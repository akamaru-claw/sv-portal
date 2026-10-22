# Fremde Bibliotheken

Liegen lokal, weil die Seite `script-src 'self'` setzt — vom CDN käme nichts
durch. Außerdem lädt so keine Schule beim Aufruf bei einem Dritten nach.

| Datei | Fassung | Herkunft | Lizenz |
|---|---|---|---|
| `gsap.min.js`, `ScrollTrigger.min.js` | 3.15.0 | cdn.jsdelivr.net/npm/gsap@3.15.0 | GreenSock Standard License; seit 3.13 (Webflow, April 2025) auch für kommerzielle Nutzung kostenlos, Plugins eingeschlossen. Hinweis steht im Dateikopf. |
| `lenis.min.js` | 1.3.27 | unpkg.com/lenis@1.3.27 | MIT |

Zusammen rund 136 KB, einmalig und dauerhaft im Browser-Cache. Geholt am
17.10.2026 für app-arena, von dort am 22.10.2026 unverändert übernommen.

Lenis' mitgeliefertes `lenis.css` ist **nicht** dabei: es setzt nur
`html.lenis { height: auto }` und ein paar Regeln für den Fall, dass Lenis ein
eigenes Scroll-Element bekommt. Beides brauchen wir hier nicht — das Portal
scrollt das Dokument. Die zwei nötigen Zeilen stehen in `css/app.css`.

**Beim Aktualisieren** die Fassungen hier mitführen. Danach prüfen: weiches
Scrollen, Auftritte beim Scrollen, Seitenwechsel, Zahlen zählen hoch,
Abstimmungsbalken wachsen, Konsole leer.
