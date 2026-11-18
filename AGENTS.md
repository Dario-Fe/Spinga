# AGENTS.md — Progetto Spinga

Memoria di progetto per chi (umano o agente) riprende il lavoro. Aggiornare la sezione
"Storia" a ogni milestone e spuntare le voci in `ROADMAP.md`.

## Cos'è

**Spinga** è un puzzle originale di casse da magazzino, giocato in un solo file HTML:
50 livelli, un magazziniere con transpallet, e un obiettivo semplice — spingere ogni cassa
sul suo target. È dedicato a un collega magazziniere scomparso: tono sobrio, nessuno
sfruttamento commerciale, nessuna pubblicazione di livelli o asset.

- Uso: personale e commemorativo.
- Il repository pubblico su GitHub (`Dario-Fe/Spinga`) è la vetrina del gioco: `LICENSE`
  copre solo il codice e `levels.js` ne resta escluso, ma un repo pubblico rende i livelli
  scaricabili. È un limite accettato dall'autore, non un via libera a ridistribuirli su
  store o mirror.
- Nome visibile: **Spinga**. La cartella resta `CrateShift` per non rompere percorsi e
  script; non è un errore.

## Come si esegue

Aprire `index.html` in un browser moderno (Chrome/Edge). Nessun build, nessuna dipendenza,
nessun server richiesto. Tutto gira in locale. La PWA installabile richiede invece http(s)
(es. `python -m http.server`); con `file://` il gioco resta comunque offline.

Comandi: frecce/WASD, `Z` annulla, `Y` ripeti, `R` ricomincia, `P` pausa, `L` livelli,
`M` audio, `F` schermo intero, `Esc` chiude overlay e menu. Su touch: swipe sul campo,
D-pad in basso a destra, pulsante Sclera per la pausa commemorativa.

## File

- `index.html` — struttura UI: HUD con logo SVG, stage canvas, overlay vittoria/livelli, D-pad.
- `style.css` — tema scuro glass, layout responsive, media query.
- `game.js` — IIFE con stato, input, audio, salvataggi, rendering Canvas 2D.
- `levels.js` — 50 livelli in formato XSB in `window.LEVELS`.
- `par.js` — par delle spinte per livello in `window.LEVELS_PAR` (`{ par, ex }` o `null`),
  generato da `tools/solve.js`.
- `tools/solve.js` — solutore offline: A* esatto sulle spinte, beam e greedy di riserva,
  con `--map`/`--stats` per la diagnosi.
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
- Temi: `THEMES` e `themeForLevel(i) = floor(i / 10)` in `game.js` (Magazzino, Ghiaccio,
  Deserto, Giardino notturno, Spazio). `applyTheme()` aggiorna palette canvas, variabili
  CSS `--accent`/`--accent-2`/`--gold`, sfondo del body e `theme-color`; `drawBackground`
  fa il crossfade con `themeFade`, `drawAmbient` anima polvere/neve/sabbia/lucciole/stelle.
- Polish: `goalFlash` per il flash dei target, `confetti` canvas più un layer DOM
  `winConfetti` sopra l'overlay di vittoria, `enterT` per fade/slide tra livelli e
  `winZoom` per lo zoom lento. Con `reduceMotion` restano solo le dissolvenze brevi:
  niente particelle, transizioni di campo, zoom o coriandoli.
- Overlay: menu iniziale (Continua / Livelli / Impostazioni, riaperto con Esc), vittoria
  (record e stelle), selezione livelli, conferma restart, pausa e Sclera; `levelsOpen()`
  blocca i movimenti e il focus resta intrappolato nel dialogo visibile (`trapTab`).
- Sclera: overlay dedicato con canvas separato e timeline di ~10 s (transpallet, forbice
  lunga, testate). Apre con pausa "silenziosa" e chiude con `resumeGame()`; nessun impatto
  su stato, mosse o record. Parte anche da solo dopo 60 s senza mosse mentre si gioca
  (`checkIdleRage` nel loop): il minuto scorre solo senza overlay aperti e si riarma con
  `noteActivity()` a ogni mossa, undo/redo, pausa e cambio livello. Stesso overlay, stessa
  pausa, nessun effetto su stato, mosse o record.
- Redo/ghost: `redoStack` di snapshot svuotato da mossa nuova o cambio livello; il ghost
  disegna le ultime 3 celle del giocatore. Restart chiede conferma oltre 20 mosse.
- Pausa: `P`, pulsante e `visibilitychange`; il timer si basa su `elapsed` e non conta il
  tempo in background. Vibrazione (`buzz`) e D-pad (dimensione/lato) sono nelle impostazioni.
- Stelle (`starsForRun`): 1 alla vittoria; con par noto (`par.js`) la seconda entro il
  35% di spinte in più e la terza entro il 10%, altrimenti resta il record personale
  (5% / 15%). Record con mosse, spinte e stelle in `save.completed[i]`.
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
- Temi e polish: `node C:\Users\Archivio\AppData\Local\Temp\opencode\cstest\theme-test.js`
  (i 5 temi su livelli 1/11/21/31/41, accent e `theme-color`, vittoria 230/97 con stelle,
  screenshot, zero errori) e `theme-mobile-test.js` (portrait 390×844 e landscape 844×390).
- Layout smartphone e D-pad: `node C:\Users\Archivio\AppData\Local\Temp\opencode\cstest\check-mobile.js`
  (campo intero e nessuna sovrapposizione con il D-pad in 390×844, 320×568, 740×360,
  844×390, anche con D-pad grande e a sinistra).
- Vibrazione: `node C:\Users\Archivio\AppData\Local\Temp\opencode\cstest\check-haptics.js`
  (stub di `navigator.vibrate`: tick sul passo, spinta, target, vittoria con la soluzione
  del livello 1; zero chiamate con la vibrazione spenta, prova `[40,60,40]` dal menu).
- Par e stelle: `node tools/solve.js` (tabella; `--write` rigenera `par.js`); verifica
  browser in temp `par-test.js` (livello 1: 3 stelle, par in vittoria, zero errori).
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

## 2026-11-16 — Smartphone: più spazio al campo

- **Orizzontale**: sotto i 560 px di altezza con puntatore coarse `.app` diventa una riga;
l'HUD è una colonna stretta (146–184 px) con statistiche e pulsanti su due colonne, il
footer sparisce e la dedica passa sotto il titolo. Larghezza del campo: 265 → 455 px su
844×390 (+71%), 227 → 360 px su 740×360 (+58%).
- **Margini**: su schermi piccoli il margine del campo scende da 28 a 10 px e il padding
dell'app da 14/10 a 8 px (portrait 390: campo 302 → 340 px).
- **D-pad**: `padReserve()` in `computeLayout` tiene il labirinto fuori dalla fascia dei
pulsanti: lato in orizzontale (secondo `data-pad-side`), in basso in verticale. La scelta
usa la stessa media query del CSS (`orientation: landscape and max-height: 560px`) e non
il rapporto del palco: su schermi stretti il palco è più largo che alto anche in
verticale (320×568 → palco 304×303) e il campo finiva tagliato a sinistra. Cambiare lato
o dimensione del D-pad ricalcola subito il layout.
- Il minimo della cella scende da 12 a 8 px, così non può più spingere il campo fuori dal
palco.
- Verifiche: nessuna sovrapposizione campo/D-pad in 390×844, 320×568, 740×360 e 844×390
(D-pad anche grande e a sinistra), tocco D-pad → undo → restart con conferma, regressione
livello 1 (230 mosse, 97 spinte, 6/6, record salvato). Cache-busting a `?v=15`.
- Limite noto: in verticale la larghezza del livello (fino a 20 celle) fissa il massimo
della cella; per andare oltre servirebbe ruotare il labirinto (non fatto).

## 2026-11-16 — Vibrazione su Android

- Il passo semplice non vibrava affatto e le pulsazioni erano di 8–10 ms, sotto la soglia
percepibile su molti telefoni. Ora: passo 12 ms, spinta 18 ms, spinta su target
`[16, 30, 20]`, muro 12 ms, vittoria `[30, 50, 30, 50, 70]`.
- Attivare "Vibrazione" nelle impostazioni produce una prova evidente (`[40, 60, 40]`).
`buzz()` non vibra con `document.hidden`; su iOS `navigator.vibrate` non esiste e la
funzione esce subito.
- Verifiche: `navigator.vibrate` sostituito con uno stub in Chrome headless, tick sul passo
registrato, pattern di target e di vittoria con la soluzione del livello 1, nessuna
chiamata con la vibrazione spenta. Cache-busting a `?v=16`.
- Promemoria: Android richiede un tocco prima di vibrare e Chrome ha un permesso per sito;
se non si sente nulla, controllare il permesso del browser e il toggle nelle impostazioni.

## 2026-11-16 — Sclera automatica dopo un minuto di inattività

- Dopo 60 s senza mosse (mossa, anche contro il muro, undo/redo, ripresa dalla pausa,
  cambio livello) parte da solo l'effetto Sclera: il gioco va in pausa "silenziosa" come
  con il pulsante e riprende da dov'era alla chiusura. Timer, mosse e record restano
  intatti; nessun trigger con menu, pausa, overlay o livello completato aperti.
- `checkIdleRage()` gira nel loop e usa `lastActivity`, riarmato da `noteActivity()`.
- Verifiche: `node --check game.js` e prova headless (menu chiuso, attesa > 60 s, popup
  Sclera aperto, timer fermo, chiusura con Esc e ripresa senza mosse perse).
  Cache-busting e service worker a `v17`.

## 2026-11-17 — Solutore offline e par delle spinte

- Aggiunto `tools/solve.js`: A* sulle spinte con celle morte (BFS inversa sul grafo
  delle spinte), deadlock delle casse congelate ed euristica di assegnamento ottimo
  casse→target; beam search e greedy come ripieghi; `--map`, `--stats`, `--exact`.
- `par.js` (`window.LEVELS_PAR`) con `{ par, ex }`: `ex` dice se il minimo è dimostrato,
  `null` dove non c'è par.
- In gioco: 3 stelle se le spinte stanno entro par +10%, 2 entro par +35%, 1 alla
  vittoria; senza par resta il criterio del record personale. Par mostrato nella
  vittoria e nel titolo dei livelli.
- Verifiche: livello 1 con par **97 spinte**, identico alle spinte della soluzione di
  riferimento (230 mosse / 97 spinte); test browser `par-test.js` verde (50 voci, titolo
  con par, 3 stelle, par nell'overlay, record 230/97, zero errori console).
  Cache-busting e service worker a `v18`.
- **Limite noto**: il par è dimostrato solo dove A* chiude, oggi il solo livello 1.
  I livelli con 10–34 casse non sono alla portata di una ricerca rapida; per quelli
  `par.js` contiene `null` e le stelle tornano al criterio del record.
- **Livello 2 risolvibile**: la ricerca di default non lo chiude, ma con beam largo sì.
  `$env:MAX_STATES='1'; $env:MAX_MS='120000'; $env:BEAM='10000';
  $env:GREEDY_TRIES='0'; node tools/solve.js --only 2` trova `par 133` in ~22 s con
  ~8 milioni di stati. `BEAM=5000` fallisce; non modificare i livelli per questo.

## 2026-11-18 — Temi e polish Fase 1

- Aggiunti i 5 temi automatici ogni 10 livelli: Magazzino, Ghiaccio, Deserto, Giardino
  notturno, Spazio. Palette canvas (pavimento, muri, target, luce, vignettatura), colori
  CSS (`--accent`, `--accent-2`, `--gold`), sfondo del body e `theme-color`.
- Transizioni: crossfade del fondale con `themeFade`, fade/slide del campo con `enterT`,
  zoom lento alla vittoria con `winZoom`.
- Particelle ambientali procedurali in `drawAmbient` (polvere, neve, sabbia, lucciole,
  stelle) con tre livelli di parallasse e spostamento legato al movimento del giocatore.
- Polish: flash del target con `goalFlash`, coriandoli canvas sul campo e layer DOM
  `winConfetti` sopra l'overlay di vittoria, temi sonori per passo/spinta/target/vittoria.
- Rispetto di `prefers-reduced-motion` e dell'impostazione animazioni ridotte: niente
  particelle, transizioni, zoom o coriandoli. Alto contrasto invariato.
- Verifiche: `theme-test.js` (5 temi, `theme-color`, vittoria 230/97, 3 stelle, zero
  errori) e `theme-mobile-test.js` (portrait 390×844, landscape 844×390); `node --check
  game.js`. Cache-busting e service worker a `v19`.

## Prossimi passi

Vedi `ROADMAP.md`, ordine consigliato:
1. Copertura dei par: il livello 2 è risolvibile con beam largo (`par 133`), ma il
   default del solver è troppo stretto; poi hint in gioco.
2. Fase 2 residua: progressi esportabili, test completi sui 50 livelli.
3. Fase 3: editor, build `.exe`, localizzazione.

Repository: `README.md` è la vetrina, `LICENSE` copre il codice, `releases/` resta locale.

Quando si completa una voce: spuntarla in `ROADMAP.md`, aggiungere una riga datata qui e
verificare la regressione del livello 1.
