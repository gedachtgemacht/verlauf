# verlauf.

Macht aus einem WhatsApp-Export ein geprüftes Archivpaket aus HTML und Klartext, das in Jahrzehnten noch lesbar ist.

## Problem

Familien- und Freundeschats sind Erinnerungen, die nur in einer App leben. Der Export von WhatsApp ist eine `_chat.txt` mit Anhängen in einem ZIP, deren Datumsformat je nach Sprache, Plattform und App-Version wechselt und nirgends beschrieben ist. In zwanzig Jahren weiß niemand mehr, wie man die Datei liest, ob sie vollständig ist oder ob jemand etwas verändert hat. Das Problem kommt absehbar: Telefone werden gewechselt, Konten gelöscht, Formate ändern sich, und wer stirbt, hinterlässt Chats, die keiner öffnen kann. Erkennbar ist es schon heute an Exporten, die sich nur mit Entwicklerskripten anzeigen lassen.

## Zielgruppe

Laien, die einen Chat dauerhaft sichern wollen: Eltern mit dem Familienchat, Hinterbliebene, Freundeskreise. Ohne Entwicklerkenntnisse, ohne Upload, am Handy oder Rechner.

## Vorbild und Abgrenzung

Es gibt freie Anzeiger und Umwandler für WhatsApp-Exporte (mtln/chat-export, whats-reader, WhatsApp-Chat-Exporter, ChatParser). Sie zeigen Chats an oder erzeugen HTML, teils nur als Skript für Entwickler. Was fehlt, ist ein **Archivpaket**: schlichtes HTML ohne JavaScript, normalisierter Klartext, maschinenlesbare Nachrichten, eine beiliegende Formatbeschreibung, die unveränderten Originaldateien und eine Prüfsummenliste im Format von `sha256sum`. Dadurch lässt sich das Paket später mit jedem Standardwerkzeug prüfen, auch ohne verlauf. Dazu kommt eine Prüfseite, die zeigt, ob etwas fehlt oder verändert wurde. Ehrlich: Das Anzeigen allein ist nicht neu, neu ist die Verbindung aus Normalisierung, Selbstbeschreibung und Prüfbarkeit für Laien.

## Funktionen v1

- WhatsApp-Export laden: ZIP mit `_chat.txt` und Anhängen oder nur die `.txt`, per Dateiauswahl oder Ziehen.
- Parser für die gängigen Zeilenformate (Android und iOS, Deutsch und Englisch, 12 und 24 Stunden, mit und ohne Sekunden).
- Datumsreihenfolge (Tag/Monat oder Monat/Tag) automatisch erkennen, bei Mehrdeutigkeit die Wahl offen anzeigen und den Nutzer entscheiden lassen.
- Vorschau: Anzahl Nachrichten, Teilnehmende, Zeitraum, Anhänge gefunden und fehlend, nicht erkannte Zeilen.
- Archivpaket als ZIP herunterladen (Aufbau siehe unten).
- Prüfen: Archiv-ZIP laden, alle Prüfsummen nachrechnen, Ergebnis pro Datei `ok`, `geändert`, `fehlt`, `zusätzlich`.
- Beispielchat (erfunden, als `Beispiel` markiert, mit einem Klick entfernbar).

## Nicht-Ziele

- Keine anderen Messenger in v1 (Signal, Telegram, Threema folgen höchstens später, die Spezifikation ist dafür offen).
- Kein Auslesen von Telefon-Datenbanken, kein Entschlüsseln, kein Zugriff auf Backups.
- Keine Signatur oder Zeitstempel durch Dritte. Die Prüfsummen belegen Unverändertheit nur gegenüber einer Liste, die man selbst sicher aufbewahrt.
- Keine Bearbeitung, Suche über mehrere Chats, Statistik oder Cloud.
- Keine Zeitzonen-Umrechnung: WhatsApp exportiert Ortszeit ohne Zone, verlauf. schreibt sie unverändert und sagt das.
- Kein ZIP64: Archive über 4 GB werden abgelehnt, ab 1 GB gibt es eine Warnung.

## Daten und Format

Spezifikation `verlauf-archiv 1`, ausgearbeitet in `SPEC.md`. Alles UTF-8 ohne BOM, Zeilenende LF.

Aufbau des Archiv-ZIP (Methode 0, unkomprimiert, damit es auch mit einfachen Werkzeugen lesbar bleibt):

```
verlauf-<datum-erste>-<datum-letzte>/
  LIESMICH.txt          Formatbeschreibung in Klartext, Deutsch, mit Prüfanleitung
  chat.html             eine Datei, CSS inline, kein JavaScript, Anhänge relativ verlinkt
  chat.txt              normalisierter Klartext
  nachrichten.jsonl     eine Nachricht pro Zeile
  original/_chat.txt    Originaldatei, Byte für Byte unverändert
  original/<anhang>     Anhänge, unverändert
  pruefsummen.sha256    Prüfsummen aller übrigen Dateien
```

`chat.txt`, eine Nachricht pro Block:

```
[2026-10-29 14:05:33] Max Muster: erste Zeile
  Folgezeile, mit zwei Leerzeichen eingerückt
[2026-10-29 14:06] * Erika Beispiel hat die Gruppe erstellt
```

Systemnachrichten ohne Absender beginnen mit `* `. Sekunden nur, wenn im Original vorhanden.

`nachrichten.jsonl`, Felder: `n` (laufende Nummer ab 1), `zeit` (`YYYY-MM-DDTHH:MM` oder mit `:SS`, ohne Zone), `von` (String oder `null` bei System), `text` (String, Zeilen mit `\n`), `anhang` (Dateiname oder `null`), `anhang_vorhanden` (bool), `zeile` (Zeilennummer im Original).

`pruefsummen.sha256`: pro Datei `<64 hex klein><zwei Leerzeichen><pfad relativ zum Paketordner>\n`, sortiert nach Pfad (Bytefolge UTF-8), die Liste selbst nicht enthalten. Damit funktioniert `sha256sum -c pruefsummen.sha256` im Paketordner. Die **Archivkennung** ist die SHA-256 der Datei `pruefsummen.sha256`; die App zeigt sie groß an, damit man sie notieren oder ausdrucken kann.

Versionierung: `LIESMICH.txt` beginnt mit `verlauf-archiv 1`, Felder in `nachrichten.jsonl` dürfen später nur hinzukommen.

Im Browser wird nichts gespeichert außer der Einstellung hell/dunkel in localStorage. Die Exportdateien bleiben im Arbeitsspeicher.

## Rechenlogik

Reine Funktionen in einem ES-Modul `verlauf.js` ohne Abhängigkeiten, nutzbar im Browser und mit Node: `parseChat(text, {reihenfolge})`, `erkenneReihenfolge(zeilen)`, `formatTxt(nachrichten)`, `formatJsonl(nachrichten)`, `formatHtml(nachrichten, meta)`, `sha256Hex(bytes)` (über `crypto.subtle`), `crc32(bytes)`, `zipLesen(bytes)` (Methoden 0 und 8, Entpacken über `DecompressionStream("deflate-raw")`), `zipSchreiben(dateien)` (Methode 0), `pruefe(dateien, liste)`.

Zeilenkopf: Vor dem Parsen werden U+200E, U+200F entfernt und U+202F sowie U+00A0 zu Leerzeichen. Eine Zeile beginnt eine neue Nachricht, wenn sie auf eines dieser Muster passt:

- Android: `D.M.YY, HH:MM - ` oder `M/D/YY, h:MM AM - `
- iOS: `[D.M.YY, HH:MM:SS] ` oder `[M/D/YY, h:MM:SS AM] `

Jahre mit zwei Stellen werden zu `20YY`. Danach `Name: Text`, sonst Systemnachricht. Andere Zeilen hängen an die vorige Nachricht an. Zeilen vor der ersten Nachricht zählen als nicht erkannt.

Reihenfolge: Ist in irgendeinem Datum das erste Feld größer als 12, gilt Tag/Monat; ist das zweite größer als 12, Monat/Tag; widersprechen sich beide, Fehler. Sonst: Punkt als Trenner heißt Tag/Monat, Schrägstrich heißt `unsicher`, und die Oberfläche fragt.

Anhang erkannt bei `<Anhang: DATEI>`, `<attached: DATEI>`, `DATEI (Datei angehängt)` und `DATEI (file attached)`.

Testvektoren:

1. `29.10.26, 14:05 - Max Muster: Hallo` ergibt `{n:1, zeit:"2026-10-29T14:05", von:"Max Muster", text:"Hallo", anhang:null}` und in `chat.txt` die Zeile `[2026-10-29 14:05] Max Muster: Hallo`.
2. `[3/4/26, 2:05:09 PM] Erika Beispiel: Hi` gefolgt von der Zeile `zweite Zeile`: Reihenfolge allein `unsicher`; mit `reihenfolge:"md"` ergibt sich `zeit:"2026-03-04T14:05:09"`, `text:"Hi\nzweite Zeile"`. Kommt im selben Chat `[3/14/26, ...]` vor, wird automatisch `md` erkannt. `12:00 AM` wird `00:00`, `12:00 PM` bleibt `12:00`.
3. Prüfsummen: `sha256Hex("")` = `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`, `sha256Hex("abc")` = `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`, `crc32("123456789")` = `cbf43926`. Ein mit `zipSchreiben` erzeugtes Archiv wird von `zipLesen` byte-gleich zurückgelesen, und nach Ändern eines Bytes in `chat.txt` meldet `pruefe` genau diese Datei als `geändert`.

## Demoseite

`index.html`, Handy zuerst, drei Bereiche als Reiter:

- **umwandeln**: Feld zum Ziehen oder Auswählen, Knopf `beispiel laden`. Danach Übersicht in `--mono`: nachrichten, teilnehmende, zeitraum, anhänge da/fehlend, nicht erkannte zeilen (aufklappbar mit Zeilennummern). Bei `unsicher` zwei Knöpfe mit Beispieldatum in beiden Lesarten. Vorschau der ersten Nachrichten wie in `chat.html`. Knopf `archiv herunterladen`, danach die Archivkennung groß mit Hinweis, sie getrennt aufzubewahren.
- **prüfen**: Archiv-ZIP laden, Archivkennung anzeigen und optional mit einer eingetippten vergleichen, Liste der Dateien mit Status.
- **über**: was verlauf. tut und was nicht, Grenzen, Hinweis auf `sha256sum -c`, Datenschutz.

Hell und dunkel, Hausstil, Name `verlauf.` mit Punkt in `--ac`. PWA mit `manifest.webmanifest`, `sw.js`, `icon.svg` (Sprechblase, aus der eine Linie wie ein Zeitstrahl läuft).

## Testplan

- `node --test`: alle Testvektoren oben, dazu Fixtures für Android DE, Android EN 12h, iOS DE, iOS EN, Mehrzeiler, Systemnachrichten, Anhänge (vorhanden und fehlend), Datei mit BOM und CRLF, leere Datei, widersprüchliche Reihenfolge. Fixtures nur mit erfundenen Namen.
- Rundlauf: Beispielchat umwandeln, Archiv lesen, `pruefe` meldet alles `ok`; Datei entfernen ergibt `fehlt`, Datei hinzufügen `zusätzlich`.
- Gegenprobe mit Standardwerkzeug: entpacktes Archiv besteht `sha256sum -c pruefsummen.sha256`, `unzip -t` meldet keine Fehler.
- `chat.html` enthält kein `<script` und keine URL mit `http`.
- Browsertest bei 390 und 1280 px, hell und dunkel, alle drei Reiter, Beispiel laden und entfernen.
- Offline-Test: nach erstem Laden Netz aus, Seite lädt und wandelt um.
- Keine externen Requests: Netzwerkprotokoll beim Durchklicken leer bis auf eigene Dateien.

## Risiken

- WhatsApp ändert das Exportformat ohne Ankündigung; der Parser deckt nur die bekannten Varianten ab und zeigt nicht erkannte Zeilen offen an, statt still zu raten.
- Große Exporte mit vielen Videos können am Handy den Arbeitsspeicher sprengen, weil das ZIP im Speicher entsteht.
- Prüfsummen schützen nicht gegen jemanden, der Dateien und Liste gemeinsam fälscht; das muss die Seite klar sagen (Archivkennung getrennt aufheben).
- Exporte ohne Medien oder mit gekürztem Verlauf sind nicht vollständig; verlauf. kann nur archivieren, was im Export steht.
- `DecompressionStream` fehlt in sehr alten Browsern; dann geht nur die `.txt`.

## Offene Fragen

- Welche weiteren Datums- und Sprachvarianten (etwa Französisch, Spanisch, Punkt statt Doppelpunkt in der Uhrzeit) in echten Exporten vorkommen, ist nicht vollständig geprüft.
- Ob Laien die Archivkennung tatsächlich getrennt aufbewahren, ist Vermutung; vielleicht braucht es ein druckbares Blatt.
- Ob HTML ohne Skript und UTF-8-Klartext in 30 Jahren problemlos lesbar sind, ist eine begründete Annahme, kein Beweis.
- Ob ein Archivformat wie BagIt oder ein PDF/A-Ausdruck später als Option sinnvoll ist, bleibt offen.
