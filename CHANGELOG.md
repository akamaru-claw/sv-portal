# Changelog

## 2026-10-22 — Durchgesehen und aufgefrischt

### Funktionsprüfung

`tools/pruefung.mjs` geht einmal durch alles, was das Portal kann, und zwar
über die echte API mit Sitzungs-Cookie, `X-SV-Request`-Header und passender
Herkunft — so, wie die Oberfläche es auch tut. **53 Prüfungen, alle grün**,
vor und nach dem Umbau.

Geprüft wird nicht nur, dass etwas geht, sondern auch, dass das Richtige
**nicht** geht:

- Schreiben ohne `X-SV-Request` wird abgewiesen (403),
- ein SV-Mitglied kann keine Einladungen anlegen (403),
- bei einer Abstimmung ohne Lehrer-Stimmrecht wird die Lehrkraft abgewiesen,
  die Schülerin darf,
- eine hochgeladene HTML-Datei kommt **nur** als Download zurück, nie als
  Seite — das ist die Regel, an der sonst Schadcode im Portal landen würde,
- nach dem Abmelden kommt 401.

Am Portal selbst war dabei nichts zu reparieren. Die anfänglichen
Fehlschläge lagen am Prüfskript: Anlegen antwortet mit **201**, nicht 200,
und die Felder heißen `type`/`title`/`closesAt`/`status`/`amount`+`kind`,
die Upload-Felder `files`. Das steht jetzt richtig drin.

### Bewegung (GSAP, Lenis)

Neu: `public/js/motion.js`. `app.js` ist um drei Zeilen erweitert — ein
Import, `starten()` beim Hochfahren und `seiteFertig(feld)` nach jedem
gerenderten Inhalt. Keine Ansicht wurde angefasst.

- **Weiches Scrollen** mit Lenis, getrieben vom GSAP-Ticker. Eine Schleife,
  nicht zwei — sonst löst ScrollTrigger zu früh aus.
- **Auftritte beim Hereinscrollen**, einmalig, leicht versetzt.
- **Seitenwechsel** kurz und flach (0,34 s). Ein auffälliger Übergang macht
  eine Anwendung, die man zwanzig Mal am Tag benutzt, langsam.
- **Zahlen zählen hoch** (Kassenstand, Beteiligung), mit `Intl` formatiert;
  Text drumherum wie `€` und `%` bleibt stehen.
- **Ergebnisbalken wachsen** aus der Breite 0 in die echte Breite.
- **Die Markierung in der Seitenleiste wandert**, statt zu springen, mit
  gelbem Griff an der Kante.
- Lenis hält an, solange ein Dialog oder das Mehr-Menü offen ist.
- `data-lenis-prevent` auf allem, was selbst scrollt.

Fällt das Modul aus, bleibt das Portal vollständig benutzbar: die
Anfangszustände im CSS greifen nur unter `body.js-motion`.
`prefers-reduced-motion` schaltet alles ab.

**Die Falle, die dabei zuschlägt:** Der Auslöser steht bei 94 % der
Fensterhöhe. Ein Element darunter, auf einer Seite, die sich nicht weit
genug scrollen lässt, käme dort nie an und bliebe **dauerhaft unsichtbar** —
ausgerechnet bei einer frisch eingerichteten SV ohne Projekte und Termine,
also im schlimmsten Moment. `niemandVergessen()` zeigt solche Nachzügler
sofort. Nachgemessen auf allen neun Seiten: nirgends bleibt etwas versteckt.
Zusätzlich hebt die CSS unter `prefers-reduced-motion` jeden Anfangszustand
mit `!important` auf.

### Aussehen

Nur Flächen, Kanten, Maße und Verläufe — kein Markup, keine Abläufe. Die
Schriften bleiben: **Atkinson Hyperlegible** ist für schwaches Sehen und
Legasthenie entworfen, **Young Serif** gibt dem Portal sein Gesicht.

- größere Radien (8 → 12 px), weiche gestufte Schatten statt bloßer
  Haarlinien,
- Seitenleiste mit leisem Verlauf und Lichtsaum an der Kante,
- die nächste Sitzung mit hellem Grünschleier und Schein — der dicke grüne
  Rahmen bleibt, er zitiert die Linien der Bildmarke,
- Überschriften enger gesetzt,
- Knöpfe mit Verlauf, drücken sich beim Klick ein,
- Ladezustand als ruhiger Schimmer an der Stelle, an der gleich der Inhalt
  steht, statt „Wird geladen …",
- Tabellenziffern überall dort, wo Zahlen hochzählen — sonst springt die
  Breite.

Hell und dunkel durchgeprüft (`--bg #0E140F`, Flächen `#161E17`), dazu
390 px Breite und die Handy-Leiste unten.

### Bibliotheken

`public/vendor/`: GSAP 3.15.0, ScrollTrigger, Lenis 1.3.27, zusammen rund
136 KB, Herkunft und Lizenzen in `vendor/HERKUNFT.md`. Lokal, weil die Seite
`script-src 'self'` setzt — und damit lädt auch keine Schule beim Aufruf bei
einem Dritten nach.
