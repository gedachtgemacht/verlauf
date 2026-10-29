# verlauf-archiv 1

Spezifikation des Archivformats von verlauf. und der Regeln, nach denen ein WhatsApp-Export gelesen wird. Ziel: Jemand anderes kann Archive erzeugen und prüfen, die mit denen von verlauf. byte-gleich sind (für die normativen Dateien), und jedes Archiv lässt sich ohne verlauf. mit Standardwerkzeugen prüfen.

Die Schlüsselwörter **muss**, **darf** und **soll** sind normativ. Referenzimplementierung: `verlauf.js` (ES-Modul, nur Standardbibliothek von Browser und Node). Testvektoren: `testvektoren.json`.

## 1. Allgemeines

- Alle Textdateien, die verlauf. erzeugt, sind UTF-8 ohne BOM, Zeilenende LF (`0x0A`).
- Zeiten sind Ortszeit des exportierenden Geräts **ohne Zeitzone**. Es gibt keine Umrechnung. Wer Zeitzonen braucht, muss sie außerhalb des Archivs festhalten.
- Das Format ist für WhatsApp gebaut. Andere Quellen dürfen in späteren Versionen dazukommen (siehe Abschnitt 9).

## 2. Aufbau des Archivs

Das Archiv ist eine ZIP-Datei mit genau einem Ordner auf oberster Ebene:

```
verlauf-<erste>-<letzte>/
  LIESMICH.txt
  chat.html
  chat.txt
  nachrichten.jsonl
  original/_chat.txt
  original/<anhang>            (beliebig viele, auch in Unterordnern)
  pruefsummen.sha256
```

- `<erste>` und `<letzte>` sind die Daten (`JJJJ-MM-TT`) der ersten und der letzten Nachricht **in Dateireihenfolge** (nicht Minimum und Maximum).
- `original/_chat.txt` ist die Chatdatei des Exports, Byte für Byte, unabhängig vom ursprünglichen Dateinamen. Der ursprüngliche Name steht in `LIESMICH.txt`.
- `original/<pfad>` sind alle übrigen Dateien des Export-ZIPs mit ihrem Pfad im Export-ZIP, Byte für Byte. Ordnereinträge werden nicht übernommen.
- Ein Archiv mit null Nachrichten wird nicht erzeugt.

### 2.1 ZIP

- Jede Datei mit Methode 0 (gespeichert, unkomprimiert). Damit bleibt der Inhalt auch mit sehr einfachen Werkzeugen oder von Hand auslesbar.
- Bit 11 der Flags (Namen in UTF-8) gesetzt, keine Extra-Felder, keine Kommentare, keine Data-Descriptoren, Version 1.0.
- Änderungszeit aller Einträge: Zeit der letzten Nachricht als DOS-Zeit (Sekunden auf gerade Zahl abgerundet); vor 1980 gilt 1980-01-01 00:00. Dadurch ist das ZIP für denselben Export reproduzierbar.
- Reihenfolge der Einträge: `LIESMICH.txt`, `chat.html`, `chat.txt`, `nachrichten.jsonl`, `original/_chat.txt`, Anhänge in Export-Reihenfolge, zuletzt `pruefsummen.sha256`.
- **Kein ZIP64.** Wird das Archiv größer als 4 294 967 295 Bytes oder hat es mehr als 65 534 Einträge, muss die Erzeugung mit Fehler abbrechen. Ab 1 GiB soll eine Warnung erscheinen.

Die Reihenfolge der Einträge und die ZIP-Zeit sind für die Prüfung unerheblich. Normativ für die Prüfung sind nur die Dateiinhalte und `pruefsummen.sha256`.

### 2.2 Pfade

Ein Pfad (relativ zum Paketordner) ist unzulässig, wenn er leer ist, mit `/` beginnt, einen Teil `.`, `..` oder einen leeren Teil (`a//b`) hat oder `\`, CR oder LF enthält. Bei einem unzulässigen Pfad muss die Erzeugung abbrechen. Grund: `sha256sum` maskiert solche Namen, und die Liste wäre nicht mehr eindeutig lesbar.

## 3. Lesen des Exports

### 3.1 Export erkennen

- Beginnt die Datei mit `PK\x03\x04` (oder `PK\x05\x06` für ein leeres ZIP), ist sie ein ZIP. Sonst ist sie die Chatdatei selbst.
- Im ZIP ist die Chatdatei der Eintrag mit dem Dateinamen `_chat.txt` (in beliebigem Ordner). Fehlt er: der einzige Eintrag mit Endung `.txt`; gibt es mehrere, der erste, dessen Name mit `WhatsApp` beginnt; sonst Fehler.
- Unterstützt werden die Methoden 0 und 8 (Deflate). Andere Methoden, verschlüsselte Einträge, falsche CRC-32 oder abweichende Größe führen zum Abbruch, damit nichts Beschädigtes als „unverändert“ archiviert wird.
- Namen ohne UTF-8-Flag werden als UTF-8 gelesen, wenn sie gültiges UTF-8 sind, sonst als CP437.

### 3.2 Normalisierung

Die Chatdatei wird als UTF-8 gelesen (ungültige Folgen werden zu U+FFFD; das Original bleibt unberührt). Vor dem Parsen, in dieser Reihenfolge:

1. Ein BOM U+FEFF am Anfang wird entfernt.
2. CRLF und einzelnes CR werden zu LF.
3. U+200E und U+200F werden entfernt.
4. U+202F und U+00A0 werden zu U+0020.

Die Normalisierung gilt auch für den Nachrichtentext. Danach wird an LF in Zeilen zerlegt. Endet der Text mit LF, entsteht dadurch keine leere letzte Zeile. Zeilennummern zählen ab 1 und entsprechen den Zeilen der Originaldatei.

### 3.3 Nachrichtenkopf

Eine Zeile beginnt eine neue Nachricht, wenn sie vollständig auf eines der beiden Muster passt (`a`, `b` sind die beiden ersten Datumsfelder):

```
Android: ^(a)([./])(b)\2(JJ|JJJJ), (h):(MM)(:SS)?( ?(A|P)\.? ?M\.?)? - (Rest)$
iOS:     ^\[(a)([./])(b)\2(JJ|JJJJ),? (h):(MM)(:SS)?( ?(A|P)\.? ?M\.?)?\] (Rest)$
```

`a`, `b` und `h` haben 1 oder 2 Ziffern, `MM` und `SS` genau 2, das Jahr 2 oder 4. `AM`/`PM` ist groß oder klein, mit oder ohne Punkte. Beispiele: `29.10.26, 14:05 - `, `10/29/26, 2:05 PM - `, `[29.10.26, 14:05:33] `, `[3/4/26, 2:05:09 PM] `. Die Referenzimplementierung akzeptiert damit etwas mehr als die vier Grundformen (Sekunden bei Android, keine Sekunden bei iOS, vierstellige Jahre); diese Erweiterung ist Teil dieser Version.

Umrechnung, wenn die Reihenfolge feststeht (3.4):

- Jahr mit zwei Ziffern: `20JJ`.
- Mit `AM`/`PM`: Stunde muss 1 bis 12 sein; `12 AM` wird `00`, `1 PM` bis `11 PM` werden `13` bis `23`, `12 PM` bleibt `12`.
- Gültig nur, wenn Monat 1 bis 12, Tag 1 bis Monatslänge (gregorianische Schaltjahre), Stunde 0 bis 23, Minute und Sekunde 0 bis 59.
- Ergebnis `JJJJ-MM-TTTHH:MM`, mit `:SS` nur, wenn Sekunden im Original stehen.

Passt eine Zeile auf das Muster, ergibt aber kein gültiges Datum, ist sie **kein** Kopf: Sie wird wie eine Folgezeile behandelt und als Warnung (`zeile`, `grund`, `text`) gemeldet.

Nach dem Kopf (`Rest`):

- Enthält `Rest` die Folge `: ` an einer Stelle größer 0, ist alles davor der Absender (`von`), alles danach der erste Textteil.
- Sonst, wenn `Rest` mit `:` endet und mehr als ein Zeichen hat: Absender ist `Rest` ohne `:`, Text leer.
- Sonst ist es eine Systemnachricht: `von` ist `null`, Text ist `Rest`.

Jede Zeile, die kein gültiger Kopf ist, wird mit LF an den Text der vorigen Nachricht angehängt, auch leere Zeilen. Zeilen vor der ersten Nachricht sind **nicht erkannt**; nicht leere davon werden mit Nummer gemeldet und stehen nur im Original.

### 3.4 Datumsreihenfolge

Über alle Kopfzeilen (nur Muster, ohne Gültigkeitsprüfung):

1. Ist irgendwo `a > 12` und irgendwo `b > 12`: `widerspruch`.
2. Ist irgendwo `a > 12`: `dm` (Tag/Monat).
3. Ist irgendwo `b > 12`: `md` (Monat/Tag).
4. Sonst: kommt irgendwo `/` als Trenner vor, `unsicher`, sonst `dm`.

Bei `unsicher` muss die Oberfläche fragen und die Wahl offen anzeigen (zwei Lesarten des ersten Datums). Bei `widerspruch` ohne Wahl ist das ein Fehler; mit Wahl werden die unmöglichen Daten nach 3.3 zu Folgezeilen mit Warnung. Ein Archiv darf erst nach einer Entscheidung entstehen.

### 3.5 Anhänge

Im Text einer Nachricht wird zuerst gesucht nach `<Anhang: DATEI>` oder `<attached: DATEI>` (irgendwo, ohne `>` und LF im Namen), dann nach einer Zeile, die mit `DATEI (Datei angehängt)` oder `DATEI (file attached)` beginnt. Der erste Treffer zählt, `DATEI` ohne Leerraum an den Rändern. `anhang_vorhanden` ist wahr, wenn im Export eine Datei mit genau diesem Dateinamen (letzter Pfadteil) liegt. `<Medien ausgeschlossen>` und `<Media omitted>` sind kein Anhang.

## 4. chat.txt (normativ)

Pro Nachricht, in Dateireihenfolge:

```
"[" + zeit mit Leerzeichen statt T + "] " + (von + ": " | "* ") + erste Textzeile + LF
für jede weitere Textzeile: "  " + Zeile + LF
```

Auch leere Folgezeilen bekommen die zwei Leerzeichen. Eine Zeile, die mit `[` beginnt, ist damit immer ein Kopf. Bei leerer erster Zeile steht nach `: ` nichts (die Zeile endet mit einem Leerzeichen). Ein Chat ohne Nachrichten ergibt eine leere Datei.

```
[2026-10-29 14:05:33] Max Muster: erste Zeile
  Folgezeile
[2026-10-29 14:06] * Erika Beispiel hat die Gruppe erstellt
```

## 5. nachrichten.jsonl (normativ)

Pro Nachricht eine Zeile JSON (RFC 8259) ohne Leerraum zwischen den Elementen, gefolgt von LF, Schlüssel in dieser Reihenfolge:

| Feld | Typ | Bedeutung |
|---|---|---|
| `n` | Zahl | laufende Nummer ab 1 |
| `zeit` | String | `JJJJ-MM-TTTHH:MM` oder `JJJJ-MM-TTTHH:MM:SS`, ohne Zone |
| `von` | String oder `null` | Absender, `null` bei Systemnachricht |
| `text` | String | Text, Zeilen mit `\n` getrennt |
| `anhang` | String oder `null` | Dateiname des Anhangs |
| `anhang_vorhanden` | Bool | Anhang liegt unter `original/` |
| `zeile` | Zahl | Zeilennummer des Kopfs in `original/_chat.txt` |

Strings werden wie `JSON.stringify` in JavaScript kodiert: `"`, `\` und Steuerzeichen maskiert (`\n`, `\t`, sonst `\u00XX` klein), alles andere roh in UTF-8, auch U+2028 und U+2029.

## 6. chat.html und LIESMICH.txt (nicht byte-normativ)

`chat.html`: eine HTML-Datei, CSS inline, **kein JavaScript** (kein `<script`, keine Event-Attribute), keine Ressourcen außerhalb des Pakets. Anhänge sind relativ verlinkt (`original/...`, Pfadteile URL-kodiert), Bilder (`jpg`, `jpeg`, `png`, `gif`, `webp`) eingebettet mit `<img>`. Fehlende Anhänge sind als fehlend benannt. Text ist HTML-maskiert, Zeilenumbrüche bleiben per `white-space:pre-wrap`. Jede Nachricht trägt `id="n<n>"`.

`LIESMICH.txt` muss mit der Zeile `verlauf-archiv 1` beginnen, gefolgt von LF. Danach in Klartext auf Deutsch: Überblick (Titel, Zeitraum, Anzahl, Teilnehmende, Anhänge, Datumslesart, nicht erkannte Zeilen, Warnungen, ursprünglicher Dateiname), Beschreibung der Dateien und der Formate aus 4 und 5, Prüfanleitung, Grenzen.

Inhalt und Gestaltung beider Dateien dürfen sich zwischen Implementierungen unterscheiden. Darum hängt die Archivkennung eines bestimmten Exports von der Implementierung ab. Die Prüfung (Abschnitt 7) hängt davon nicht ab.

## 7. pruefsummen.sha256 und Archivkennung (normativ)

Für jede Datei des Pakets außer der Liste selbst eine Zeile:

```
<SHA-256, 64 Zeichen hex, klein><zwei Leerzeichen><Pfad relativ zum Paketordner>LF
```

sortiert nach dem Pfad als UTF-8-Bytefolge (wie `LC_ALL=C sort`, **nicht** nach UTF-16-Codeeinheiten). Damit gilt im Paketordner:

```
sha256sum -c pruefsummen.sha256
```

Die **Archivkennung** ist die SHA-256 (hex, klein) der Bytes von `pruefsummen.sha256`. Sie steht nicht im Archiv. Sie soll groß angezeigt und getrennt vom Archiv aufbewahrt werden.

### 7.1 Prüfen

1. Den Paketordner im ZIP finden: der Eintrag `pruefsummen.sha256` mit dem kürzesten Pfad. Alle Einträge darunter werden relativ dazu benannt, Einträge außerhalb als `../<voller pfad>`.
2. Die Liste zeilenweise lesen. Ein CR am Zeilenende wird ignoriert, leere Zeilen ebenso. Gültig ist `^[0-9a-fA-F]{64} [ *](.+)$` (der Stern ist der Binärmodus von `sha256sum`). Ungültige oder doppelte Pfade sind **fehlerhafte Zeilen**.
3. Status pro Pfad:
   - `ok`: in Liste und Paket, Prüfsumme gleich
   - `geändert`: in Liste und Paket, Prüfsumme verschieden
   - `fehlt`: in der Liste, nicht im Paket
   - `zusätzlich`: im Paket, nicht in der Liste
4. Ergebnis „alles in Ordnung“ nur, wenn die Liste mindestens einen Eintrag hat, es keine fehlerhaften Zeilen gibt, jeder Status `ok` ist und alle ZIP-Einträge lesbar sind (Methode, CRC-32, Größe).
5. Die Archivkennung neu berechnen und, wenn eine notierte Kennung vorliegt, vergleichen (Leerraum ignorieren, Groß- und Kleinschreibung egal).

## 8. Fehlerfälle

| Fall | Verhalten |
|---|---|
| Datei ist kein ZIP und keine erkennbare Chatdatei | keine Nachrichten, kein Archiv |
| ZIP ohne Chatdatei | Fehler |
| ZIP64, verschlüsselt, Methode ≠ 0/8, CRC falsch | Fehler beim Laden; beim Prüfen als ZIP-Fehler gemeldet |
| Reihenfolge `unsicher` | Wahl nötig, vorher kein Archiv |
| Reihenfolge `widerspruch` | Fehler ohne Wahl, mit Wahl Warnungen |
| ungültiges Datum im Kopf | Folgezeile mit Warnung |
| Zeilen vor der ersten Nachricht | nicht erkannt, gemeldet, nur im Original |
| unzulässiger Pfad, doppelter Name | Fehler |
| über 4 GiB | Fehler; ab 1 GiB Warnung |
| `DecompressionStream` fehlt | Methode-8-ZIPs nicht lesbar, nur `.txt` |

## 9. Versionierung

- Die erste Zeile von `LIESMICH.txt` nennt die Version: `verlauf-archiv 1`.
- In `nachrichten.jsonl` dürfen spätere Versionen Felder nur **hinzufügen**. Leser müssen unbekannte Felder ignorieren.
- Eine Änderung an `chat.txt`, an der Liste oder an der Bedeutung bestehender Felder ist eine neue Hauptversion (`verlauf-archiv 2`).
- Andere Messenger dürfen dazukommen; dann soll ein Feld `quelle` ergänzt werden. `original/_chat.txt` heißt dann weiter so, oder die neue Version legt einen anderen Namen fest.

## 10. Testvektoren

`testvektoren.json` enthält:

- `parse`: Eingabe, Optionen, erwartete erkannte Reihenfolge, Nachrichten, `chat.txt`, teils `nachrichten.jsonl`, nicht erkannte Zeilen.
- `reihenfolge`: Zeilen und Ergebnis nach 3.4.
- `sha256`, `crc32`: bekannte Werte, unter anderem `sha256("abc") = ba7816bf…20015ad`, `crc32("123456789") = cbf43926`.
- `pruefsummen`: Dateien, erwartete Liste (mit einem Fall, in dem UTF-8- und UTF-16-Sortierung auseinanderfallen: `original/Ａ.jpg` vor `original/😀.jpg`) und Archivkennung `4ee25225…3d15`. Liste und Kennung wurden unabhängig mit Pythons `hashlib` nachgerechnet.

Die Referenzimplementierung läuft mit `node --test` gegen alle Vektoren. Zusätzlich wird ein erzeugtes Archiv mit `unzip -t` und `sha256sum -c` gegengeprüft.

## 11. Bewusst offen

- Weitere Sprachen und Varianten (Französisch, Spanisch, Punkt statt Doppelpunkt in der Uhrzeit, andere Wörter für „Datei angehängt“) sind nicht geprüft und werden nicht erkannt.
- Systemmeldungen, die `: ` enthalten (etwa ein Gruppenname mit Doppelpunkt), werden als Nachricht mit Absender gelesen. Auf iOS stehen Systemmeldungen unter dem Gruppennamen als Absender; nach dem Entfernen von U+200E sind sie nicht mehr unterscheidbar. Eine bessere Erkennung ist Vermutung und nicht Teil dieser Version.
- Keine Signatur, kein Zeitstempel durch Dritte. Ob BagIt oder ein PDF/A-Ausdruck als zusätzliche Hülle sinnvoll ist, bleibt offen.
- Dass HTML ohne Skript und UTF-8-Klartext in Jahrzehnten lesbar bleiben, ist eine begründete Annahme, kein Beweis.
