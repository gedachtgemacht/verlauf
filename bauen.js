// Kopiert verlauf.js in index.html, damit die Demoseite auch ohne Server (file://) läuft.
// Aufruf: node bauen.js
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const START = '/* VERLAUF-KERN START */';
const ENDE = '/* VERLAUF-KERN ENDE */';

// Macht aus dem ES-Modul ein klassisches Skript: nur die Schlüsselwörter export fallen weg.
export function kernFuerSeite(quelle) {
  return quelle.replace(/^export (?=(async function|function|const|let|class) )/gm, '');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const hier = dirname(fileURLToPath(import.meta.url));
  const pfad = join(hier, 'index.html');
  const html = readFileSync(pfad, 'utf8');
  const a = html.indexOf(START), b = html.indexOf(ENDE);
  if (a < 0 || b < a) throw new Error('marker in index.html fehlen');
  const kern = kernFuerSeite(readFileSync(join(hier, 'verlauf.js'), 'utf8'));
  writeFileSync(pfad, html.slice(0, a + START.length) + '\n' + kern + html.slice(b));
  console.log('index.html aktualisiert');
}
