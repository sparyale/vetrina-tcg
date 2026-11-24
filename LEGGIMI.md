# NidoCollection: la tua collezione di carte Pokémon

*(prima si chiamava «Vetrina TCG»: i dati, il file su Drive `vetrina-tcg.json` e l'indirizzo del sito restano gli stessi)*

App personale che gira in Chrome, senza server e senza account. I dati restano nel browser.

## Installazione (una volta sola, 1 minuto)

1. Apri Chrome e vai su `chrome://extensions`.
2. In alto a destra attiva **Modalità sviluppatore**.
3. Clicca **Carica estensione non pacchettizzata** e scegli la cartella `vetrina-tcg`.
4. Fissa l'icona (puzzle → puntina) e cliccala: l'app si apre in una scheda.

> Puoi anche aprire `index.html` con un doppio clic: funziona tutto **tranne** la lettura automatica dei venduti eBay
> (che richiede l'estensione). I dati della pagina aperta così e quelli dell'estensione sono separati.

## Versione web: iPhone, Android e PC (GitHub Pages + Google Drive)

L'app è anche una **pagina web**: la pubblichi gratis su GitHub Pages e la apri da qualsiasi browser,
compresi Safari e Chrome su iPhone. I dati si sincronizzano tramite un file `vetrina-tcg.json` nel tuo Google Drive.

### 1. Pubblicare su GitHub Pages (una volta sola)
1. Crea un account su <https://github.com> (gratis) e un repository **pubblico**, per esempio `vetrina-tcg`.
2. Carica il contenuto della cartella `vetrina-tcg` nel repository (con `git push` oppure trascinando i file in *Add file → Upload files*).
3. Nel repository: **Settings → Pages → Build and deployment → Deploy from a branch**, ramo `main`, cartella `/ (root)` → **Save**.
4. Dopo 1–2 minuti l'app è su `https://<tuo-utente>.github.io/vetrina-tcg/`.

> Il repository è pubblico, ma contiene solo il codice: la tua collezione resta nel tuo Drive e nel browser, non su GitHub.

### 2. ID client Google per Drive (una volta sola, ~10 minuti)
1. Vai su <https://console.cloud.google.com> e crea un progetto (es. "Vetrina TCG").
2. **API e servizi → Libreria** → cerca **Google Drive API** → **Abilita**.
3. **API e servizi → Schermata consenso OAuth**: tipo **Esterno**, nome app "Vetrina TCG", la tua email come supporto e contatto.
   In **Utenti di test** aggiungi la tua email (l'app resta "in test": va benissimo per uso personale).
4. **API e servizi → Credenziali → Crea credenziali → ID client OAuth** → tipo **Applicazione web**.
   In **Origini JavaScript autorizzate** aggiungi `https://<tuo-utente>.github.io` (senza `/vetrina-tcg` finale).
5. Copia l'**ID client** (finisce con `.apps.googleusercontent.com`) e incollalo in `config.js` (`googleClientId: '...'`),
   così vale su tutti i dispositivi; in alternativa in **Impostazioni → Google Drive → ID client Google** su ogni dispositivo.

Il permesso chiesto è `drive.file`: l'app vede **solo** il file che crea lei, non il resto del tuo Drive.
Con l'app in modalità test Google può chiedere di nuovo l'accesso ogni tanto: tocca l'icona della nuvola in alto.

### 3. Usarla su iPhone
1. Apri l'indirizzo GitHub Pages in **Safari** → **Condividi → Aggiungi a schermata Home**: si apre a tutto schermo come un'app.
2. **Impostazioni** (rotella in alto) **→ Google Drive → Collega Google Drive** e accedi.
3. Fai lo stesso sul PC: ogni modifica viene inviata a Drive dopo pochi secondi; all'apertura l'app scarica la copia più recente.
   Se hai modificato su due dispositivi senza sincronizzare, l'app ti chiede quale copia tenere.

### Portare la collezione dall'estensione alla versione web
Nell'estensione: **Impostazioni → Esporta backup**. Nella versione web: **Impostazioni → Importa backup**, poi collega Drive.

### Cosa cambia rispetto all'estensione
- **Venduti eBay e minimo Cardmarket per lingua** non si leggono in automatico (il browser lo vieta alle pagine web):
  i pulsanti aprono la ricerca in una nuova scheda e il prezzo lo scrivi tu (oppure scegli *Cardmarket – tendenza* come fonte).
- Restano automatici i prezzi Cardmarket di TCGdex (tendenza, medie) e TCGplayer, le immagini e i cambi valuta.
- **Un solo posto per tutto**: usa il sito anche da Chrome sul PC (`https://sparyale.github.io/vetrina-tcg/`).
  L'estensione Chrome non serve più: dopo aver esportato il backup puoi rimuoverla da `chrome://extensions`.

### Prezzi: solo con «Scansiona prezzi»
L'app **non aggiorna più i prezzi da sola** (né all'apertura né in background): niente ricerche automatiche che i siti bloccano.
Quando vuoi, premi **Scansiona prezzi** (in alto sul PC, in cima alla *Collezione* sul telefono):
scarica i prezzi Cardmarket di tutte le carte da TCGdex. Accanto al totale vedi la data dell'ultima scansione («prezzi del …»).
I prezzi eBay e i minimi Cardmarket per lingua restano manuali: apri il link dalla scheda della carta e scrivi il prezzo.

### Cercare le versioni reverse holo e timbrate
In **Aggiungi carte**, sotto la barra di ricerca, scegli **Reverse holo e timbrate** (oppure scrivi
`reverse`, `rev` o `timbrata` nella ricerca, es. «pikachu reverse»).
I risultati mostrano una scheda per ogni versione: *Reverse holo*, reverse a motivo (*Poké Ball*, *Master Ball*,
*Energia*, *Cosmo*…) e carte con timbro (*Timbro · Pokémon Center*, *Player Rewards Program*…).
Il **+** aggiunge direttamente quella versione; toccando la carta la scheda si apre già su quella versione.
Le carte timbrate che non hanno un prezzo loro usano il prezzo **reverse holo** della carta su Cardmarket,
perché Cardmarket le cataloga così.

### Loghi dei master set e foto del sigillato
- **Master set**: se TCGdex non ha il logo del set nella tua lingua, l'app usa quello inglese di TCGdex
  oppure lo cerca nell'archivio immagini di **Bulbapedia** (per i set giapponesi il logo JP).
- **Sigillato** (ETB, display, bundle, collezioni, tin…): l'app cerca da sola la foto del prodotto su Bulbapedia,
  solo dello stesso set; se non la trova mostra il logo del set.
  Nella scheda del prodotto, **Foto dal web** mostra le foto trovate: tocca quella giusta.
  In fondo c'è il link per cercarla su **Cardmarket**; puoi anche usare **Carica foto** con una tua foto.
- Le ricerche si fanno una sola volta per prodotto (se non trova niente riprova dopo 30 giorni o se cambi tipo/set).

### Sul telefono: ricerca rapida nella collezione
Su iPhone l'app si apre sulla **Collezione** e la barra in alto **cerca tra le carte che hai** (nome, espansione, numero, note):
i risultati compaiono mentre scrivi, comprese le carte dentro i master set completi.
Per aggiungere carte nuove usa la scheda **Aggiungi** in basso.

## Funzioni

- **Aggiungi carte**: cerca per nome (anche `Charizard 006/165`) in italiano, inglese, giapponese, francese, tedesco, spagnolo o portoghese.
  Il pulsante **+** aggiunge subito la carta; il clic sulla carta apre la scheda completa.
- **Scheda carta**: immagine grande con effetto olografico, prezzi **Cardmarket** (tendenza, medie 1/7/30 giorni, prezzo minimo),
  e **venduti eBay** (mediana, media, minimo-massimo, elenco delle vendite).
  Puoi indicare variante (normale, reverse, holo, 1ª edizione), condizione, gradazione (PSA, BGS, CGC…), quantità, prezzo pagato e note.
- **Panoramica**: valore totale, spesa e guadagno, andamento nel tempo, carte di maggior valore, carte con più movimento, valore per espansione.
- **Collezione**: griglia o elenco, filtri per espansione e lingua, ordinamento per valore, variazione, guadagno e altro.
- **Espansioni**: tutte le espansioni con loghi; dentro ognuna vedi la percentuale completata e le carte mancanti (in grigio).
- **Master set**: scegli un'espansione (da *Master set → Nuovo master set* o dal pulsante nella pagina dell'espansione).
  L'app scarica tutte le carte, fuoriserie comprese, in ogni versione: normale, reverse, holo e, dove esistono,
  reverse Poké Ball / Master Ball. Le varianti speciali (timbri, Cosmo delle confezioni promo) si includono con un'opzione.
  «Aggiungi le N mancanti in Near Mint» inserisce in un colpo tutte le carte mancanti in condizione NM; un clic su una
  singola carta mancante la aggiunge in NM, un clic su una posseduta apre la scheda (per cambiare condizione o rimuoverla).
  Vedi completamento (set base e fuoriserie separati), valore posseduto e quanto costa completarlo.
- **Sealed**: box, ETB, booster bundle, tin, blister, collezioni… Scegli tipo, lingua ed espansione (il nome si compila da solo),
  carica una foto e indica il prezzo pagato. Il valore attuale arriva in automatico dalla **mediana dei venduti eBay**
  (categoria giochi di carte collezionabili): viene cercato subito dopo il salvataggio, ricontrollato ogni 2 mesi
  all'apertura dell'app e con il pulsante ⟳. Sono escluse scatole vuote/aperte, altre lingue e prezzi anomali.
  Finché non ci sono vendite vale il valore inserito a mano (puoi anche scegliere "Prezzo manuale" come fonte).
  Il valore entra nel totale della Panoramica.
- **Lista desideri** con prezzo obiettivo: la carta si illumina quando il prezzo scende sotto l'obiettivo.
- **Impostazioni**: lingua dell'interfaccia (IT / EN / 日本語), valuta (EUR, USD, GBP, JPY), fonte del prezzo predefinita,
  sito eBay, tema chiaro/scuro, backup JSON, esportazione CSV.

## Dove cerca le carte

Nella ricerca puoi scrivere **nome, espansione e numero** insieme, in qualsiasi lingua e anche con errori di battitura:
`Nidokikg ec3 888`, `Nidoking Wind from the Sea`, `ニドキング e3`, `Charizard Base Set 4`.
L'app riconosce il Pokémon (elenco di tutti i 1.025 Pokémon in inglese, giapponese, italiano, francese, tedesco, spagnolo),
l'espansione (nome o sigla, compresi i nomi inglesi dei vecchi set giapponesi) e il numero; se il numero non esiste lo ignora.
Le parole **UNP**, **promo** o **CoroCoro** limitano la ricerca alle carte promozionali
(es. `Nidoking UNP` trova Giovanni's Nidoking, promo CoroCoro del 1999, nel catalogo Cardmarket).
Le carte trovate in altre lingue (per esempio i set usciti solo in Giappone) compaiono in una sezione a parte.

1. **TCGdex**: carte ufficiali con immagini e nomi in italiano, giapponese ecc. Se nella lingua scelta trova poco,
   cerca anche in inglese.
2. **Catalogo ufficiale Cardmarket** (solo con l'estensione): tutte le ~75.000 carte Pokémon in vendita su Cardmarket
   e ~5.000 prodotti sigillati, con la guida prezzi aggiornata ogni giorno. Nomi in inglese, senza immagine
   (puoi caricare una foto). Il catalogo non contiene i nomi di tutte le espansioni: in *Impostazioni → Importa nomi
   delle espansioni* l'app apre Cardmarket in una scheda e li legge (se compare la verifica di sicurezza, completala tu).
3. **Topsun (1997)**: le 165 carte (Prism comprese) con immagine, dalla lista di CardCodex. Prezzo dai venduti eBay.
4. **Carta inserita a mano**: per Carddass e tutto ciò che manca. Nome, serie (con l'elenco delle serie Carddass già pronto),
   numero, lingua e foto; prezzo dai venduti eBay o a mano.

Nel **Sealed** puoi collegare il prodotto del catalogo Cardmarket per usarne il prezzo di tendenza.

Le carte di **Pokémon TCG Pocket** (gioco digitale, set A1… B2a e promo P-A) sono escluse da ricerca, espansioni e master set.

## Master set: album e valore scritto a mano

Il master set è un **album**: segna le carte (in ogni versione) che hai e quelle che mancano, e da lì le aggiungi
alla collezione. **Non cerca prezzi da solo**: le ricerche automatiche (carta per carta, e poi la stima dagli
annunci) facevano scattare i controlli anti-bot o non funzionavano.

Il **valore** del master set lo scrivi tu. Nella pagina del master set c'è la ricerca eBay degli **annunci in
vendita** `masterset <espansione> <lingua>` (es. `masterset 151 italiano`): **Apri su eBay** la apre in una scheda
(il testo si può cambiare, es. nome inglese del set, e viene ricordato). Guardi i prezzi e scrivi il valore nel
campo **Salva valore** (accetta `420`, `420,50`, `1.250,00`). Il valore compare nell'elenco dei master set e, quando
il master è completo, nella sua scheda unica in Collezione.
**Carte singole:** il prezzo segue la fonte scelta in Impostazioni (o nella carta): minimo Cardmarket nella lingua,
tendenza, venduti eBay… Le ricerche eBay e la lettura del minimo Cardmarket si fanno **solo aprendo la carta**, una
alla volta, e valgono 2 mesi: niente più ricerche in background per tutta la collezione. Le carte aggiunte dal master
set usano la fonte scelta in Impostazioni (quelle aggiunte prima con «mediana eBay automatica» ci sono tornate).
Nei set giapponesi con sole reverse a motivo (es. 151: Poké Ball e Master Ball) non c'è la reverse «generica».
**30° anniversario:** la Classic Collection (set TCGdex `30th-c`, 30 carte) è nella lista carte del set (guida
dell'ETB), quindi il master set del 30° la comprende in una sezione a parte (`MASTER_EXTRA` in `app.js`), e in
Collezione il master completo raccoglie anche quelle carte. La Classic Collection non si può più seguire come master
set a sé: non compare nella scelta, il suo link apre il 30° e un master «Classic Collection» già salvato viene unito
a quello del 30° all'avvio. Il riquadro unico in Collezione appare dopo aver aperto una volta il master set
(serve il conteggio aggiornato con le carte incluse). Il timbro «30th anniversary» presente su tutte le copie
non conta come versione in più. Essendo ristampe, le carte della Classic Collection non mostrano il numero 001–030
ma quello di Cardmarket, con la sigla del set e il numero della carta originale: es. Zacian V → `30C SSH 138`
(`CLASSIC_PREFIX` e `CLASSIC_ORIG` in `app.js`; vale anche nell'esportazione CSV).

Ricerche salvate con le regole vecchie (lingua a gruppo «(ita,italiano,…)», oppure Classic Collection senza la
sigla della carta originale, es. `N 101/101 classic collection`) vengono sempre rifatte con quelle nuove
(`staleAutoQuery`), anche se l'app le aveva segnate per errore come scritte a mano. Anche il minimo Cardmarket
nella lingua passa il controllo di plausibilità. La lettura della pagina Cardmarket (`content-cm-price.js`) prende il
prezzo da un solo testo alla volta: prima univa i testi della riga e la quantità «1» si attaccava al prezzo
(12,00 € → 112,00 €); i minimi letti così sono scartati e riletti (`CMMIN.V`). In ogni caso: un'unica offerta fuori mercato (es. 112 € con tendenza 13 €)
non diventa il prezzo della carta.

## Minimo Cardmarket nella lingua della carta

Il «Da» del listino Cardmarket è l'offerta più bassa in **tutte le lingue** (es. un Gengar tedesco più economico
dell'italiano): nella scheda della carta ora si chiama «Da (tutte le lingue)». Accanto c'è **«Minimo ITA/ENG/JPN
NM»**, l'offerta più bassa nella lingua che hai scelto, in condizione Near Mint o migliore: l'estensione lo legge dalla
pagina della carta su Cardmarket (scheda in background) quando apri la carta, e lo ricorda 2 mesi. Con la fonte
prezzo «Cardmarket – prezzo minimo» il valore usa quel minimo nella lingua; finché non è letto usa la tendenza, mai
il minimo di un'altra lingua.

## Master set completi nella collezione

Quando un master set è completo, in Collezione le sue carte diventano una sola scheda con il valore complessivo
(le gradate restano a parte). Cliccandola apri il master set; scegliendo il set nel filtro rivedi le singole carte.
Nel master set conta **una sola copia per carta e versione** (a parità, quella in condizione migliore): i doppioni,
sia le schede in più sia le copie in più della stessa scheda (×2, ×3…), restano in Collezione come carte singole con
l'etichetta «Doppione». Il totale della collezione conta comunque tutte le copie.

## Classic Collection nella ricerca eBay

Le carte della **Classic Collection** (30° anniversario e Celebrations) sono ristampe di carte famose: la ricerca
eBay usa il numero della ristampa (sigla e numero della carta originale) e il nome del set, es.
`Charizard 30C BS 4 Collezione Classica del 30`. Sigle e numeri sono nella tabella `CLASSIC_ORIG` di `app.js`.

Per non confondere ristampa e originale:
- per le carte Classic Collection contano solo gli annunci con «classic» nel titolo; per tutte le altre carte
  gli annunci «classic collection» sono scartati. La parola «collection» del nome della serie non conta come
  lotto (prima scartava tutte le vendite vere della Classic Collection);
- la lettura si ferma al separatore eBay «Risultati che corrispondono a meno parole» (`ebay-parse.js`):
  dopo quel punto eBay mostra annunci che non contengono tutte le parole cercate;
- controllo di plausibilità (`ebayOk` in `app.js`): se la mediana eBay è più di 4 volte sopra o sotto la
  tendenza Cardmarket, è scartata e si usa il minimo Cardmarket nella lingua (o la tendenza). Nel master set il
  prezzo lo spiega il suggerimento sul prezzo.
- Le mediane salvate con i filtri vecchi si ricalcolano da sole (`EBAY_FV`).

## Come è composta la ricerca eBay di una carta

La ricerca contiene **solo**, in quest'ordine e senza simboli (niente `/`, `-`, parentesi, apostrofi):
1. **nome della carta**;
2. **numero** della carta senza il totale e senza zeri davanti (`5/100` → `5`, `006` → `6`;
   le sigle come `TG05` o `SWSH050` restano);
3. **nome del set** nella lingua della carta (es. `Spada e Scudo`, `Base Set`, `変幻の仮面`);
4. **versione**, solo se c'è: `prima edizione` (o `1st edition` per le carte non italiane), `unlimited`,
   `reverse holo`, `reverse holo Poké Ball`, `stamped Pokémon Center`, `shadowless`…;
5. per le carte gradate anche ente e voto (es. `PSA 10`).

Esempi: `Charizard 4 Base Set 1st edition`, `Pikachu 25 151 reverse holo`,
`Pikachu ex 57 Scintille Folgoranti stamped Player Rewards Program`.
Le ricerche scritte a mano restano come le hai scritte; quelle automatiche salvate con le regole vecchie si rifanno da sole.

## 1ª edizione e Unlimited

Per tutte le carte che esistono anche in **1ª edizione** (Set Base, Jungle, Fossil, Team Rocket, Gym, Neo…), le altre
versioni si chiamano **Unlimited** (es. «Holo · Unlimited»). La ricerca eBay aggiunge «unlimited» o «1st edition»
e scarta le vendite dell'altra tiratura. Le carte già in collezione vengono aggiornate da sole all'apertura dell'app.

## Set Base inglese: Shadowless

Per le carte del **Set Base inglese** (solo inglese: le altre lingue non hanno queste tirature) puoi scegliere:
**1ª edizione · Shadowless**, **Shadowless** (prime tirature senza ombra a destra del riquadro dell'illustrazione),
normale (Unlimited) e **1999-2000** (ristampa UK). Shadowless e 1ª edizione usano il prodotto Cardmarket "Shadowless"
(Cardmarket non separa la 1ª edizione nella guida prezzi). La ricerca eBay aggiunge "1st edition" o "shadowless" e
tiene solo le vendite della stessa tiratura. Nel master set del Set Base compaiono come versioni separate.

## Immagini delle carte

TCGdex non ha l'immagine di molte carte, soprattutto giapponesi. Il file `images.js` è un database locale con le
immagini mancanti, controllate una per una:

| Carte | Fonte | Immagini |
|---|---|---|
| Giapponesi dal 2011 (BW → Mega) | [Limitless TCG](https://limitlesstcg.com/cards/jp) | ~9.170 giapponesi in tutto |
| Giapponesi vintage (Base, Gym, Neo, VS, web, e-Series, PCG…) e rare segrete Spada e Scudo | [Scrydex](https://scrydex.com) | (insieme alla riga sopra) |
| Inglesi mancanti (promo, Trainer Kit, Mega Evolution…) | Scrydex | 1.922 |

Le carte italiane senza immagine usano quella inglese della stessa carta. Restano senza immagine circa 100 carte
giapponesi (soprattutto energie base e il set BW8a): puoi caricare una tua foto dalla scheda della carta.

**Carte del catalogo Cardmarket**: l'anteprima arriva dal file `cm-images.js` (~49.900 prodotti su ~75.500). Le carte
sono collegate alle carte TCGdex e, per le altre, all'elenco di Scrydex: ogni espansione Cardmarket viene abbinata a
quella Scrydex con gli stessi Pokémon, poi carta per carta per nome; le carte con un nome unico (es. «Kricketune V»)
si abbinano anche nelle raccolte miste. Senza immagine restano soprattutto set cinesi, indonesiani/thailandesi e
codici online. Se manca, aprendo la scheda della carta l'app apre la pagina del prodotto su Cardmarket in una scheda
in background, ne legge l'immagine e la ricorda. Se Cardmarket mostra la verifica di sicurezza, la scheda passa in
primo piano: completala e l'immagine arriva da sola.

## Aggiornamenti

Dalla versione 1.7.0 l'estensione si aggiorna da sola: ogni minuto (e quando torni sulla scheda dell'app) controlla
la cartella `vetrina-tcg` e, se c'è una versione nuova, si ricarica e riapre l'app. La versione è in fondo alle Impostazioni.
Per passare alla 1.7.0 serve premere ↻ in `chrome://extensions` un'ultima volta.

## Carte gradate

Scegli ente (PSA, BGS, CGC, AiGrading, GRAAD, TAG, ACE, SGC, PCA), voto e, se vuoi, numero di certificato:
la carta appare dentro una busta con l'etichetta nei colori dell'ente (per BGS: argento fino a 9, oro da 9.5 e per il
Pristine 10, nera per il Black Label).

Per un **BGS 10** scegli se è **Pristine 10** o **Black Label 10** (tutti i sottovoti 10): cambiano etichetta, ricerca eBay
("BGS 10 Black Label") e vendite considerate. Un Pristine non usa le vendite Black Label e viceversa, perché i prezzi sono molto diversi.

## Da dove arrivano i dati

| Cosa | Fonte |
|---|---|
| Carte, nomi localizzati, immagini | [TCGdex](https://tcgdex.dev), API gratuita e open source |
| Prezzi Cardmarket (EUR) | TCGdex, che li aggiorna ogni giorno dalla guida prezzi di Cardmarket |
| Venduti eBay | la pagina "Oggetti venduti" di eBay, letta dal tuo Chrome |
| Cambi valuta | Banca Centrale Europea tramite Frankfurter |

**eBay** mostra i venduti solo agli utenti che hanno effettuato l'accesso: tieni l'accesso a eBay attivo in Chrome.
Quando premi «Cerca venduti», l'app legge i risultati (se serve apre la pagina in una scheda in background e la chiude da sola).
Vengono escluse in automatico le inserzioni gradate (se la tua carta non è gradata), i lotti, quelle in altre lingue e i prezzi anomali.
Puoi includere o escludere le singole vendite con un clic. La ricerca eBay è modificabile e viene ricordata per ogni carta.

La ricerca eBay automatica usa **nome del Pokémon + numero completo** (`Nidoking 088/087`). Per le carte giapponesi
il nome viene tradotto in inglese, come lo scrivono i venditori, e si aggiunge "japanese".

**Carte gradate** (PSA, BGS, CGC, AiGrading, GRAAD, TAG, ACE, SGC, PCA): scegli ente e voto nella scheda della carta.
La ricerca diventa per esempio `Nidoking 088/087 japanese PSA 10` e contano solo le vendite con lo **stesso ente e
lo stesso voto** (un PSA 9 o un BGS 10 vengono scartati; per TAG le carte "Tag Team" non si confondono).
Il valore delle gradate arriva dai venduti eBay e si aggiorna da solo ogni 2 mesi (o subito con ⟳).
Se non ci sono vendite, vale il prezzo scritto a mano.

**Cardmarket** blocca i programmi che leggono le sue pagine, quindi l'app usa i prezzi che TCGdex prende dalla guida
prezzi ufficiale di Cardmarket. Il link "Apri su Cardmarket" porta alla pagina della carta.

I prezzi si aggiornano da soli all'apertura dell'app (al massimo ogni 12 ore) oppure con il pulsante ⟳ in alto.
Lo storico del valore si costruisce giorno per giorno: finché ci sono pochi giorni, il grafico mostra una stima
(linea tratteggiata) basata sulle medie Cardmarket a 30, 7 e 1 giorno.

## File

| File | Contenuto |
|---|---|
| `manifest.json`, `background.js` | estensione di Chrome |
| `index.html`, `style.css` | pagina e grafica |
| `app.js` | interfaccia |
| `data.js` | salvataggio (IndexedDB), TCGdex, cambi valuta, eBay |
| `ebay-parse.js`, `content-ebay.js` | lettura delle pagine dei venduti eBay |
| `i18n.js` | testi in italiano, inglese e giapponese |
| `pokedex.js` | nomi dei Pokémon in più lingue (da PokeAPI), per la ricerca |
| `topsun.js` | elenco delle carte Topsun |
| `images.js` | immagini delle carte che TCGdex non ha (Limitless TCG, Scrydex) |
| `cm-images.js` | anteprime dei prodotti del catalogo Cardmarket (~49.900) |
| `content-cm-image.js` | legge l'immagine dalla pagina di un prodotto Cardmarket |

Fai ogni tanto **Impostazioni → Esporta backup**: se disinstalli l'estensione i dati vengono cancellati.
