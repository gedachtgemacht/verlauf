"""Browsertest für die Demoseite (optional, braucht Playwright mit Chromium).

Aufruf: python3 test-browser.py <projektordner> <ordner für screenshots>
Klickt bei 390 und 1280 px, hell und dunkel: beispiel laden, archiv herunterladen,
jetzt prüfen, kennung vergleichen, über, beispiel entfernen, unsicheres datumsformat.
"""
import sys, threading, functools, http.server, socketserver, os, json, zipfile, hashlib
from playwright.sync_api import sync_playwright

ordner = sys.argv[1]
aus = sys.argv[2]
os.makedirs(aus, exist_ok=True)
class Leise(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


handler = functools.partial(Leise, directory=ordner)
srv = socketserver.TCPServer(('127.0.0.1', 0), handler)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
basis = f'http://127.0.0.1:{port}/'

log = {'konsole': [], 'fehler': [], 'requests': []}
ergebnisse = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for breite, schema in [(390, 'dark'), (390, 'light'), (1280, 'dark'), (1280, 'light')]:
        ctx = b.new_context(viewport={'width': breite, 'height': 860}, color_scheme=schema, accept_downloads=True)
        pg = ctx.new_page()
        pg.on('console', lambda m: log['konsole'].append(m.type + ': ' + m.text))
        pg.on('pageerror', lambda e: log['fehler'].append(str(e)))
        pg.on('request', lambda r: log['requests'].append(r.url))
        pg.goto(basis + 'index.html')
        tag = f'{breite}-{schema}'
        pg.screenshot(path=f'{aus}/{tag}-1-start.png', full_page=True)
        pg.click('#beispiel')
        pg.wait_for_timeout(300)
        pg.screenshot(path=f'{aus}/{tag}-2-beispiel.png', full_page=True)
        with pg.expect_download() as dl:
            pg.click('#archiv')
        d = dl.value
        zpfad = os.path.join(aus, tag + '-' + d.suggested_filename)
        d.save_as(zpfad)
        pg.wait_for_timeout(500)
        pg.screenshot(path=f'{aus}/{tag}-3-kennung.png', full_page=True)
        kennung = pg.text_content('#kennung').replace(' ', '')
        with zipfile.ZipFile(zpfad) as zf:
            kaputt = zf.testzip()
            liste = [n for n in zf.namelist() if n.endswith('/pruefsummen.sha256')][0]
            kennung_zip = hashlib.sha256(zf.read(liste)).hexdigest()
        pg.click('#jetztPruefen')
        pg.wait_for_timeout(500)
        pg.fill('#soll', kennung)
        pg.screenshot(path=f'{aus}/{tag}-4-pruefen.png', full_page=True)
        urteil = pg.text_content('#urteil')
        vergleich = pg.text_content('#vergleich')
        pg.click('.nav button[data-tab=ueber]')
        pg.screenshot(path=f'{aus}/{tag}-5-ueber.png', full_page=True)
        pg.click('.nav button[data-tab=umwandeln]')
        pg.click('#entfernen')
        entfernt = pg.is_visible('#start') and not pg.is_visible('#ergebnis1')
        txt = '[3/4/26, 2:05:09 PM] Erika Beispiel: Hi\nzweite Zeile\n[3/5/26, 9:00:00 AM] Max Muster: Ok\n'
        pg.set_input_files('#datei1', files=[{'name': 'WhatsApp Chat mit Test.txt', 'mimeType': 'text/plain', 'buffer': txt.encode()}])
        pg.wait_for_timeout(300)
        gesperrt = pg.is_disabled('#archiv')
        pg.screenshot(path=f'{aus}/{tag}-6-unsicher.png', full_page=True)
        pg.click('#wahlMd')
        frei = not pg.is_disabled('#archiv')
        breit = pg.evaluate('document.documentElement.scrollWidth > window.innerWidth')
        ergebnisse.append({'tag': tag, 'kennung_gleich': kennung == kennung_zip, 'zip_ok': kaputt is None,
                           'urteil': urteil, 'vergleich': vergleich, 'entfernt': entfernt,
                           'waagerecht_scroll': breit, 'unsicher_gesperrt': gesperrt, 'nach_wahl_frei': frei})
        ctx.close()
    # offline: einmal laden, dann netz aus
    ctx = b.new_context(viewport={'width': 390, 'height': 860})
    pg = ctx.new_page()
    pg.goto(basis + 'index.html')
    pg.wait_for_function('navigator.serviceWorker && navigator.serviceWorker.controller !== null || new Promise(r => navigator.serviceWorker.ready.then(() => setTimeout(() => r(true), 500)))')
    pg.reload()
    ctx.set_offline(True)
    pg.reload()
    pg.click('#beispiel')
    with pg.expect_download() as dl:
        pg.click('#archiv')
    offline_ok = dl.value.suggested_filename.endswith('.zip')
    ctx.close()
    b.close()
srv.shutdown()

fremd = [r for r in log['requests'] if not r.startswith(basis) and not r.startswith(('blob:', 'data:', 'about:'))]
bericht = {'laeufe': ergebnisse, 'offline_umwandeln': offline_ok, 'konsole': log['konsole'],
           'seitenfehler': log['fehler'], 'fremde_requests': fremd,
           'eigene_requests': sorted(set(r.replace(basis, '/') for r in log['requests'] if r.startswith(basis)))}
print(json.dumps(bericht, ensure_ascii=False, indent=1))
ok = (offline_ok and not fremd and not log['fehler'] and all(
    e['kennung_gleich'] and e['zip_ok'] and e['entfernt'] and not e['waagerecht_scroll']
    and e['unsicher_gesperrt'] and e['nach_wahl_frei'] and e['urteil'].startswith('alle')
    and e['vergleich'].startswith('Kennung stimmt überein') for e in ergebnisse))
print('OK' if ok else 'FEHLER')
sys.exit(0 if ok else 1)
