# verlauf.

**Who will still be able to read your chat in twenty years?** verlauf. turns a WhatsApp chat export into an archive package that stays readable and verifiable without the app. It runs in the browser as an offline PWA, with no upload and no account.

![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue) ![PWA](https://img.shields.io/badge/PWA-installable-5a0fc8) ![offline](https://img.shields.io/badge/offline-yes-2ea44f) ![no dependencies](https://img.shields.io/badge/dependencies-none-lightgrey)

**Try it:** https://gedachtgemacht.github.io/verlauf/ (works in any phone browser, install via "Add to Home Screen")

The app interface is in German. It reads German and English WhatsApp exports.

Family and friends' chats live inside an app. The export is a `_chat.txt` with attachments in a ZIP, and its date format changes with language, platform and app version and is documented nowhere. If you switch phones, lose the account or die, you leave behind chats nobody can open. verlauf. converts the export into plain HTML without JavaScript, normalized plain text and machine-readable messages, includes the original files unchanged and writes a checksum list in `sha256sum` format. A format description is part of the package.

Pure computation in the browser, no AI, no server. Everything stays on your device.

<p align="center">
  <img src="bilder/1-uebersicht.png" width="240" alt="verlauf. on a phone: drop zone for the WhatsApp export, button to load the example, tabs for convert, verify and about">
  <img src="bilder/2-breit.png" width="480" alt="verlauf. on desktop: start screen with the drop zone for a WhatsApp export">
</p>

## Why

Viewing WhatsApp exports is not new, there are free viewers and converters. What is missing is an **archive package** that explains itself and can be verified later with standard tools, even without verlauf. What is new is the combination of normalization, self-description and verifiability for non-technical people. The specification is in `SPEC.md` (`verlauf-archiv 1`), so others can build compatible tools.

## Features

- **Load an export**: a ZIP with `_chat.txt` and attachments, or just the `.txt`, via file picker or drag and drop
- **Line formats** from Android and iOS, German and English, 12 and 24 hours, with and without seconds
- **Date order** (day/month or month/day) is detected. If it stays ambiguous, verlauf. asks you with a sample date in both readings instead of guessing silently
- **Preview**: messages, participants, time span, attachments found and missing, unrecognized lines with numbers
- **Archive package** as a ZIP: `LIESMICH.txt`, `chat.html`, `chat.txt`, `nachrichten.jsonl`, `original/` and `pruefsummen.sha256`
- **Archive ID**: the SHA-256 of the checksum list, shown large so you can write it down or print it
- **Verify**: load an archive ZIP, recompute all checksums, result per file `ok`, `geändert` ("changed"), `fehlt` ("missing") or `zusätzlich` ("extra"), optionally compared with an archive ID you noted
- **Example chat**, made up, marked as an example and removable with one click
- Light and dark, works offline, installable as an app

## Privacy

Nothing leaves your device. verlauf. has no server, no account, no analytics, no ads and loads nothing from the network. Your chat is processed in the browser's memory and stored nowhere. The only thing kept in the browser is the light or dark setting (localStorage). The archive only exists once you download it.

An archive contains the whole chat in plain text. Keep it the way you would keep the chat itself.

## Install

verlauf. is a static web app. There are no dependencies.

1. Put the folder on any static host (your own web space, GitHub Pages, a Raspberry Pi). Installing as an app needs HTTPS. `index.html` also runs straight from the file system.
2. Open the address in the browser.
3. In the browser menu choose **Add to Home Screen**. After that verlauf. starts like an app and also works without a network.

Test locally:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000` in the browser.

The logic lives in `verlauf.js`. `node bauen.js` copies it into `index.html`, so the page runs without a server. Tests: `node --test`.

## How it works

The full description is in `SPEC.md`, the reference implementation is `verlauf.js` (an ES module with no dependencies, only the standard library of browser and Node). In short:

- **Reading.** The export is read as UTF-8. BOM, CRLF, invisible direction marks and narrow spaces are normalized. A line with date and time starts a new message, all other lines are appended to the previous one. Lines before the first message and lines with an impossible date are reported openly.
- **Date order.** If the first field is greater than 12 anywhere, day/month applies; if the second is greater than 12, month/day applies. Otherwise a dot as separator means day/month, a slash is uncertain, and the interface asks.
- **Package.** ZIP without compression, so it stays readable with simple tools. `chat.txt` and `nachrichten.jsonl` are standardized and described byte for byte. `chat.html` and `LIESMICH.txt` may differ between implementations.
- **Checksums.** `pruefsummen.sha256` works with `sha256sum -c pruefsummen.sha256` in the unpacked package folder. Sorting is by UTF-8 bytes.
- **Test vectors.** `testvektoren.json` contains parser cases, known SHA-256 and CRC-32 values and a checksum case where UTF-8 and UTF-16 sorting differ. Recompute with `node --test`.

**Known and tested:** the line formats above, the round trip convert, read back, verify, and the test vectors.

**Limits:**

- WhatsApp only. Other messengers are not planned, the specification leaves room for them.
- Other languages and date variants (such as French or Spanish) are not tested and not recognized. Whatever does not match is reported as unrecognized.
- Times are the device's local time without a time zone and are taken over unchanged.
- No decryption, no reading of phone databases, no editing.
- No ZIP64: archives over 4 GB are rejected, from 1 GB on there is a warning. The ZIP is built in memory, so large exports with many videos can be too big on a phone.
- Compressed ZIPs can only be read by browsers with `DecompressionStream`. Otherwise only the `.txt` works.
- **Checksums are not a signature.** They only prove that nothing changed relative to a list you keep safe. Someone who forges files and list together will not be detected. Keep the archive ID separate from the archive.
- An export without media or with a shortened history stays incomplete. verlauf. only archives what is in the export.

**Assumption, not proven:** that HTML without scripts and UTF-8 plain text will stay readable for decades is a reasoned assumption. Whether non-technical people actually keep the archive ID separately is open.

## License

GNU Affero General Public License v3.0 (AGPL-3.0), see `LICENSE`.

**Deutsch:** verlauf. sichert einen WhatsApp-Chat-Export als prüfbares Archiv aus HTML, Klartext und Originaldateien mit SHA-256-Prüfsummen, offline im Browser, ohne Upload und ohne Konto.

---

**gedacht.gemacht.** Small, honest software. Everything stays on your device. · [More projects](https://github.com/gedachtgemacht)
