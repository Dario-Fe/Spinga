# AGENTS.md — Progetto Spinga

Memoria di progetto per chi (umano o agente) riprende il lavoro. Aggiornare la sezione
"Storia" a ogni milestone e spuntare le voci in `ROADMAP.md`.

## Cos'è

**Spinga** è un puzzle originale di casse da magazzino, giocato in un solo file HTML:
50 livelli, un magazziniere con transpallet, e un obiettivo semplice — spingere ogni cassa
sul suo target. È dedicato a un collega magazziniere scomparso: tono sobrio, nessuno
sfruttamento commerciale, nessuna pubblicazione di livelli o asset.

- Uso: personale e commemorativo.
- I livelli sono materiale del progetto: il repository resta privato, i livelli non si
  ridistribuiscono e non si pubblicano su store o mirror.
- Nome visibile: **Spinga**. La cartella resta `CrateShift` per non rompere percorsi e
  script; non è un errore.

## Come si esegue

Aprire `index.html` in un browser moderno (Chrome/Edge). Nessun build, nessuna dipendenza,
nessun server richiesto. Tutto gira in locale. La PWA installabile richiede invece http(s)
(es. `python -m http.server`); con `file://` il gioco resta comunque offline.

Comandi: frecce/WASD, `Z` annulla, `R` ricomincia, `L` livelli, `M` audio, `Esc` chiude
gli overlay. Su touch: swipe sul campo e D-pad in basso a destra.

## File

- `index.html` — struttura UI: HUD con logo SVG, stage canvas, overlay vittoria/livelli, D-pad.
- `style.css` — tema scuro glass, layout responsive, media query.
- `game.js` — IIFE con stato, input, audio, salvataggi, rendering Canvas 2D.
- `levels.js` — 50 livelli in formato XSB in `window.LEVELS`.
- `manifest.webmanifest`, `sw.js`, `icons/` — PWA: manifest, service worker, icone 180/192/512.
- `releases/` — copie congelate e verificate delle release (una cartella per fase, con
  README). Restano solo in locale: sono in `.gitignore`.
- `docs/` — screenshot usati dal README.
- `README.md` — presentazione del gioco per GitHub: comandi, avvio, struttura, licenza.
- `LICENSE` — MIT sul codice (i dati dei livelli non sono coperti).
- `ROADMAP.md` — idee e fasi di miglioramento con stato.
- `AGENTS.md` — questo file: regole, architettura, storia.

## Vincoli tecnici e scelte da non tradire

- **Vanilla JS, CSS e Canvas 2D**. Niente framework, bundler o dipendenze runtime.
- **Mappatura livelli** (dal formato binario dei livelli): `1=muro`, `2=cassa`, `4=target`,
  `8/16/32/64=giocatore` (direzione). Una cella con valore `3` (muro+cassa) è trattata come
  **cassa**: unico caso, livello 7, indice 210 (riga 10, colonna 10). Non "correggerla" a muro.
- I 50 livelli sono fedeli alla versione di riferimento del progetto. **19 livelli
  differiscono da un set di confronto** per qualche muro o posizione iniziale: sono
  varianti volute, non errori. Non allinearli al set di confronto.
- **Salvataggi**: chiave `spinga.save.v1`; alla lettura si accetta la legacy
  `crateshift.save.v1` per non perdere i record. Non cambiare lo schema senza migrazione.
- UI in italiano, codice semplice e leggibile, commenti solo dove aiutano.
- Rispettare `prefers-reduced-motion` e il layout mobile già presente.
- Nessun tracker, nessuna richiesta di rete, nessun asset esterno.

## Architettura rapida

- `parseLevel` costruisce `walls`, `goals`, `boxes`, `boxAt`, `floorSet/floorList` e la
  posizione del giocatore; il pavimento è calcolato per raggiungibilità.
- `tryMove` gestisce muri, spinte, storico undo, conteggi, suoni e vittoria.
- Rendering: `drawBackground`, `drawBoard`, `drawFloorTo`, `drawWallsTo`, `drawCrate`,
  `drawGoals`, `drawPlayerShadow`, `drawPlayerForks`, `drawBoxes`, `drawPlayerFigure`,
  `drawDustMarks`, `drawParticles`, `drawLighting`; DPR limitato a 2, tile 12–66 px.
  Il protagonista è un omino con cappello e transpallet, disegnato in un sistema locale
  ruotato sulla direzione; le forcelle sono sotto le casse e si accorciano se davanti
  c'è un muro.
- `staticBoard`: cache offscreen di **solo** pavimento e muri. Casse, giocatore, obiettivi
  animati e ombre si ridisegnano a ogni frame (altrimenti restano scie); la cache si
  ricostruisce dal cambio livello e dal resize (`computeLayout`), non a ogni mossa.
- Overlay: menu iniziale (Continua / Livelli / Impostazioni, riaperto con Esc), vittoria
  (record e stelle), selezione livelli, conferma restart, pausa e Sclera; `levelsOpen()`
  blocca i movimenti e il focus resta intrappolato nel dialogo visibile (`trapTab`).
- Sclera: overlay dedicato con canvas separato e timeline di ~10 s (transpallet, forbice
  lunga, testate). Apre con pausa "silenziosa" e chiude con `resumeGame()`; nessun impatto
  su stato, mosse o record.
- Redo/ghost: `redoStack` di snapshot svuotato da mossa nuova o cambio livello; il ghost
  disegna le ultime 3 celle del giocatore. Restart chiede conferma oltre 20 mosse.
- Pausa: `P`, pulsante e `visibilitychange`; il timer si basa su `elapsed` e non conta il
  tempo in background. Vibrazione (`buzz`) e D-pad (dimensione/lato) sono nelle impostazioni.
- Stelle su record personali (`starsForRun`): 1 alla vittoria, +1 per record migliorato
  del 5% e del 15%; record con spinte e stelle in `save.completed[i]`.
- Fullscreen su `.app` (pulsante, impostazioni, tasto F).
- PWA: manifest iniettato e service worker registrato solo via http(s); con `file://`
  il gioco è comunque offline e non produce errori CORS.
- Audio WebAudio generato in codice, con volume persistito, mutabile e persistito.

## Test e verifica

- Validità livelli: `node C:\Users\Archivio\AppData\Local\Temp\opencode\check-levels.js`
  (casse = target, giocatore presente, casse/target raggiungibili).
- Regressione livello 1: soluzione ufficiale in
  `C:\Users\Archivio\AppData\Local\Temp\opencode\level1-solution.txt`
  (230 mosse, 97 spinte) con gli script Puppeteer in
  `C:\Users\Archivio\AppData\Local\Temp\opencode\cstest\`
  (Chrome: `C:\Program Files\Google\Chrome\Application\chrome.exe`).
- Fase 2 e PWA: `node C:\Users\Archivio\AppData\Local\Temp\opencode\cstest\phase2-test.js`
  (menu, Esc, impostazioni persistenti, vittoria 230/97 con stelle, griglia, fullscreen,
  PWA via HTTP con avvio offline, mobile iPhone 13).
- Fase 2 P2: `node C:\Users\Archivio\AppData\Local\Temp\opencode\cstest\phase2b-test.js`
  (redo, ghost, conferma restart, pausa e timer fermo, focus trap, aria-live, vibrazione,
  D-pad su mobile, alto contrasto, regressione livello 1).
- Effetto Sclera: `node C:\Users\Archivio\AppData\Local\Temp\opencode\cstest\rage-test.js`
  (popup, pausa e timer fermo, chiusura manuale/Esc, fine automatica, mobile, zero errori).
- Dopo ogni modifica a grafica o input: verificare desktop, viewport mobile e landscape,
  vittoria livello 1, undo, restart, persistenza record.
- La cartella temp può essere pulita dal sistema: se mancano gli script, ricrearli o
  usare il browser manualmente.

## Storia

### 2026-11-16 — Nascita e correzione
- Definiti i 50 livelli su griglia 20×16 (320 byte ciascuno) e la mappatura binaria
  `1=muro, 2=cassa, 4=target, 8/16/32/64=giocatore`.
- Creato il progetto in `C:\Users\Archivio\Desktop\CrateShift`: motore di gioco, 50 livelli,
  HUD, undo/restart, timer, record, selettore livelli, audio, particelle, grafica flat 2.5D,
  layout responsive, swipe e D-pad.
- **Bug critico**: prima versione con bit casse/target invertiti, livelli ingiocabili.
  Corretto in `1=muro, 2=cassa, 4=target`; verificato con la soluzione ufficiale del
  livello 1 (overlay vittoria, 6/6 target, nessun errore console).
- Confrontati i 50 livelli con un set di riferimento: 19 differenze di muri/partenza
  attribuibili alle varianti della versione di riferimento; i byte del progetto restano la
  fonte di verità.
- Rinominato il gioco in **Spinga** (titolo, HUD) mantenendo la compatibilità dei
  salvataggi tramite migrazione della chiave localStorage.
- Aggiunto cache-busting `?v=2` a CSS/JS per evitare versioni stantie.
- Creati `ROADMAP.md` e `AGENTS.md`.

### 2026-11-16 — Dedica e nuovo protagonista
- Aggiunta la dedica: "In loving memory to Spinga" nel footer e
  " - in loving memory" in piccolo a destra del titolo nell'header.
- Sostituito il robottino con un omino magro, cappello, gilet ad alta visibilità e
  transpallet: disegno procedurale Canvas in 4 direzioni, forcelle sotto le casse,
  passo animato, forcelle accorciate contro i muri.
- Il giocatore ora si orienta all'avvio verso la prima direzione libera, così il
  transpallet è subito visibile.
- Verifiche: caricamento desktop e iPhone 13 senza errori, dedica visibile su mobile,
  cache-busting portato a `?v=6`.
- Sostituito il logo dell'header con un transpallet giallo in SVG inline (side view:
  timone, pompa, forcella, ruote), su fondo scuro con alone caldo; dimensione 40 px
  (34 px su mobile). Nessun asset esterno. Cache-busting a `?v=7`.

### 2026-11-16 — Fase 1 completata e verificata

- **Muri continui**: marching squares completo con arrotondamenti esterni, layering
  (ombra + corpo), highlight radiale, venature procedurali.
- **Illuminazione e ombre**: AO ai 4 lati del pavimento, vignettatura globale, ombre
  proiettate delle casse, ombra del giocatore.
- **Cache pavimento offscreen** (`staticBoard`): pavimento (tinte, granelli, reticolo,
  luce diagonale, AO) e muri, ricostruita al cambio livello e al resize.
- **Materiali avanzati**: venature legno, angoli metallici, riflessi, polvere sui passi,
  target con "lock" animato quando occupato, squash&stretch sulla spinta.
- Cache-busting portato a `?v=9`.
- **Verifica di fine fase**: la cache includeva anche giocatore, forcelle, cassa spinta e
  ombre delle casse, quindi restavano duplicati/scie a ogni passo; in più `drawFloorTo`
  ridisegnava la griglia del pavimento N×N volte dentro un doppio ciclo. Corretti
  entrambi (cache di soli pavimento e muri, cicli appiattiti), rimossi i rebuild a ogni
  mossa e verificati caricamento desktop/mobile e regressione del livello 1.
- **Angoli delle casse corretti**: i quattro angoli scuri usavano `inset` (pixel) come
  frazione della cassa, quindi finivano ~280 px fuori e apparivano come quadratini
  marroni sparsi sul campo; gli angoli metallici avevano lo stesso errore raddoppiato e
  restavano fuori canvas. Ora usano le coordinate degli angoli reali e si vedono.
  Cache-busting a `?v=10`.

### 2026-11-16 — Fase 2 (P1): stelle, menu, PWA

- Stelle su record personali: 1 alla vittoria, +1 per record di mosse migliorato del 5%
  e del 15%; spinte e stelle salvate in `save.completed[i]`, mostrate in HUD, overlay
  vittoria e griglia livelli. I par ottimali richiedono il solver e restano da fare.
- Menu iniziale (Continua / Scegli livello / Impostazioni) riapribile con Esc; volume,
  animazioni ridotte e fullscreen persistiti in `spinga.save.v1` senza migrazione.
- Fullscreen su `.app` con pulsante in HUD, nelle impostazioni e tasto F.
- PWA: `manifest.webmanifest`, icone 180/192/512 generate dal logo, `sw.js` cache-first;
  manifest e service worker attivi solo via http(s) per non generare errori CORS con
  `file://`.
- **Bug trovato in verifica**: `reduceMotion` leggeva `save` prima dell'inizializzazione,
  facendo abortire l'avvio (menu assente, canvas 300×150). Corretto spostando il calcolo
  dopo il caricamento dei salvataggi.
- Verifiche `phase2-test.js`: menu, Esc, impostazioni persistenti al reload, vittoria
  livello 1 (230 mosse / 97 spinte, 3 stelle, record), stelle nella griglia, fullscreen,
  PWA via HTTP con avvio offline, iPhone 13; nessun errore console. Cache-busting `?v=11`.

### 2026-11-16 — Fase 2 P2: redo/ghost, pausa, accessibilità, mobile

- Redo con pila di snapshot (`Y` / pulsante Ripeti), svuotata da una mossa nuova o dal
  cambio livello; ghost delle ultime 3 celle del giocatore; restart con conferma oltre
  20 mosse.
- Pausa con `P`, pulsante e auto-pausa su `visibilitychange`; il timer usa `elapsed` e non
  conta il tempo in background, ripartendo da lì al resume.
- Accessibilità: focus trap e gestione del focus nei dialoghi, `aria-live` per mosse/
  spinte/target e vittoria, modalità alto contrasto (palette canvas + bordi UI).
- Mobile: vibrazione su spinta/goal/vittoria (spegnibile), D-pad con dimensione e lato
  regolabili dalle impostazioni, persistiti in `spinga.save.v1` senza migrazione.
- Verifiche `phase2b-test.js` (redo, ghost, conferma restart, pausa e timer fermo, focus
  trap, aria-live, vibrazione, D-pad mobile, alto contrasto, regressione livello 1) più
  `phase2-test.js` e `check-levels.js`: tutto verde. Cache-busting `?v=12`, `sw.js` a
  `spinga-v12`.

### 2026-11-16 — Effetto commemorativo "Sclera"

- Aggiunto il pulsante **Sclera** in HUD (gradiente ambra/rosso) e un popup grande con
  canvas dedicato: Spinga si arrabbia, lancia il transpallet, mostra una forbice
  lunghissima e prende a testate il muro, poi si calma.
- Il gioco va in pausa senza mostrare l'overlay di pausa; timer fermo, mosse intatte.
  Chiusura con "Torna al gioco", Esc o automatica dopo ~10 s, con ripresa del timer.
  Pulsante disabilitato a livello completato.
- Animazione Canvas 2D procedurale (nessun asset esterno) e suoni generati; scossoni e
  tremolio rispettano `prefers-reduced-motion`.
- Verifiche `rage-test.js` (desktop e mobile), `phase2b-test.js`, `phase2-test.js` e
  `check-levels.js`: tutto verde. Cache-busting e service worker a `v13`.

### 2026-11-16 — Repository GitHub e README

- Rimossi tutti i riferimenti al gioco da cui il progetto era partito: Spinga è presentato
  ovunque come gioco originale (`index.html`, `levels.js`, manifest, `README.md`,
  `ROADMAP.md`, questo file).
- Aggiunti `README.md` (presentazione, screenshot, comandi, avvio, struttura, licenza),
  `LICENSE` (MIT sul codice, dati dei livelli esclusi) e `.gitignore` (`releases/`,
  `node_modules`, file di sistema).
- Screenshot del gioco in `docs/` per il README, generati con Puppeteer (desktop e mobile).
- Repository git inizializzato con commit iniziale. Cache-busting e service worker a `v14`.

## Prossimi passi

Vedi `ROADMAP.md`, ordine consigliato:
1. Chiudere la Fase 1: temi, polish effetti, retro pixel, impronte di polvere.
2. Fase 2 residua: hint/solver (anche per i par), progressi esportabili, test completi.
3. Fase 3: editor, build `.exe`, localizzazione.

Repository: `README.md` è la vetrina, `LICENSE` copre il codice, `releases/` resta locale.

Quando si completa una voce: spuntarla in `ROADMAP.md`, aggiungere una riga datata qui e
verificare la regressione del livello 1.
