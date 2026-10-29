// verlauf. Kern: reine Funktionen ohne Abhängigkeiten, für Browser und Node.
// Format: verlauf-archiv 1, beschrieben in SPEC.md.
// Lizenz: AGPL-3.0

export const FORMAT = 'verlauf-archiv 1';
export const WARNGRENZE = 1024 * 1024 * 1024; // ab 1 GB Warnung
export const ZIP_GRENZE = 0xffffffff; // kein ZIP64

const enc = new TextEncoder();

// ---------- Text vorbereiten ----------

// Entfernt BOM, Richtungszeichen U+200E/U+200F, macht U+202F/U+00A0 zu Leerzeichen und CRLF/CR zu LF.
export function normalisiere(text) {
  return String(text)
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[‎‏]/g, '')
    .replace(/[  ]/g, ' ');
}

// Zerlegt in Zeilen. Ein abschließendes LF erzeugt keine leere letzte Zeile.
export function zerlegeZeilen(text) {
  if (text === '') return [];
  const z = text.split('\n');
  if (z[z.length - 1] === '') z.pop();
  return z;
}

// ---------- Zeilenkopf ----------

const KOPF_ANDROID = /^(\d{1,2})([./])(\d{1,2})\2(\d{4}|\d{2}), (\d{1,2}):(\d{2})(?::(\d{2}))?(?: ?([AaPp])\.? ?[Mm]\.?)? - ([\s\S]*)$/;
const KOPF_IOS = /^\[(\d{1,2})([./])(\d{1,2})\2(\d{4}|\d{2}),? (\d{1,2}):(\d{2})(?::(\d{2}))?(?: ?([AaPp])\.? ?[Mm]\.?)?\] ([\s\S]*)$/;

// Liefert die Teile eines Nachrichtenkopfs oder null.
export function kopf(zeile) {
  const m = KOPF_ANDROID.exec(zeile) || KOPF_IOS.exec(zeile);
  if (!m) return null;
  return {
    a: +m[1], trenner: m[2], b: +m[3], jahr: m[4],
    h: +m[5], min: +m[6], s: m[7] === undefined ? null : m[7],
    ampm: m[8] ? m[8].toLowerCase() : null, rest: m[9]
  };
}

const p2 = (x) => String(x).padStart(2, '0');

function tageImMonat(jahr, monat) {
  return [31, (jahr % 4 === 0 && jahr % 100 !== 0) || jahr % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][monat - 1];
}

// Zeitstempel YYYY-MM-DDTHH:MM[:SS] aus einem Kopf, oder null bei ungültigem Datum.
export function zeitAus(k, reihenfolge) {
  const tag = reihenfolge === 'md' ? k.b : k.a;
  const monat = reihenfolge === 'md' ? k.a : k.b;
  const jahr = k.jahr.length === 2 ? 2000 + Number(k.jahr) : Number(k.jahr);
  let h = k.h;
  if (k.ampm) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (k.ampm === 'p' ? 12 : 0);
  }
  if (h > 23 || k.min > 59 || (k.s !== null && Number(k.s) > 59)) return null;
  if (monat < 1 || monat > 12 || tag < 1 || tag > tageImMonat(jahr, monat)) return null;
  return `${jahr}-${p2(monat)}-${p2(tag)}T${p2(h)}:${p2(k.min)}` + (k.s !== null ? ':' + k.s : '');
}

// ---------- Reihenfolge ----------

// 'dm' (Tag/Monat), 'md' (Monat/Tag), 'unsicher' oder 'widerspruch'.
export function erkenneReihenfolge(zeilen) {
  let dm = false, md = false, schraeg = false;
  for (const roh of zeilen) {
    const k = kopf(normalisiere(roh));
    if (!k) continue;
    if (k.a > 12) dm = true;
    if (k.b > 12) md = true;
    if (k.trenner === '/') schraeg = true;
  }
  if (dm && md) return 'widerspruch';
  if (dm) return 'dm';
  if (md) return 'md';
  return schraeg ? 'unsicher' : 'dm';
}

// ---------- Absender und Anhang ----------

function absender(rest) {
  const i = rest.indexOf(': ');
  if (i > 0) return { von: rest.slice(0, i), text: rest.slice(i + 2) };
  if (rest.endsWith(':') && rest.length > 1 && !rest.includes('\n')) return { von: rest.slice(0, -1), text: '' };
  return { von: null, text: rest };
}

const ANHANG_KLAMMER = /<(?:Anhang|attached): ([^>\n]+)>/;
const ANHANG_ANDROID = /^(.+?) \((?:Datei angehängt|file attached)\)/m;

export function anhangAus(text) {
  const m = ANHANG_KLAMMER.exec(text) || ANHANG_ANDROID.exec(text);
  return m ? m[1].trim() : null;
}

export function basename(pfad) {
  const i = pfad.lastIndexOf('/');
  return i < 0 ? pfad : pfad.slice(i + 1);
}

// ---------- Parser ----------

// parseChat(text, {reihenfolge, anhaenge}) liefert Nachrichten, nicht erkannte Zeilen und Warnungen.
// reihenfolge: 'dm' oder 'md'; fehlt sie, wird sie erkannt. anhaenge: Dateinamen, die im Export liegen.
export function parseChat(text, { reihenfolge, anhaenge } = {}) {
  if (reihenfolge !== undefined && reihenfolge !== null && reihenfolge !== 'dm' && reihenfolge !== 'md') {
    throw new Error('reihenfolge muss dm oder md sein');
  }
  const zeilen = zerlegeZeilen(normalisiere(text));
  const erkannt = erkenneReihenfolge(zeilen);
  if (!reihenfolge && erkannt === 'widerspruch') {
    throw new Error('widersprüchliche datumsreihenfolge: manche daten sind nur als tag/monat, andere nur als monat/tag gültig');
  }
  const r = reihenfolge || (erkannt === 'dm' ? 'dm' : 'md');
  const vorhanden = new Set((anhaenge || []).map(basename));
  const roh = [], unerkannt = [], warnungen = [];
  let akt = null;
  zeilen.forEach((zeile, i) => {
    const nr = i + 1;
    const k = kopf(zeile);
    const zeit = k ? zeitAus(k, r) : null;
    if (k && !zeit) warnungen.push({ zeile: nr, grund: 'ungültiges datum, als folgezeile behandelt', text: zeile });
    if (zeit) {
      akt = { zeit, ...absender(k.rest), zeile: nr };
      roh.push(akt);
    } else if (akt) {
      akt.text += '\n' + zeile;
    } else if (zeile.trim() !== '') {
      unerkannt.push({ zeile: nr, text: zeile });
    }
  });
  const nachrichten = roh.map((m, i) => {
    const anhang = anhangAus(m.text);
    return {
      n: i + 1, zeit: m.zeit, von: m.von, text: m.text,
      anhang, anhang_vorhanden: anhang !== null && vorhanden.has(anhang), zeile: m.zeile
    };
  });
  return {
    nachrichten, unerkannt, warnungen,
    reihenfolge: r, reihenfolgeErkannt: erkannt,
    vorlaeufig: !reihenfolge && erkannt === 'unsicher',
    zeilen: zeilen.length
  };
}

// Kennzahlen für Übersicht, HTML und LIESMICH.
export function uebersicht(nachrichten) {
  const teilnehmende = [];
  const gesehen = new Set();
  let da = 0;
  const fehlend = [];
  for (const m of nachrichten) {
    if (m.von !== null && !gesehen.has(m.von)) { gesehen.add(m.von); teilnehmende.push(m.von); }
    if (m.anhang !== null) { if (m.anhang_vorhanden) da++; else fehlend.push(m.anhang); }
  }
  return {
    anzahl: nachrichten.length,
    teilnehmende,
    erste: nachrichten.length ? nachrichten[0].zeit : null,
    letzte: nachrichten.length ? nachrichten[nachrichten.length - 1].zeit : null,
    anhaengeDa: da,
    anhaengeFehlend: fehlend
  };
}

// ---------- Ausgabeformate ----------

export function formatTxt(nachrichten) {
  return nachrichten.map((m) => {
    const [erste, ...rest] = m.text.split('\n');
    const kopfzeile = '[' + m.zeit.replace('T', ' ') + '] ' + (m.von === null ? '* ' : m.von + ': ') + erste;
    return [kopfzeile, ...rest.map((z) => '  ' + z)].join('\n') + '\n';
  }).join('');
}

export function formatJsonl(nachrichten) {
  return nachrichten.map((m) => JSON.stringify({
    n: m.n, zeit: m.zeit, von: m.von, text: m.text,
    anhang: m.anhang, anhang_vorhanden: m.anhang_vorhanden, zeile: m.zeile
  }) + '\n').join('');
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const BILD = /\.(jpe?g|png|gif|webp)$/i;

const HTML_CSS = `:root{color-scheme:light dark;--bg:#fbfaf7;--tx:#1d1c21;--mu:#6b6975;--li:#e2e0e8;--bl:#f0eef6;--ac:#5a47d6;--wa:#9a6d0c}
@media (prefers-color-scheme:dark){:root{--bg:#121216;--tx:#ecebf2;--mu:#8b8a97;--li:#2a2a33;--bl:#1c1c23;--ac:#9b8afb;--wa:#f2c25c}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.w{max-width:42rem;margin:0 auto;padding:1rem}
header{border-bottom:1px solid var(--li);padding-bottom:.75rem;margin-bottom:.5rem}
h1{font-size:1.35rem;margin:.25rem 0;overflow-wrap:anywhere}
.meta{color:var(--mu);font:13px/1.6 ui-monospace,Menlo,Consolas,monospace;margin:.2rem 0}
h2{font:600 13px/1 ui-monospace,Menlo,Consolas,monospace;color:var(--mu);text-align:center;margin:1.5rem 0 .6rem}
.m{background:var(--bl);border-radius:12px;padding:.5rem .75rem;margin:.4rem 0}
.k{font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;color:var(--mu);margin:0}
.k b{color:var(--ac);font-weight:600}
.t{margin:.15rem 0 0;white-space:pre-wrap;overflow-wrap:anywhere}
.s{text-align:center;color:var(--mu);font-size:14px;margin:.6rem 1rem;white-space:pre-wrap;overflow-wrap:anywhere}
.s time{font:12px ui-monospace,Menlo,Consolas,monospace}
.a{margin:.35rem 0 0;font:13px/1.4 ui-monospace,Menlo,Consolas,monospace;overflow-wrap:anywhere}
.a a{color:var(--ac)}
.a img{display:block;max-width:100%;height:auto;border-radius:8px;margin-top:.3rem}
.f{color:var(--wa)}
footer{border-top:1px solid var(--li);margin-top:2rem;padding-top:.75rem;color:var(--mu);font:12px/1.6 ui-monospace,Menlo,Consolas,monospace}
@media print{body{background:#fff;color:#000}.m{break-inside:avoid;border:1px solid #ccc}}`;

function pfadUrl(pfad) {
  return pfad.split('/').map(encodeURIComponent).join('/');
}

// formatHtml(nachrichten, meta): eine HTML-Datei, CSS inline, ohne JavaScript.
// meta.titel, meta.anhangPfade ({dateiname: pfad relativ zum Paketordner}), meta.ohneLinks (Vorschau).
export function formatHtml(nachrichten, meta = {}) {
  const titel = meta.titel || 'chat';
  const pfade = meta.anhangPfade || {};
  const u = uebersicht(nachrichten);
  const zeitraum = u.erste ? u.erste.slice(0, 10) + ' bis ' + u.letzte.slice(0, 10) : 'leer';
  const teile = [];
  let tag = null;
  for (const m of nachrichten) {
    const d = m.zeit.slice(0, 10);
    if (d !== tag) { tag = d; teile.push(`<h2>${d}</h2>`); }
    const uhr = m.zeit.slice(11);
    let anhang = '';
    if (m.anhang !== null) {
      if (m.anhang_vorhanden && !meta.ohneLinks && pfade[m.anhang]) {
        const href = esc(pfadUrl(pfade[m.anhang]));
        anhang = BILD.test(m.anhang)
          ? `<p class="a"><a href="${href}"><img src="${href}" alt="${esc(m.anhang)}" loading="lazy"></a></p>`
          : `<p class="a">anhang: <a href="${href}">${esc(m.anhang)}</a></p>`;
      } else if (m.anhang_vorhanden) {
        anhang = `<p class="a">anhang: ${esc(m.anhang)}</p>`;
      } else {
        anhang = `<p class="a f">anhang fehlt im export: ${esc(m.anhang)}</p>`;
      }
    }
    if (m.von === null) {
      teile.push(`<p class="s" id="n${m.n}"><time datetime="${m.zeit}">${uhr}</time> ${esc(m.text)}</p>`);
    } else {
      teile.push(`<article class="m" id="n${m.n}"><p class="k"><b>${esc(m.von)}</b> <time datetime="${m.zeit}">${uhr}</time></p><p class="t">${esc(m.text)}</p>${anhang}</article>`);
    }
  }
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${FORMAT}">
<title>${esc(titel)}</title>
<style>
${HTML_CSS}
</style>
</head>
<body>
<div class="w">
<header>
<h1>${esc(titel)}</h1>
<p class="meta">${u.anzahl} nachrichten · ${zeitraum} · ${u.teilnehmende.length} teilnehmende</p>
<p class="meta">${esc(u.teilnehmende.join(', '))}</p>
<p class="meta">zeiten sind ortszeit ohne zeitzone, wie im export.</p>
</header>
<main>
${teile.join('\n')}
</main>
<footer>${FORMAT}. beschreibung in LIESMICH.txt, originaldateien im ordner original.</footer>
</div>
</body>
</html>
`;
}

// LIESMICH.txt: Formatbeschreibung und Prüfanleitung in Klartext.
export function formatLiesmich(info) {
  const u = info.uebersicht;
  const liste = (a) => (a.length ? a.join(', ') : 'keine');
  return `${FORMAT}

Dieses Paket ist das Archiv eines WhatsApp-Chats, erstellt mit verlauf.
Es ist so gebaut, dass es ohne besondere Software lesbar und
prüfbar bleibt: Klartext, HTML ohne JavaScript, die unveränderten
Originaldateien und eine Liste mit Prüfsummen.

ÜBERBLICK

Chat:           ${info.titel}
Zeitraum:       ${u.erste.replace('T', ' ')} bis ${u.letzte.replace('T', ' ')}
                (Ortszeit ohne Zeitzone, so wie im Export)
Nachrichten:    ${u.anzahl}
Teilnehmende:   ${liste(u.teilnehmende)}
Anhänge:        ${u.anhaengeDa} vorhanden, ${u.anhaengeFehlend.length} fehlen im Export
Datumslesart:   ${info.reihenfolge === 'md' ? 'Monat/Tag' : 'Tag/Monat'}
Nicht erkannt:  ${info.unerkannt} Zeilen vor der ersten Nachricht
                (sie stehen nur im Original)
Warnungen:      ${info.warnungen} Zeilen mit ungültigem Datum
Originalname:   ${info.chatName}

DATEIEN

LIESMICH.txt        diese Beschreibung
chat.html           der Chat zum Lesen im Browser, ohne JavaScript
chat.txt            der Chat als normalisierter Klartext
nachrichten.jsonl   eine Nachricht pro Zeile als JSON
original/_chat.txt  die Chatdatei aus dem Export, Byte für Byte
original/...        die Anhänge aus dem Export, unverändert
pruefsummen.sha256  SHA-256 aller Dateien außer dieser Liste

Alle Textdateien sind UTF-8 ohne BOM, Zeilenende LF.

FORMAT chat.txt

Jede Nachricht beginnt mit einer Kopfzeile:
  [JJJJ-MM-TT HH:MM] Name: erste Zeile
Sekunden stehen nur da, wenn der Export sie enthält:
  [JJJJ-MM-TT HH:MM:SS] Name: erste Zeile
Weitere Zeilen derselben Nachricht sind mit zwei Leerzeichen
eingerückt. Nachrichten ohne Absender (Systemmeldungen) haben
statt "Name:" einen Stern:
  [JJJJ-MM-TT HH:MM] * Text

FORMAT nachrichten.jsonl

Eine Zeile pro Nachricht, jede Zeile ein JSON-Objekt:
  n                 laufende Nummer ab 1
  zeit              JJJJ-MM-TTTHH:MM oder JJJJ-MM-TTTHH:MM:SS,
                    Ortszeit ohne Zone
  von               Name als Text, null bei Systemmeldungen
  text              Text der Nachricht, Zeilen mit \\n getrennt
  anhang            Dateiname des Anhangs oder null
  anhang_vorhanden  true, wenn der Anhang im Ordner original liegt
  zeile             Zeilennummer der Kopfzeile in original/_chat.txt
Spätere Versionen dürfen Felder nur hinzufügen.

PRÜFEN

1. Das ZIP entpacken und in diesen Ordner wechseln.
2. Im Terminal ausführen:
     sha256sum -c pruefsummen.sha256
   Auf macOS:
     shasum -a 256 -c pruefsummen.sha256
   Jede Zeile muss mit OK enden. Unter Windows lässt sich jede
   Datei einzeln prüfen mit: certutil -hashfile DATEI SHA256
3. Die Archivkennung ist die SHA-256 der Datei pruefsummen.sha256:
     sha256sum pruefsummen.sha256
   Vergleiche sie mit der Kennung, die du beim Erstellen notiert
   und getrennt aufbewahrt hast.

GRENZEN

Die Prüfsummen zeigen nur, dass die Dateien zur Liste passen. Wer
Dateien und Liste gemeinsam austauscht, fällt nur auf, wenn du die
Archivkennung getrennt aufbewahrt hast. Es gibt keine Signatur und
keinen Zeitstempel durch Dritte.

Das Archiv enthält nur, was im Export stand. Exporte ohne Medien
oder mit gekürztem Verlauf sind unvollständig. Zeiten sind die
Ortszeit des exportierenden Geräts ohne Zeitzone.

Die vollständige Beschreibung des Formats heißt "${FORMAT}"
und gehört zum freien Programm verlauf. (Lizenz AGPL-3.0).
`;
}

// ---------- Prüfsummen ----------

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

const ror = (x, n) => (x >>> n) | (x << (32 - n));

// SHA-256 in reinem JavaScript, falls crypto.subtle fehlt (zum Beispiel ohne HTTPS).
export function sha256Rein(daten) {
  const b = typeof daten === 'string' ? enc.encode(daten) : daten;
  const len = b.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const m = new Uint8Array(total);
  m.set(b);
  m[len] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, Math.floor(len / 0x20000000));
  dv.setUint32(total - 4, (len * 8) >>> 0);
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const W = new Uint32Array(64);
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const w15 = W[i - 15], w2 = W[i - 2];
      const s0 = ror(w15, 7) ^ ror(w15, 18) ^ (w15 >>> 3);
      const s1 = ror(w2, 17) ^ ror(w2, 19) ^ (w2 >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, bb, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + W[i]) >>> 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + bb) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return H.map((x) => x.toString(16).padStart(8, '0')).join('');
}

// SHA-256 als 64 Zeichen hex, klein. Nutzt crypto.subtle, sonst sha256Rein.
export async function sha256Hex(daten) {
  const b = typeof daten === 'string' ? enc.encode(daten) : daten;
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) return sha256Rein(b);
  const h = new Uint8Array(await subtle.digest('SHA-256', b));
  return Array.from(h, (x) => x.toString(16).padStart(2, '0')).join('');
}

const CRC_TABELLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

// CRC-32 (ZIP, IEEE 802.3) als vorzeichenlose Zahl.
export function crc32(daten) {
  const b = typeof daten === 'string' ? enc.encode(daten) : daten;
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABELLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Vergleich nach UTF-8-Bytefolge.
export function vergleicheUtf8(x, y) {
  const a = enc.encode(x), b = enc.encode(y);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

// Prüft, ob ein Pfad ins Archiv und in eine sha256sum-Liste passt.
export function pfadFehler(pfad) {
  if (pfad === '') return 'leerer pfad';
  if (/[\n\r\\]/.test(pfad)) return 'zeilenumbruch oder backslash im namen';
  if (pfad.startsWith('/')) return 'absoluter pfad';
  if (pfad.split('/').some((t) => t === '..' || t === '.' || t === '')) return 'unzulässiger pfadteil';
  return null;
}

// Inhalt von pruefsummen.sha256 für [{name, daten}].
export async function formatPruefsummen(dateien) {
  const zeilen = [];
  for (const d of dateien) {
    const f = pfadFehler(d.name);
    if (f) throw new Error(`${f}: ${d.name}`);
    zeilen.push({ pfad: d.name, hash: await sha256Hex(d.daten) });
  }
  zeilen.sort((x, y) => vergleicheUtf8(x.pfad, y.pfad));
  return zeilen.map((z) => `${z.hash}  ${z.pfad}\n`).join('');
}

// Liest eine sha256sum-Liste. Liefert Map pfad -> hash und fehlerhafte Zeilen.
export function leseListe(liste) {
  const soll = new Map();
  const fehlerhaft = [];
  liste.split('\n').forEach((z, i) => {
    const zeile = z.replace(/\r$/, '');
    if (zeile === '') return;
    const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(zeile);
    if (!m || soll.has(m[2])) { fehlerhaft.push({ zeile: i + 1, text: zeile }); return; }
    soll.set(m[2], m[1].toLowerCase());
  });
  return { soll, fehlerhaft };
}

// pruefe(dateien, liste): dateien [{name, daten}] relativ zum Paketordner, liste als Text oder Bytes.
// Status pro Datei: ok, geändert, fehlt, zusätzlich.
export async function pruefe(dateien, liste) {
  const listeBytes = typeof liste === 'string' ? enc.encode(liste) : liste;
  const listeText = typeof liste === 'string' ? liste : new TextDecoder().decode(liste);
  const { soll, fehlerhaft } = leseListe(listeText);
  const ist = new Map();
  for (const d of dateien) if (d.name !== 'pruefsummen.sha256') ist.set(d.name, d.daten);
  const ergebnisse = [];
  for (const [pfad, hash] of soll) {
    if (!ist.has(pfad)) { ergebnisse.push({ pfad, status: 'fehlt', soll: hash, ist: null }); continue; }
    const h = await sha256Hex(ist.get(pfad));
    ergebnisse.push({ pfad, status: h === hash ? 'ok' : 'geändert', soll: hash, ist: h });
  }
  for (const [pfad, daten] of ist) {
    if (!soll.has(pfad)) ergebnisse.push({ pfad, status: 'zusätzlich', soll: null, ist: await sha256Hex(daten) });
  }
  ergebnisse.sort((x, y) => vergleicheUtf8(x.pfad, y.pfad));
  const zaehler = { ok: 0, 'geändert': 0, fehlt: 0, 'zusätzlich': 0 };
  for (const e of ergebnisse) zaehler[e.status]++;
  return {
    kennung: await sha256Hex(listeBytes),
    ergebnisse, zaehler, fehlerhafteZeilen: fehlerhaft,
    alleOk: fehlerhaft.length === 0 && soll.size > 0 && ergebnisse.every((e) => e.status === 'ok')
  };
}

// ---------- ZIP ----------

const CP437 = 'ÇüéâäàåçêëèïîìÄÅ' + 'ÉæÆôöòûùÿÖÜ¢£¥₧ƒ' + 'áíóúñÑªº¿⌐¬½¼¡«»' + '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧' + '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' + 'αßΓπΣσµτΦΘΩδ∞φε∩' + '≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

export function cp437(bytes) {
  let s = '';
  for (const b of bytes) s += b < 128 ? String.fromCharCode(b) : CP437[b - 128];
  return s;
}

function zipName(bytes, utf8Flag) {
  if (utf8Flag) return new TextDecoder().decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return cp437(bytes); }
}

async function inflateRaw(roh) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('dieser browser kann keine komprimierten zip-dateien entpacken, lade nur die .txt');
  }
  const strom = new Blob([roh]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(strom).arrayBuffer());
}

export function istZip(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5) && (bytes[3] === 4 || bytes[3] === 6);
}

// zipLesen(bytes): [{name, daten, methode, crcOk, fehler}], Ordnereinträge werden übersprungen.
export async function zipLesen(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o) => dv.getUint16(o, true), u32 = (o) => dv.getUint32(o, true);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 65535; i--) {
    if (u32(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('keine zip-datei: ende des verzeichnisses nicht gefunden');
  const anzahl = u16(eocd + 10), cdGroesse = u32(eocd + 12), cdStart = u32(eocd + 16);
  if (anzahl === 0xffff || cdStart === 0xffffffff || cdGroesse === 0xffffffff) throw new Error('zip64 wird nicht unterstützt');
  if (cdStart + cdGroesse > eocd) throw new Error('zip beschädigt: verzeichnis außerhalb der datei');
  const aus = [];
  let p = cdStart;
  for (let i = 0; i < anzahl; i++) {
    if (p + 46 > eocd || u32(p) !== 0x02014b50) throw new Error('zip beschädigt: zentralverzeichnis');
    const flags = u16(p + 8), methode = u16(p + 10), crc = u32(p + 16);
    const csize = u32(p + 20), usize = u32(p + 24);
    const nlen = u16(p + 28), elen = u16(p + 30), klen = u16(p + 32), lho = u32(p + 42);
    const name = zipName(bytes.subarray(p + 46, p + 46 + nlen), flags & 0x0800);
    p += 46 + nlen + elen + klen;
    if (csize === 0xffffffff || usize === 0xffffffff || lho === 0xffffffff) throw new Error('zip64 wird nicht unterstützt');
    if (lho + 30 > bytes.length || u32(lho) !== 0x04034b50) throw new Error('zip beschädigt: lokaler kopf fehlt bei ' + name);
    const start = lho + 30 + u16(lho + 26) + u16(lho + 28);
    if (start + csize > bytes.length) throw new Error('zip beschädigt: daten abgeschnitten bei ' + name);
    if (name.endsWith('/') && usize === 0) continue;
    const roh = bytes.subarray(start, start + csize);
    let daten = null, fehler = null;
    if (flags & 1) fehler = 'verschlüsselt';
    else if (methode === 0) daten = roh.slice();
    else if (methode === 8) daten = await inflateRaw(roh);
    else fehler = `kompressionsmethode ${methode} nicht unterstützt`;
    if (daten && daten.length !== usize) fehler = 'größe stimmt nicht mit dem verzeichnis überein';
    aus.push({ name, daten, methode, crcOk: daten ? crc32(daten) === crc : false, fehler });
  }
  return aus;
}

function dosStempel(zeit) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(zeit || '');
  if (!m || +m[1] < 1980) return { dzeit: 0, ddatum: (0 << 9) | (1 << 5) | 1 };
  return {
    dzeit: (+m[4] << 11) | (+m[5] << 5) | ((+(m[6] || 0)) >> 1),
    ddatum: ((Math.min(+m[1], 2107) - 1980) << 9) | (+m[2] << 5) | +m[3]
  };
}

// zipTeile(dateien, {zeit}): ZIP ohne Kompression (Methode 0) als Liste von Bytefolgen.
export function zipTeile(dateien, { zeit } = {}) {
  const { dzeit, ddatum } = dosStempel(zeit);
  if (dateien.length > 0xfffe) throw new Error('zu viele dateien für zip ohne zip64');
  const teile = [], zentral = [];
  let offset = 0;
  for (const d of dateien) {
    const name = enc.encode(d.name), daten = d.daten, crc = crc32(daten);
    const lh = new Uint8Array(30 + name.length), v = new DataView(lh.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 10, true); v.setUint16(6, 0x0800, true);
    v.setUint16(8, 0, true); v.setUint16(10, dzeit, true); v.setUint16(12, ddatum, true);
    v.setUint32(14, crc, true); v.setUint32(18, daten.length, true); v.setUint32(22, daten.length, true);
    v.setUint16(26, name.length, true); v.setUint16(28, 0, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length), w = new DataView(ch.buffer);
    w.setUint32(0, 0x02014b50, true); w.setUint16(4, 10, true); w.setUint16(6, 10, true);
    w.setUint16(8, 0x0800, true); w.setUint16(10, 0, true); w.setUint16(12, dzeit, true);
    w.setUint16(14, ddatum, true); w.setUint32(16, crc, true); w.setUint32(20, daten.length, true);
    w.setUint32(24, daten.length, true); w.setUint16(28, name.length, true);
    w.setUint32(42, offset, true);
    ch.set(name, 46);
    teile.push(lh, daten);
    zentral.push(ch);
    offset += lh.length + daten.length;
    if (offset > ZIP_GRENZE) throw new Error('archiv größer als 4 GB, zip64 wird nicht unterstützt');
  }
  const cdGroesse = zentral.reduce((s, c) => s + c.length, 0);
  if (offset + cdGroesse + 22 > ZIP_GRENZE) throw new Error('archiv größer als 4 GB, zip64 wird nicht unterstützt');
  const ende = new Uint8Array(22), e = new DataView(ende.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, dateien.length, true); e.setUint16(10, dateien.length, true);
  e.setUint32(12, cdGroesse, true); e.setUint32(16, offset, true);
  return [...teile, ...zentral, ende];
}

export function verbinde(teile) {
  const n = teile.reduce((s, t) => s + t.length, 0);
  const aus = new Uint8Array(n);
  let o = 0;
  for (const t of teile) { aus.set(t, o); o += t.length; }
  return aus;
}

// zipSchreiben(dateien, {zeit}): ZIP (Methode 0) als eine Bytefolge.
export function zipSchreiben(dateien, opt) {
  return verbinde(zipTeile(dateien, opt));
}

// ---------- Export laden und Archiv bauen ----------

// Titel aus dem Dateinamen eines Exports ("WhatsApp Chat mit Familie.zip" -> "Familie").
export function titelAus(dateiname) {
  const t = basename(dateiname || '')
    .replace(/\.(zip|txt)$/i, '')
    .replace(/^WhatsApp[ -]Chat( mit| with| -)? ?/i, '')
    .trim();
  return t && t !== '_chat' ? t : 'chat';
}

// ladeExport(bytes, dateiname): ZIP mit _chat.txt und Anhängen oder nur die .txt.
export async function ladeExport(bytes, dateiname = '') {
  const titel = titelAus(dateiname);
  if (!istZip(bytes)) return { chatName: basename(dateiname) || '_chat.txt', chatBytes: bytes, anhaenge: [], titel };
  const eintraege = await zipLesen(bytes);
  const txt = eintraege.filter((e) => /\.txt$/i.test(e.name));
  const chat = eintraege.find((e) => basename(e.name) === '_chat.txt')
    || (txt.length === 1 ? txt[0] : txt.find((e) => /^WhatsApp/i.test(basename(e.name))));
  if (!chat) throw new Error('im zip keine chatdatei gefunden (_chat.txt)');
  const kaputt = eintraege.filter((e) => e.fehler || !e.crcOk);
  if (kaputt.length) throw new Error('zip-eintrag nicht lesbar: ' + kaputt.map((e) => `${e.name} (${e.fehler || 'crc falsch'})`).join(', '));
  return {
    chatName: chat.name, chatBytes: chat.daten,
    anhaenge: eintraege.filter((e) => e !== chat).map((e) => ({ name: e.name, daten: e.daten })),
    titel: titel === 'chat' ? titelAus(chat.name) : titel
  };
}

// baueArchiv(export, {reihenfolge}): erzeugt alle Dateien, Prüfsummen, Archivkennung und ZIP-Teile.
export async function baueArchiv({ chatName = '_chat.txt', chatBytes, anhaenge = [], titel = 'chat' }, { reihenfolge } = {}) {
  const text = new TextDecoder('utf-8').decode(chatBytes);
  const ergebnis = parseChat(text, { reihenfolge, anhaenge: anhaenge.map((a) => a.name) });
  if (ergebnis.vorlaeufig) throw new Error('datumsreihenfolge unsicher, bitte tag/monat oder monat/tag wählen');
  const { nachrichten } = ergebnis;
  if (!nachrichten.length) throw new Error('keine nachrichten erkannt');
  const u = uebersicht(nachrichten);
  const ordner = `verlauf-${u.erste.slice(0, 10)}-${u.letzte.slice(0, 10)}`;
  const anhangDateien = anhaenge.map((a) => ({ name: 'original/' + a.name, daten: a.daten }));
  const anhangPfade = {};
  for (const a of anhaenge) {
    const b = basename(a.name);
    if (!(b in anhangPfade)) anhangPfade[b] = 'original/' + a.name;
  }
  const dateien = [
    { name: 'LIESMICH.txt', daten: enc.encode(formatLiesmich({
      titel, uebersicht: u, reihenfolge: ergebnis.reihenfolge, chatName: basename(chatName),
      unerkannt: ergebnis.unerkannt.length, warnungen: ergebnis.warnungen.length
    })) },
    { name: 'chat.html', daten: enc.encode(formatHtml(nachrichten, { titel, anhangPfade })) },
    { name: 'chat.txt', daten: enc.encode(formatTxt(nachrichten)) },
    { name: 'nachrichten.jsonl', daten: enc.encode(formatJsonl(nachrichten)) },
    { name: 'original/_chat.txt', daten: chatBytes },
    ...anhangDateien
  ];
  const namen = new Set();
  for (const d of dateien) {
    if (namen.has(d.name) || d.name === 'pruefsummen.sha256') throw new Error('doppelter dateiname im archiv: ' + d.name);
    namen.add(d.name);
  }
  const liste = await formatPruefsummen(dateien);
  const listeBytes = enc.encode(liste);
  const kennung = await sha256Hex(listeBytes);
  dateien.push({ name: 'pruefsummen.sha256', daten: listeBytes });
  const zipDateien = dateien.map((d) => ({ name: ordner + '/' + d.name, daten: d.daten }));
  const teile = zipTeile(zipDateien, { zeit: u.letzte });
  return {
    ordner, dateiname: ordner + '.zip', dateien, liste, kennung, teile,
    groesse: teile.reduce((s, t) => s + t.length, 0), ergebnis, uebersicht: u
  };
}

// Sucht im gelesenen ZIP den Paketordner (dort, wo pruefsummen.sha256 liegt).
export function paketAusZip(eintraege) {
  const listen = eintraege.filter((e) => basename(e.name) === 'pruefsummen.sha256')
    .sort((x, y) => x.name.length - y.name.length);
  if (!listen.length) throw new Error('keine pruefsummen.sha256 im archiv gefunden');
  const prefix = listen[0].name.slice(0, -'pruefsummen.sha256'.length);
  const dateien = eintraege.filter((e) => e !== listen[0]).map((e) => ({
    name: e.name.startsWith(prefix) ? e.name.slice(prefix.length) : '../' + e.name,
    daten: e.daten || new Uint8Array(0)
  }));
  return { ordner: prefix.replace(/\/$/, ''), liste: listen[0].daten, dateien };
}

// pruefeArchiv(bytes): Archiv-ZIP lesen und alle Prüfsummen nachrechnen.
export async function pruefeArchiv(bytes) {
  const eintraege = await zipLesen(bytes);
  const paket = paketAusZip(eintraege);
  const res = await pruefe(paket.dateien, paket.liste);
  const zipFehler = eintraege.filter((e) => e.fehler || !e.crcOk).map((e) => ({ name: e.name, grund: e.fehler || 'crc stimmt nicht' }));
  return { ordner: paket.ordner, ...res, zipFehler, alleOk: res.alleOk && zipFehler.length === 0 };
}

// ---------- Beispiel (erfunden) ----------

export const BEISPIEL_CHAT = `12.04.26, 09:14 - Nachrichten und Anrufe sind Ende-zu-Ende-verschlüsselt. Niemand außerhalb dieses Chats kann sie lesen oder anhören.
12.04.26, 09:14 - Erika Beispiel hat die Gruppe „Familie Muster“ erstellt
12.04.26, 09:15 - Erika Beispiel hat Max Muster hinzugefügt
12.04.26, 09:15 - Erika Beispiel hat Lena Muster hinzugefügt
12.04.26, 09:17 - Erika Beispiel: Damit wir Omas Geburtstag planen können 🎂
12.04.26, 09:20 - Max Muster: Gute Idee. Ich kann am Samstag ab Mittag.
12.04.26, 09:22 - Lena Muster: Ich bringe den Kuchen mit.
Den mit Kirschen, wie letztes Jahr.
Wer holt die Kerzen?
12.04.26, 09:25 - Max Muster: Ich
12.04.26, 18:03 - Erika Beispiel: Erika Beispiel.vcf (Datei angehängt)
12.04.26, 18:04 - Erika Beispiel: Meine neue Nummer, bitte speichern
13.04.26, 11:40 - Lena Muster: IMG-20260413-WA0003.jpg (Datei angehängt)
So sieht der Kuchen aus
13.04.26, 11:41 - Max Muster: 😍
13.04.26, 11:42 - Max Muster: <Medien ausgeschlossen>
14.04.26, 20:12 - Erika Beispiel: Danke euch allen, Oma hat sich riesig gefreut.
Bis zum nächsten Mal!
14.04.26, 20:15 - Lena Muster hat die Gruppe verlassen
`;

export const BEISPIEL_VCF = `BEGIN:VCARD
VERSION:3.0
FN:Erika Beispiel
N:Beispiel;Erika;;;
EMAIL:erika@example.org
NOTE:Beispiel, erfunden
END:VCARD
`;

// Erfundener Beispielexport: Chat, ein vorhandener Anhang, ein fehlender (das Foto).
export function beispielExport() {
  return {
    chatName: '_chat.txt',
    chatBytes: enc.encode(BEISPIEL_CHAT),
    anhaenge: [{ name: 'Erika Beispiel.vcf', daten: enc.encode(BEISPIEL_VCF) }],
    titel: 'Beispiel: Familie Muster',
    beispiel: true
  };
}
