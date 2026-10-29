// Tests für verlauf.js gegen die Testvektoren aus scope.md und testvektoren.json.
// Aufruf: node test-calc.js  oder  node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as v from './verlauf.js';

const hier = dirname(fileURLToPath(import.meta.url));
const tv = JSON.parse(readFileSync(join(hier, 'testvektoren.json'), 'utf8'));
const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- Testvektoren aus testvektoren.json ----------

for (const f of tv.parse) {
  test('parse: ' + f.name, () => {
    const r = v.parseChat(f.eingabe, f.optionen);
    assert.equal(r.reihenfolgeErkannt, f.reihenfolge_erkannt);
    assert.deepEqual(r.nachrichten, f.nachrichten);
    assert.equal(v.formatTxt(r.nachrichten), f.txt);
    if ('jsonl' in f) assert.equal(v.formatJsonl(r.nachrichten), f.jsonl);
    assert.deepEqual(r.unerkannt, f.unerkannt);
  });
}

for (const f of tv.reihenfolge) {
  test('reihenfolge: ' + f.zeilen.join(' | '), () => {
    assert.equal(v.erkenneReihenfolge(f.zeilen), f.ergebnis);
  });
}

function eingabe(f) {
  return f.eingabe_wiederholt ? f.eingabe_wiederholt.zeichen.repeat(f.eingabe_wiederholt.anzahl) : f.eingabe_utf8;
}

test('sha256: vektoren über crypto.subtle und reines javascript', async () => {
  for (const f of tv.sha256) {
    assert.equal(await v.sha256Hex(eingabe(f)), f.hex);
    assert.equal(v.sha256Rein(eingabe(f)), f.hex);
  }
  // Grenzfälle der Auffüllung: 55, 56, 63, 64 Bytes
  for (const n of [55, 56, 63, 64, 65, 119, 120]) {
    const b = new Uint8Array(n).fill(0x61);
    assert.equal(v.sha256Rein(b), await v.sha256Hex(b), 'länge ' + n);
  }
});

test('crc32: vektoren', () => {
  for (const f of tv.crc32) assert.equal(v.crc32(f.eingabe_utf8).toString(16).padStart(8, '0'), f.hex);
});

test('pruefsummen: liste und archivkennung', async () => {
  for (const f of tv.pruefsummen) {
    const dateien = Object.entries(f.dateien_utf8).map(([name, inhalt]) => ({ name, daten: enc.encode(inhalt) }));
    const liste = await v.formatPruefsummen(dateien);
    assert.equal(liste, f.liste);
    assert.equal(await v.sha256Hex(liste), f.kennung);
    const r = await v.pruefe(dateien, liste);
    assert.equal(r.kennung, f.kennung);
    assert.ok(r.alleOk);
  }
});

// ---------- Testvektoren aus scope.md, ausgeschrieben ----------

test('scope 1: android de', () => {
  const r = v.parseChat('29.10.26, 14:05 - Max Muster: Hallo');
  const m = r.nachrichten[0];
  assert.equal(m.n, 1);
  assert.equal(m.zeit, '2026-10-29T14:05');
  assert.equal(m.von, 'Max Muster');
  assert.equal(m.text, 'Hallo');
  assert.equal(m.anhang, null);
  assert.equal(v.formatTxt(r.nachrichten), '[2026-10-29 14:05] Max Muster: Hallo\n');
});

test('scope 2: ios en, reihenfolge unsicher, md, 12 am und pm', () => {
  const text = '[3/4/26, 2:05:09 PM] Erika Beispiel: Hi\nzweite Zeile';
  assert.equal(v.erkenneReihenfolge(text.split('\n')), 'unsicher');
  const ohne = v.parseChat(text);
  assert.equal(ohne.vorlaeufig, true);
  const r = v.parseChat(text, { reihenfolge: 'md' });
  assert.equal(r.nachrichten[0].zeit, '2026-03-04T14:05:09');
  assert.equal(r.nachrichten[0].text, 'Hi\nzweite Zeile');
  assert.equal(r.vorlaeufig, false);
  const mit14 = v.parseChat(text + '\n[3/14/26, 8:00:00 AM] Max Muster: Ok');
  assert.equal(mit14.reihenfolgeErkannt, 'md');
  assert.equal(mit14.nachrichten[1].zeit, '2026-03-14T08:00:00');
  const am = v.parseChat('[1/1/26, 12:00:00 AM] A: x\n[1/1/26, 12:00:00 PM] A: y', { reihenfolge: 'md' });
  assert.equal(am.nachrichten[0].zeit, '2026-01-01T00:00:00');
  assert.equal(am.nachrichten[1].zeit, '2026-01-01T12:00:00');
});

test('scope 3: sha256, crc32', async () => {
  assert.equal(await v.sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(await v.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(v.crc32('123456789'), 0xcbf43926);
});

test('scope 3: zipSchreiben und zipLesen byte-gleich', async () => {
  const dateien = [
    { name: 'a/LIESMICH.txt', daten: enc.encode('verlauf-archiv 1\n') },
    { name: 'a/leer', daten: new Uint8Array(0) },
    { name: 'a/original/Über 😀.bin', daten: Uint8Array.from({ length: 3000 }, (_, i) => (i * 7) & 255) }
  ];
  const zip = v.zipSchreiben(dateien, { zeit: '2026-10-29T14:05:33' });
  const gelesen = await v.zipLesen(zip);
  assert.equal(gelesen.length, 3);
  gelesen.forEach((g, i) => {
    assert.equal(g.name, dateien[i].name);
    assert.deepEqual(g.daten, dateien[i].daten);
    assert.equal(g.methode, 0);
    assert.ok(g.crcOk);
    assert.equal(g.fehler, null);
  });
  // gleiche Eingabe, gleiches ZIP
  assert.deepEqual(v.zipSchreiben(dateien, { zeit: '2026-10-29T14:05:33' }), zip);
});

test('scope 3: ein geändertes byte in chat.txt meldet genau diese datei', async () => {
  const a = await v.baueArchiv(v.beispielExport());
  const dateien = a.dateien.map((d) => ({ name: d.name, daten: d.daten.slice() }));
  const chat = dateien.find((d) => d.name === 'chat.txt');
  chat.daten[5] ^= 1;
  const r = await v.pruefe(dateien, a.liste);
  const nichtOk = r.ergebnisse.filter((e) => e.status !== 'ok');
  assert.deepEqual(nichtOk.map((e) => [e.pfad, e.status]), [['chat.txt', 'geändert']]);
  assert.equal(r.alleOk, false);
});

// ---------- Fixtures ----------

test('fixture android de: mehrzeiler, system, anhänge', () => {
  const r = v.parseChat(v.BEISPIEL_CHAT, { anhaenge: ['Erika Beispiel.vcf'] });
  assert.equal(r.reihenfolgeErkannt, 'dm');
  assert.equal(r.nachrichten.length, 15);
  assert.equal(r.unerkannt.length, 0);
  const u = v.uebersicht(r.nachrichten);
  assert.deepEqual(u.teilnehmende, ['Erika Beispiel', 'Max Muster', 'Lena Muster']);
  assert.equal(u.erste, '2026-04-12T09:14');
  assert.equal(u.letzte, '2026-04-14T20:15');
  assert.equal(u.anhaengeDa, 1);
  assert.deepEqual(u.anhaengeFehlend, ['IMG-20260413-WA0003.jpg']);
  const kuchen = r.nachrichten[6];
  assert.equal(kuchen.text, 'Ich bringe den Kuchen mit.\nDen mit Kirschen, wie letztes Jahr.\nWer holt die Kerzen?');
  assert.equal(kuchen.zeile, 7);
  assert.equal(r.nachrichten[8].zeile, 11);
  assert.equal(r.nachrichten[0].von, null);
  assert.equal(r.nachrichten[14].von, null);
  assert.equal(r.nachrichten[14].zeile, 19);
  assert.equal(r.nachrichten[14].text, 'Lena Muster hat die Gruppe verlassen');
});

test('fixture android en 12h', () => {
  const r = v.parseChat('10/29/26, 9:05 AM - Max Muster: Morning\n10/29/26, 11:59 PM - Erika Beispiel: Night\n10/30/26, 12:01 AM - Max Muster joined using this group\'s invite link');
  assert.equal(r.reihenfolgeErkannt, 'md');
  assert.deepEqual(r.nachrichten.map((m) => m.zeit), ['2026-10-29T09:05', '2026-10-29T23:59', '2026-10-30T00:01']);
  assert.equal(r.nachrichten[2].von, null);
});

test('fixture ios de', () => {
  const r = v.parseChat('[01.11.26, 08:00:01] Lena Muster: Guten Morgen\n[01.11.26, 08:00:59] Max Muster: ‎<Anhang: 00000001-AUDIO-2026-11-01-08-00-59.opus>');
  assert.equal(r.reihenfolgeErkannt, 'dm');
  assert.equal(r.nachrichten[0].zeit, '2026-11-01T08:00:01');
  assert.equal(r.nachrichten[1].anhang, '00000001-AUDIO-2026-11-01-08-00-59.opus');
  assert.equal(r.nachrichten[1].anhang_vorhanden, false);
});

test('fixture ios en mit attached', () => {
  const r = v.parseChat('[11/1/26, 8:00:01 AM] Lena Muster: ‎<attached: 00000002-PHOTO-2026-11-01-08-00-01.jpg>\n[11/13/26, 1:00:00 PM] Max Muster: nice', { anhaenge: ['00000002-PHOTO-2026-11-01-08-00-01.jpg'] });
  assert.equal(r.reihenfolgeErkannt, 'md');
  assert.equal(r.nachrichten[0].anhang_vorhanden, true);
  assert.equal(r.nachrichten[1].zeit, '2026-11-13T13:00:00');
});

test('android de: anhang (datei angehängt)', () => {
  const r = v.parseChat('29.10.26, 14:05 - Max Muster: Rezept.pdf (Datei angehängt)\nfür Samstag', { anhaenge: ['Rezept.pdf'] });
  assert.equal(r.nachrichten[0].anhang, 'Rezept.pdf');
  assert.equal(r.nachrichten[0].anhang_vorhanden, true);
});

test('vierstellige jahre und leere nachricht nach doppelpunkt', () => {
  const r = v.parseChat('29.10.2026, 14:05 - Max Muster:\nText in der nächsten Zeile');
  assert.equal(r.nachrichten[0].zeit, '2026-10-29T14:05');
  assert.equal(r.nachrichten[0].von, 'Max Muster');
  assert.equal(r.nachrichten[0].text, '\nText in der nächsten Zeile');
  assert.equal(v.formatTxt(r.nachrichten), '[2026-10-29 14:05] Max Muster: \n  Text in der nächsten Zeile\n');
});

test('widersprüchliche reihenfolge: fehler ohne wahl, warnungen mit wahl', () => {
  const text = '13/1/26, 10:00 - A: x\n1/13/26, 10:00 - A: y';
  assert.throws(() => v.parseChat(text), /widersprüchlich/);
  const r = v.parseChat(text, { reihenfolge: 'dm' });
  assert.equal(r.nachrichten.length, 1);
  assert.equal(r.nachrichten[0].text, 'x\n1/13/26, 10:00 - A: y');
  assert.equal(r.warnungen.length, 1);
  assert.equal(r.warnungen[0].zeile, 2);
});

test('ungültige datumsangaben und uhrzeiten sind kein nachrichtenkopf', () => {
  const r = v.parseChat('28.02.26, 10:00 - A: x\n30.02.26, 10:00 - A: y\n28.02.26, 24:00 - A: z');
  assert.equal(r.nachrichten.length, 1);
  assert.equal(r.warnungen.length, 2);
  assert.equal(v.parseChat('29.02.28, 10:00 - A: Schalttag').nachrichten[0].zeit, '2028-02-29T10:00');
});

test('unbekannte reihenfolge wird abgelehnt', () => {
  assert.throws(() => v.parseChat('x', { reihenfolge: 'ym' }));
});

test('jsonl: jede zeile ist gültiges json mit allen feldern', () => {
  const r = v.parseChat(v.BEISPIEL_CHAT);
  const zeilen = v.formatJsonl(r.nachrichten).split('\n');
  assert.equal(zeilen.pop(), '');
  for (const z of zeilen) {
    assert.deepEqual(Object.keys(JSON.parse(z)), ['n', 'zeit', 'von', 'text', 'anhang', 'anhang_vorhanden', 'zeile']);
  }
});

test('html: kein script, keine http-url, text maskiert', () => {
  const html = v.formatHtml(v.parseChat('29.10.26, 14:05 - Max <b>: <script>alert(1)</script>').nachrichten, { titel: 'T&<' });
  assert.ok(!html.includes('<script'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<title>T&amp;&lt;</title>'));
});

test('cp437 tabelle hat 128 zeichen', () => {
  assert.equal(v.cp437(Uint8Array.from({ length: 128 }, (_, i) => i + 128)).length, 128);
  assert.equal(v.cp437(Uint8Array.of(0x81, 0x84, 0x94, 0xe1)), 'üäöß');
});

test('titel aus dateinamen', () => {
  assert.equal(v.titelAus('WhatsApp Chat mit Familie Muster.zip'), 'Familie Muster');
  assert.equal(v.titelAus('WhatsApp Chat - Freunde.zip'), 'Freunde');
  assert.equal(v.titelAus('_chat.txt'), 'chat');
});

test('pfade: unzulässige namen werden abgelehnt', async () => {
  for (const p of ['../x', '/x', 'a//b', 'a\\b', 'a\nb', '']) assert.ok(v.pfadFehler(p), p);
  await assert.rejects(v.formatPruefsummen([{ name: 'a\nb', daten: new Uint8Array(0) }]));
});

test('liste: binärmodus mit stern, crlf und kaputte zeilen', async () => {
  const d = [{ name: 'chat.txt', daten: enc.encode('abc') }];
  const r = await v.pruefe(d, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad *chat.txt\r\nunsinn\n');
  assert.equal(r.ergebnisse[0].status, 'ok');
  assert.deepEqual(r.fehlerhafteZeilen, [{ zeile: 2, text: 'unsinn' }]);
  assert.equal(r.alleOk, false);
});

// ---------- ZIP mit Kompression (Methode 8) ----------

function zipMitDeflate(dateien) {
  const teile = [], zentral = [];
  let off = 0;
  for (const { name, daten } of dateien) {
    const n = enc.encode(name), c = deflateRawSync(daten), crc = v.crc32(daten);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(c.length, 18);
    lh.writeUInt32LE(daten.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(c.length, 20);
    ch.writeUInt32LE(daten.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    teile.push(lh, n, c); zentral.push(ch, n);
    off += 30 + n.length + c.length;
  }
  const cd = Buffer.concat(zentral), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(dateien.length, 8); e.writeUInt16LE(dateien.length, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...teile, cd, e]));
}

test('zipLesen: methode 8 (deflate) und whatsapp-export laden', async () => {
  const foto = Uint8Array.from({ length: 5000 }, (_, i) => (i % 17) * 3);
  const zip = zipMitDeflate([
    { name: '_chat.txt', daten: enc.encode('13.04.26, 11:40 - Lena Muster: IMG-20260413-WA0003.jpg (Datei angehängt)\n') },
    { name: 'IMG-20260413-WA0003.jpg', daten: foto }
  ]);
  const e = await v.zipLesen(zip);
  assert.equal(e[0].methode, 8);
  assert.ok(e.every((x) => x.crcOk));
  assert.deepEqual(e[1].daten, foto);
  const exp = await v.ladeExport(zip, 'WhatsApp Chat mit Familie Muster.zip');
  assert.equal(exp.titel, 'Familie Muster');
  assert.equal(exp.anhaenge.length, 1);
  const a = await v.baueArchiv(exp);
  assert.equal(a.ergebnis.nachrichten[0].anhang_vorhanden, true);
  const html = dec.decode(a.dateien.find((d) => d.name === 'chat.html').daten);
  assert.ok(html.includes('<img src="original/IMG-20260413-WA0003.jpg"'));
});

test('zipLesen: kaputte eingaben', async () => {
  await assert.rejects(v.zipLesen(enc.encode('kein zip')), /keine zip/);
  const zip = v.zipSchreiben([{ name: 'x', daten: enc.encode('abc') }]);
  const kaputt = zip.slice(); kaputt[30 + 1] ^= 1; // ein Byte in den Daten
  const e = await v.zipLesen(kaputt);
  assert.equal(e[0].crcOk, false);
});

test('ladeExport: nur .txt', async () => {
  const exp = await v.ladeExport(enc.encode(v.BEISPIEL_CHAT), 'WhatsApp Chat mit Familie Muster.txt');
  assert.equal(exp.anhaenge.length, 0);
  assert.equal(exp.titel, 'Familie Muster');
});

// ---------- Rundlauf ----------

test('rundlauf: beispiel umwandeln, archiv lesen, alles ok, fehlt, zusätzlich', async () => {
  const a = await v.baueArchiv(v.beispielExport());
  assert.equal(a.ordner, 'verlauf-2026-04-12-2026-04-14');
  const zip = v.verbinde(a.teile);
  assert.equal(zip.length, a.groesse);
  const r = await v.pruefeArchiv(zip);
  assert.equal(r.ordner, a.ordner);
  assert.equal(r.kennung, a.kennung);
  assert.ok(r.alleOk);
  assert.deepEqual(r.ergebnisse.map((e) => e.pfad), [
    'LIESMICH.txt', 'chat.html', 'chat.txt', 'nachrichten.jsonl', 'original/Erika Beispiel.vcf', 'original/_chat.txt'
  ]);
  const liesmich = dec.decode(a.dateien[0].daten);
  assert.ok(liesmich.startsWith('verlauf-archiv 1\n'));
  // original byte-gleich
  assert.deepEqual(a.dateien.find((d) => d.name === 'original/_chat.txt').daten, enc.encode(v.BEISPIEL_CHAT));

  const eintraege = (await v.zipLesen(zip)).filter((e) => !e.name.endsWith('/chat.txt'));
  eintraege.push({ name: a.ordner + '/notiz.txt', daten: enc.encode('neu') });
  const umgebaut = v.zipSchreiben(eintraege);
  const r2 = await v.pruefeArchiv(umgebaut);
  const status = Object.fromEntries(r2.ergebnisse.map((e) => [e.pfad, e.status]));
  assert.equal(status['chat.txt'], 'fehlt');
  assert.equal(status['notiz.txt'], 'zusätzlich');
  assert.equal(r2.zaehler.ok, 5);
  assert.equal(r2.alleOk, false);
});

test('archiv: gleiche eingabe ergibt gleiche kennung und gleiches zip', async () => {
  const a = await v.baueArchiv(v.beispielExport());
  const b = await v.baueArchiv(v.beispielExport());
  assert.equal(a.kennung, b.kennung);
  assert.deepEqual(v.verbinde(a.teile), v.verbinde(b.teile));
});

test('archiv: unsichere reihenfolge braucht eine wahl, leerer chat wird abgelehnt', async () => {
  const exp = { chatBytes: enc.encode('[3/4/26, 2:05:09 PM] Erika Beispiel: Hi\n'), anhaenge: [] };
  await assert.rejects(v.baueArchiv(exp), /unsicher/);
  const a = await v.baueArchiv(exp, { reihenfolge: 'dm' });
  assert.equal(a.ordner, 'verlauf-2026-04-03-2026-04-03');
  await assert.rejects(v.baueArchiv({ chatBytes: new Uint8Array(0) }), /keine nachrichten/);
});

test('chat.html des beispiels: kein <script, keine url mit http', async () => {
  const a = await v.baueArchiv(v.beispielExport());
  const html = dec.decode(a.dateien.find((d) => d.name === 'chat.html').daten);
  assert.ok(!/<script/i.test(html));
  assert.ok(!/http/i.test(html));
  assert.ok(html.includes('anhang fehlt im export: IMG-20260413-WA0003.jpg'));
  assert.ok(html.includes('href="original/Erika%20Beispiel.vcf"'));
});

// ---------- Gegenprobe mit Standardwerkzeugen ----------

function vorhanden(prog) {
  return spawnSync(prog, ['--help'], { stdio: 'ignore' }).error === undefined;
}

test('gegenprobe: unzip -t und sha256sum -c', { skip: !(vorhanden('unzip') && vorhanden('sha256sum')) && 'unzip oder sha256sum fehlt' }, async () => {
  const exp = v.beispielExport();
  exp.anhaenge.push({ name: 'Ü ä 😀.txt', daten: enc.encode('umlaute im namen') });
  const a = await v.baueArchiv(exp);
  const ort = mkdtempSync(join(tmpdir(), 'verlauf-test-'));
  try {
    const zipPfad = join(ort, a.dateiname);
    writeFileSync(zipPfad, v.verbinde(a.teile));
    const t = spawnSync('unzip', ['-t', zipPfad], { encoding: 'utf8' });
    assert.equal(t.status, 0, t.stdout + t.stderr);
    assert.match(t.stdout, /No errors detected/);
    // selbst entpacken, damit der Test nicht von der Zeichensatz-Einstellung von unzip abhängt
    for (const d of a.dateien) {
      const p = join(ort, a.ordner, d.name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, d.daten);
    }
    const c = spawnSync('sha256sum', ['-c', 'pruefsummen.sha256'], { cwd: join(ort, a.ordner), encoding: 'utf8' });
    assert.equal(c.status, 0, c.stdout + c.stderr);
    assert.equal(c.stdout.trim().split('\n').length, a.dateien.length - 1);
    const k = spawnSync('sha256sum', ['pruefsummen.sha256'], { cwd: join(ort, a.ordner), encoding: 'utf8' });
    assert.equal(k.stdout.slice(0, 64), a.kennung);
  } finally {
    rmSync(ort, { recursive: true, force: true });
  }
});

// ---------- Demoseite nutzt denselben Kern ----------

test('index.html enthält verlauf.js unverändert', { skip: !existsSync(join(hier, 'index.html')) && 'index.html fehlt' }, async () => {
  const { kernFuerSeite } = await import('./bauen.js');
  const html = readFileSync(join(hier, 'index.html'), 'utf8');
  const kern = kernFuerSeite(readFileSync(join(hier, 'verlauf.js'), 'utf8'));
  assert.ok(html.includes(kern), 'index.html ist veraltet, bitte node bauen.js ausführen');
});
