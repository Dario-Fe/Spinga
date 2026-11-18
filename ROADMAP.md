# Spinga — Roadmap e idee

> Dedicato a un collega magazziniere che non c'è più.
> Un piccolo puzzle di casse da magazzino, rifatto con cura, per ricordarlo.

Questo file raccoglie tutte le idee di miglioramento discusse, organizzate in fasi.
Lo stato avanza segnando le caselle; la cronologia delle scelte sta in `AGENTS.md`.

## Stato attuale

Gioco funzionante e giocabile: 50 livelli,
grafica Canvas 2D flat 2.5D con 5 temi, HUD, annulla/ricomincia, timer, record per livello,
selezione livelli, audio WebAudio, swipe e D-pad su mobile.

- [x] Estrazione e validazione dei 50 livelli
- [x] Motore di gioco, undo, restart, vittoria, particelle, suoni
- [x] HUD e selettore livelli con record
- [x] Layout responsive (desktop, tablet, smartphone, landscape/portrait)
- [x] Controlli touch: swipe sul campo + D-pad (pointer coarse)
- [x] Verifica soluzione ufficiale del livello 1 (230 mosse, 97 spinte)
- [x] Rinominato il gioco in **Spinga**
- [x] Dedica: "In loving memory to Spinga" nel footer e " - in loving memory" accanto al titolo
- [x] Nuovo protagonista: omino magro con cappello e transpallet
- [x] Logo nell'header: transpallet giallo in SVG inline
- [x] Protagonista con transpallet
- [x] Muri continui (marching squares)
- [x] Illuminazione e ombre (AO, vignettatura, ombre proiettate)
- [x] Cache pavimento offscreen (solo pavimento e muri)
- [x] Materiali (venature legno, angoli metallici, riflessi, polvere, target lock, squash)
- [x] Fase 1 verificata e corretta (cache statica, pavimento, regressione livello 1)
- [x] Fase 2 (P1): stelle e record, menu/impostazioni, fullscreen, PWA installabile
- [x] Fase 2 (P2 brevi): redo/ghost, conferma restart, pausa, accessibilità, mobile extra
- [x] Repository GitHub-ready: README con screenshot, licenza MIT sul codice, `.gitignore`
- [x] Effetto commemorativo "Sclera": pulsante dedicato, popup animato, gioco in pausa
- [x] Sclera automatica dopo 60 s di inattività (stessa pausa, nessun effetto sul gioco)
- [x] Smartphone: campo più grande (HUD a colonna in orizzontale, margini ridotti, D-pad fuori dal labirinto)
- [x] Vibrazione Android: tick sul passo, durate percepibili, prova dal menu impostazioni
- [x] Pubblicato su GitHub (`Dario-Fe/Spinga`) con README, screenshot e Pages pronto
- [x] Temi e polish Fase 1: 5 temi ogni 10 livelli, particelle ambientali, transizioni,
      flash target, coriandoli e zoom lento alla vittoria

## Principi

1. **Moderno ma leggibile**: flat 2.5D, luce coerente, niente rumore visivo.
2. **Prima il puzzle**: effetti al servizio della chiarezza, mai sopra le casse.
3. **Mobile-first nei fatti**: si gioca bene in verticale e in orizzontale.
4. **Personale e offline**: nessuna dipendenza, nessun tracciamento, nessuna distribuzione.
5. **Rispetto della memoria**: tono sobrio, dedica discreta, nessun elemento goliardico.

Legenda: P1 = alta priorità, P2 = media, P3 = quando c'è tempo. S/M/L = sforzo stimato.

---

## Fase 1 — Identità e grafica

- [x] **Muri continui** (P1, M): fondere i tile adiacenti con marching squares, arrotondare
      solo i bordi esterni, eliminare le fessure tra i cubetti. È il salto visivo più grande.
- [x] **Illuminazione e ombre** (P1, M): luce direzionale unica (alto-sinistra), ombre
      proiettate delle casse, ombra di contatto/AO alla base dei muri, vignettatura.
- [x] **Cache del pavimento** (P2, S): disegnare una volta su canvas offscreen e riusare;
      meno lavoro per frame su telefoni. Contiene solo pavimento e muri; animazioni e
      attori restano disegnati dal vivo.
- [x] **Materiali** (P1, M): venature legno procedurali, angoli metallici e riflesso sulle
      casse; squash&stretch alla spinta; polvere sui passi; target con anello animato e
      "lock" quando occupato.
- [x] **Logo** (fatto): transpallet giallo in SVG inline nell'header, con alone caldo;
      nessun asset esterno.
- [x] **Protagonista** (fatto): omino magro con cappello e gilet ad alta visibilità che
      spinge un transpallet; sprite orientato nelle 4 direzioni, forcelle disegnate sotto
      la cassa quando la spinge, passo animato.
- [x] **Temi ogni 10 livelli** (P2, L): magazzino, ghiaccio, deserto, giardino notturno,
      spazio. Palette canvas e CSS, particelle ambientali, suoni e meta theme-color dedicati,
      crossfade tra temi. Il tema segue il livello (1–10, 11–20, …), senza selettore manuale.
- [x] **Polish effetti** (P2, S): flash sul target, coriandoli e zoom lento alla vittoria,
      fade/slide tra livelli, sfondo a parallasse al posto dei puntini fissi.
- [ ] **Modalità retro pixel** (P3, M): variante opzionale in stile anni '80, stesso motore.
- [x] **Dedica in gioco** (P1, S): "In loving memory to Spinga" nel footer e
      " - in loving memory" in piccolo accanto al titolo.

## Fase 2 — Gioco e UX

- [x] **Par e stelle** (P1, M): 3 stelle sulle spinte rispetto al par (con par noto:
      2 entro il +35%, 3 entro il +10%; senza par vale il record personale come prima);
      par in `par.js` da `tools/solve.js`, mostrato in vittoria e nei titoli dei livelli.
- [x] **Menu iniziale e impostazioni** (P1, M): Continua / Scegli livello / Impostazioni
      (volume, animazioni ridotte, fullscreen), riapribile con Esc. I temi seguono il
      livello, quindi non serve un selettore manuale.
- [x] **Solutore offline** (P2, L): `tools/solve.js`, A* sulle spinte con celle morte
      (BFS inversa) e deadlock, beam e greedy di riserva, `--map`/`--stats`. Dimostra il
      par dove chiude (oggi il livello 1) e verifica la solvibilità dei livelli.
- [ ] **Hint e auto-solve** (P2, L): usare lo stesso solutore in gioco per suggerire la
      prossima spinta o mostrare la soluzione.
- [x] **Redo e ghost** (P2, S): `Y`/pulsante Ripeti, ghost delle ultime 3 posizioni,
      conferma su restart dopo 20 mosse.
- [ ] **Progressi esportabili** (P2, M): export/import JSON, statistiche globali, reset.
- [x] **PWA installabile** (P1, M): manifest, icone 192/512, service worker e cache
      offline; attivo solo se il gioco è servito via http(s), non con `file://`.
- [x] **Fullscreen** (P1, S): tasto F / pulsante in HUD e impostazioni; target `.app`
      per mantenere HUD e comandi visibili, Esc esce.
- [x] **Mobile extra** (P2, S): vibrazione su spinta/goal/vittoria (spegnibile), D-pad con
      dimensione e lato regolabili, pausa con timer fermo e auto-pausa in background.
      HUD compatto in landscape già presente.
- [x] **Accessibilità** (P2, S): focus trap e gestione del focus negli overlay, `aria-live`
      per mosse/spinte/target e vittoria, modalità alto contrasto (canvas e UI), Esc.

## Extra commemorativi

- [x] **Sclera** (fatto): pulsante vistoso in HUD; popup grande con canvas dedicato in cui
      Spinga lancia il transpallet, tira fuori una forbice lunghissima e prende a testate
      il muro. Il gioco va in pausa e riprende da solo alla fine; nessun effetto sulle mosse.

## Fase 3 — Contenuti e distribuzione

- [ ] **Editor livelli** (P3, L): griglia editabile, export JSON, validatore
      (casse = target, raggiungibilità, solvibilità).
- [ ] **Build .exe** (P3, M): Tauri (leggero) con icona, splash e auto-save.
- [ ] **Localizzazione IT/EN** (P3, M): testi esterni, switch lingua.
- [ ] **Test automatici completi** (P2, M): solver su tutti i 50 livelli e test Puppeteer
      di caricamento, vittoria, mobile e persistenza.

---

## Ordine consigliato

Restano: copertura dei par, hint, progressi esportabili, editor, build `.exe`,
localizzazione.

1. Copertura dei par: oggi solo i livelli chiusi da A* hanno un par dimostrato; il
   livello 2 è risolvibile con beam largo (par 133), ma il default del solver è troppo
   stretto. Poi l'hint in gioco sullo stesso solutore.
2. Progressi esportabili e test automatici estesi ai 50 livelli.
3. Editor, build `.exe`, localizzazione IT/EN.

## Note tecniche utili

- Cartella progetto: `D:\AI\Spinga\CrateShift` (il nome della cartella resta per non
  rompere link e script; il nome visibile del gioco è **Spinga**).
- Salvataggi: chiave `spinga.save.v1`, con migrazione automatica dalla vecchia
  `crateshift.save.v1`.
- Responsive già attivo: `100dvh`, HUD che va a capo, breakpoint 860px e 520px,
  canvas con DPR massimo 2, D-pad su `pointer: coarse`, hint di rotazione in verticale.
- Il livello 1 è il riferimento di regressione: soluzione ufficiale da 230 mosse / 97 spinte.
- `staticBoard` è una cache offscreen di solo pavimento e muri, ricostruita al cambio
  livello e al resize: mai dentro il ciclo delle mosse, dove costerebbe un frame perso.
- Temi: `THEMES` in `game.js`, `themeForLevel(i) = floor(i / 10)`; palette canvas,
  variabili CSS `--accent`/`--gold` e `theme-color` aggiornati da `applyTheme()`. Le
  particelle ambientali stanno in `drawAmbient()` e non entrano nella cache statica.
- Stelle: 1 alla prima vittoria; con par noto (`par.js`) 2 entro il 35% di spinte in più
  e 3 entro il 10%, altrimenti record di mosse migliorato del 5% / 15%.
- Par: `node tools/solve.js --write` rigenera `par.js`. Oggi il par è dimostrato solo
  dove A* chiude (livello 1, 97 spinte): i livelli con molte casse non sono alla portata
  di una ricerca rapida. Il livello 2 è risolvibile con beam largo (`par 133`), ma il
  default del solver è troppo stretto (vedi `AGENTS.md`).
- PWA: `manifest.webmanifest`, `sw.js` e icone in `icons/`. Con `file://` il service
  worker non si registra (il gioco è comunque offline); via http(s) funziona anche offline.
- Redo/ghost: lo stato delle mosse annullate è una pila di snapshot, svuotata da una mossa
  nuova o dal cambio livello; il ghost mostra le ultime 3 celle del giocatore.
- Vibrazione (`buzz()`): passo 12 ms, spinta 18 ms, target `[16,30,20]`, muro 12 ms,
  vittoria `[30,50,30,50,70]`, prova `[40,60,40]` dal menu. Esce in silenzio se la
  vibrazione è spenta, se la pagina è nascosta o se il browser non espone `navigator.vibrate`
  (iOS): l'assenza di vibrazione su un telefono non è quindi diagnosticabile dal codice.
- Pausa: `P`, pulsante e `visibilitychange`; il timer usa `elapsed` e riparte da lì, quindi
  il tempo in background non viene conteggiato.
- Backup delle release verificate in `releases/<data>-<fase>/`, con README e file runtime;
  la cartella resta fuori dal repo (`releases/` è in `.gitignore`).
- Licenza: MIT per il codice; `levels.js` (livelli) non è coperto e resta materiale
  personale del progetto.
- Sclera è un overlay a sé con canvas separato e una timeline di ~10 s; il timer del gioco
  resta fermo e riparte alla chiusura, manuale o automatica. Nessuna modifica a mosse,
  record o livelli.
