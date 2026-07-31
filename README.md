# 🌱 Trädgårdsbevakning

Två delar i ett repo:

1. **Frostvarning** — körs gratis på GitHub Actions en gång per kväll, kollar
   [SMHI:s väderprognos](https://opendata.smhi.se) (gratis, ingen nyckel
   behövs) och skickar push via [ntfy.sh](https://ntfy.sh) om frostrisk
   väntas kommande dygn. Samma mönster som Bostadsvakt.
2. **En panel** (Docker, körs på home-vm som `bostadsvakt-api`/
   `hushallsekonomi`), uppdelad i två vyer (⚙️-knappen uppe till höger växlar
   mellan dem, styrt av URL-hash så bakåtknappen i webbläsaren fungerar):

   **Översikten** (`/`) — en ren visuell dashboard, inget att fylla i:
   - **Dagens väder** visas som en smal rad högst upp i trädgårdskarte-kortet
     (ikon, dagens max/min-temperatur, frost-chip vid frostrisk) — allt om
     platsen på en gång, utan att klämma in kartan i en delad ruta.
   - **Väder & bevattning** i sidokolumnen — den fulla 5-dagarsprognosen med
     riktiga väderikoner och frostrisk markerad, följt av **Bevattning**: en
     Claude-genererad rekommendation som väger in väderprognosen, era
     zoner/odlingar och kopplade jordfuktighetssensorers senaste värden (se
     "Smart bevattning" nedan). Faller tillbaka på en enkel regelbaserad
     insikt (baserad på väntad nederbörd) om `ANTHROPIC_API_KEY` inte är satt.
   - **Flera trädgårdskartor** — flikar ovanför kartan (t.ex. "Framsidan",
     "Baksidan", "Växthuset"). Klicka en flik för att byta karta; zoner hör
     till den karta de skapades på. Nya kartor läggs till med **+ Ny karta**
     eller från Inställningar.
   - **Egna block** — lägg till egna kort på översikten: antingen en samling
     HA-entiteter (visas som färgkodade mätvärdesrutor) eller en kamerabild
     från en HA-kameraentitet. Skapas under Inställningar, där ni också
     väljer om blocket ska ligga i den breda huvudkolumnen eller i
     sidokolumnen (under Historik). På varje block finns ↑/↓ för att ändra
     ordning och ⇄ för att flytta det till den andra kolumnen.
   - **🌿 AI-chatt** — en bubbla nere till höger där ni kan fråga fritt och
     **bifoga foton** ("varför ser den här plantan ut så här?"). Claude får med
     sig era zoner, plantor, kopplade sensorers värden, sensorhistorik och
     väderprognosen, och väger ihop bilden med mätdatan i svaret. Kräver
     `ANTHROPIC_API_KEY` (se "Smart bevattning" nedan). Foton skalas ner i
     webbläsaren innan de skickas och sparas aldrig på servern.
   - **Sektioner i en zon** — en zon kan innehålla andra zoner, så ett växthus
     kan rymma flera odlingslådor och bänkar som ritas inuti det. Samma sorts
     odlingslåda kan lika gärna stå fristående på kartan. Skapas via
     **+ Skapa nytt → Zon → Placering**, eller direkt från Zondetaljer.
     Tas en zon bort raderas inte dess sektioner – de blir fristående.
   - **Trädgårdskarta** — en fritt placerbar karta, ritad uppifrån: växthus
     som glasparti med takås, odlingslådor som träramar runt mörk jord,
     utomhusbäddar som organiska jordformer och inomhuszoner som ljusa hyllor
     med terrakottakrukor. Samma utseende oavsett om lådan står fristående
     eller är en sektion inuti ett växthus.

     **Zoomreglaget uppe till höger på kartan** har − / + och en knapp som
     visar zoomnivån – klicka den för att anpassa vyn så hela trädgården
     ryms. Kartan går också att dra för att panorera, nypa med två fingrar
     på pekskärm, och ctrl/⌘ + rulle på dator. Lodräta svep skrollar sidan
     som vanligt.

     **Kartan håller sig anpassad av sig själv.** Efter varje ändring –
     ny zon, flyttad låda, flikbyte, skärmrotation – zoomas den om så hela
     trädgården syns, vilket är avgörande på mobilen där zonernas fasta
     pixelbredder annars sticker utanför ramen. Zoomar eller panorerar ni
     själva respekteras det och automatiken stängs av; klicka på
     procentknappen för att slå på den igen. I redigeringsläget ligger vyn
     stilla så den inte hoppar mitt under att ni drar runt lådorna, och
     anpassar sig när ni klickar **Klar**.

     Klicka **Redigera layout** för att slå på flytt-läge, och **Klar, lås
     positionerna** när ni är nöjda. I redigeringsläge går det att:
     - **dra zoner** dit ni vill på kartan,
     - **dra sektioner** (odlingslådor, bänkar) till rätt plats *inuti* en zon,
     - **dra plantor** till rätt plats i sin låda eller bädd,
     - **ändra storlek** genom att dra i hörnhandtaget, och
     - **vända** en zon eller låda med ⟳ (byter bredd/höjd), så en låda kan
       ligga längs med eller stå på tvären.

     Allt sparas automatiskt. Odlingar utan zon hamnar i en egen
     "Okategoriserat"-grupp under kartan.
   - **Antal och fyllda ytor** — en odling är *en sort på en plats* och bär
     ett antal (st), som anges både när den skapas och går att ändra efteråt.
     Antalet ritas som lika många ikoner, så en låda med sex gurkor faktiskt
     ser ut att innehålla sex gurkor, med en liten siffra som gör mängden
     exakt. Två utseenden:
     - **Samlade på en plats** – ikonerna står i en klunga som flyttas som
       ett objekt. Bra när flera sorter delar på samma bädd.
     - **Fyll hela ytan** – sorten sprids jämnt över hela lådan, i stället
       för att man lägger till plantorna en och en. Perfekt för en låda med
       bara gurkor. Ligger två fyllda sorter i samma yta delar de den
       mellan sig, så "halva lådan morötter, halva rödbetor" också går.

     Ikonerna krymper automatiskt efter hur många de är och hur stor ytan
     är, så de aldrig svämmar över lådans kant.
   - **Snabbtillägg** — klicka på en zon och lägg till plantor direkt: ett
     textfält med förslag (era egna sorter, vanligast överst, påfyllda med
     vanliga köksväxter) i stället för en vägg av tryckknappar – skriv fritt
     eller välj ur listan, precis som HA-entitetssökningen i Inställningar.
     Antalet har stora − / +-knappar, och knappen säger exakt vad som
     händer ("Lägg till 6 × Gurkor"). Klicka på en planta i listan för att
     se dess egen översikt (samma detaljpanel som klick på kartan) –
     radera-knappen (×, syns bara i redigeringsläge) stör inte det.
   - **Detaljer** — klicka på en zon eller planta i kartan för att den
     markeras och visa/redigera antal, jordtyp, fria anteckningar, koppla
     valfritt antal HA-entiteter (senaste värde visas som en badge direkt på
     kartan, t.ex. 💧 42 % på ett växthus) samt en historik-graf per kopplad
     entitet.

     På en bred skärm är det en panel under kartan. **På telefonen glider den
     i stället upp som ett bottom sheet** över kartan, med draglist,
     bakgrundsdimning och svep nedåt för att stänga (eller ×, tryck utanför,
     eller Esc) — samma gest som i appar på iOS och Android. Panelen låg
     annars långt under vikningen på en telefon.
   - **Historik** — en samlad vy av alla kopplade entiteter över tid (loggas
     en gång i timmen). Byggs upp av sig själv från den dag ni kopplar en
     entitet — ingen bakåtgående data.
   - **☀️ Solkarta** — klicka **Sol** ovanför kartan för att se skuggorna som
     växthus och lådor kastar vid valfri tid på dygnet, uträknat rent
     matematiskt från trädgårdens koordinater (ingen väder-API behövs för
     själva solpositionen). Dra reglaget för att se hur skuggorna vandrar
     över dagen. I Zondetaljer för en zon visas dessutom **≈ X timmar sol
     idag**, uträknat genom att sampla dygnet var 15:e minut och kolla om
     zonens mitt ligger i en annan zons skugga.

     Kräver att **höjden** är satt per zon (Zondetaljer → "Höjd över
     marken"; ett rimligt standardvärde sätts automatiskt per zontyp) och
     att kartans **riktning och skala** är sparade under ⚙️ Inställningar →
     "Kartans läge i verkligheten" — annars vet solkartan inte vilket håll
     som är norr eller hur stor en meter är på skärmen.
   - **🌡️ Zonens eget mikroklimat** — har en zon en temperatursensor kopplad
     jämför panelen den automatiskt mot SMHI:s prognos för orten och lär sig
     över tid hur mycket varmare eller kallare zonen faktiskt ligger
     (medianen av minst 12 mätningar). Frostvarningen på översikten bryts
     sedan ut per zon: *"Rabatten: ner mot 1,5° (ligger typiskt 1,5° under
     prognosen)"* i stället för en enda regional siffra. Behöver ett dygns
     mätningar innan den har nog data för att visa något.
   - **📷 QR-etiketter** — i Zondetaljer, knappen **QR-etikett**, ger en
     utskriftsfärdig kod att tejpa på lådan. Skanna den med telefonens
     kamera och zonen öppnas direkt (`#zon=<id>`) — ingen kartnavigering.
     Kodas och ritas helt lokalt (ingen extern tjänst, ingen nätverksbild).
   - **Kompakt kartläge** — knappen **Kompakt** ovanför kartan byter de
     fulla zonkorten mot en miniatyr-planritning: samma bredd, höjd och
     riktning som de riktiga zonerna, bara flatfärgade efter zontyp i
     stället för glas/trä-texturerna – som ett litet arkitektritat
     siteplan. Klicka en form för att öppna samma detaljvy som vanligt.
     **Karta** växlar tillbaka. Redigering av layouten kräver de fulla
     korten och stängs av automatiskt när kompakt läge slås på.
   - **Fyra sätt att se trädgården** — en flikrad ovanför kartan:
     - **Översikt** — kartan, som vanligt.
     - **Per zon** — ett sammanfattningskort per zon (typ, antal planterat,
       kopplade sensorers värden); klick öppnar samma detaljpanel som från
       kartan.
     - **Per planta** — den enda vyn som går över zongränserna: alla
       odlingsposter med samma namn slås ihop till en sort, oavsett vilken
       zon eller karta de står på (t.ex. "Gurkor" i både växthuset och
       pallkragen räknas ihop till en totalsumma). Klicka en sort för att
       se var den finns och historik för alla kopplade sensorer.
     - **Historik** — samma innehåll som historik-kortet i sidokolumnen,
       fast i eget, större format.
   - **Kamerakontroller** — en kamerawidget har nu mjuka, halvtransparenta
     knappar ovanpå bilden: **uppdatera** hämtar en ny ögonblicksbild direkt
     (med tidsstämpel), **fullskärm** öppnar den stort i en enkel lightbox
     (stäng med ×, klick utanför eller Esc).
   - **🔔 Notiscenter** — klockan högst upp till höger (bredvid "Skapa nytt")
     samlar aktuella uppgifter räknade fram från er egen data: frostrisk
     (zonvis kalibrerad där det går), torr/för blöt jord, ovanligt kallt
     eller varmt, sensorer som inte går att nå, samt skördepåminnelser för
     odlingar vars skördemånad är nu. Varje notis går att **markera som
     klar (✓)** eller **avvisa (×)** — valet sparas på servern så det inte
     kommer tillbaka vid nästa besök eller på en annan enhet. En hanterad
     notis dyker upp igen automatiskt om samma läge fortfarande gäller
     nästa dag (eller nästa månad för skördepåminnelser) — den är "klar för
     nu", inte borta för gott.

     **AI-optimerad** (kräver `ANTHROPIC_API_KEY`) — de regelbaserade
     kandidaterna ovan skickas till Claude tillsammans med samma
     trädgårdssammanfattning som bevattningsinsikten använder. Claude
     **prioriterar** dem efter faktisk angelägenhet för just er trädgård,
     **slår ihop** närbesläktade notiser till en, och **skriver om** texten
     till en kort, konkret mening. En liten **"✨ Prioriterat av AI"**-etikett
     syns i panelen när det skett. Claude får aldrig hitta på nya notiser
     eller fakta – varje id i svaret måste redan finnas bland kandidaterna,
     annars kasseras det tyst. Cachas några timmar per uppsättning
     kandidater (samma mönster som bevattningsinsikten); utan nyckel eller
     om anropet misslyckas visas de vanliga, regelbaserade raderna precis
     som vanligt.

   **Ikonspråk** — strukturella ikoner (zontyp, sensortyp, frost, "sensorn
   svarar inte", kamerakontroller) är tunna, enfärgade linjeikoner i samma
   stil som sidopanelens hem/kugghjul, i stället för emoji – det gav ett
   mer sammanhållet, "designat" intryck än en blandning av olika plattformars
   emoji-teckensnitt. Plantor och väder är medvetet kvar som emoji: 19
   grönsaker eller SMHI:s redan polerade vädersymboler som linjeikoner hade
   kostat igenkänningsbarhet utan att vinna särskilt mycket.

   **Inställningar** (`/#installningar`) — allt ni fyller i eller lägger till:
   - **⚙️ Notiser** — ntfy-ämne och HA-webhook-URL för skördepåminnelser.
   - **Zoner** — lägg till nya bäddar, växthus, odlingslådor, inomhus/utomhus
     (dra dem sen på plats i Trädgårdskartan på översikten).
   - **Odlingsjournal** — lägg till vad som planterats, i vilken zon, när, och
     när det ska skördas (med automatisk skördepåminnelse, se nedan).
   - **HA-enheter** — sök fram entiteter direkt ur Home Assistant (namn eller
     entity_id, autocomplete) istället för att behöva komma ihåg dem utantill,
     och se deras nuvarande värde. Koppla dem sen till en zon/odling via
     Zondetaljer-panelen på översikten.
   - **Kartans läge i verkligheten** — vilket kompassväder som pekar uppåt på
     kartan, och kartans bredd i meter. Behövs bara för solkartan.

Ingen inloggning i panelen – samma modell som de andra apparna: skyddet
ligger i att den bara är nåbar via ert eget nätverk/VPN eller bakom samma
Zero Trust-lager som resten av er Home Assistant-domän.

## Smart bevattning (Claude)

Bevattningskortet på översikten kan ge en AI-genererad rekommendation istället
för bara en enkel regel om nederbörd. Servern skickar en sammanfattning av
era zoner, odlingar, kopplade sensorers senaste värden och väderprognosen
till Claudes API (`claude-sonnet-5`) och ber om en kort, konkret insikt.

- **`ANTHROPIC_API_KEY`** — skaffas på [console.anthropic.com](https://console.anthropic.com)
  (separat från ett ev. Claude.ai-abonnemang, faktureras per anrop).
- Resultatet cachas i **4 timmar** server-side, så kostnaden hålls försumbar
  oavsett hur många gånger panelen laddas.
- Helt valfritt — utan nyckeln visas istället den enkla regelbaserade
  insikten (baserad på väntad nederbörd de kommande dagarna), ingen
  funktion går sönder.
- **Lägg aldrig nyckeln i `docker-compose.example.yml`** (den är committad och
  publik) — bara i er egna, gitignorade `docker-compose.yml` på home-vm.

## Notiser (skördepåminnelser + frostvarning)

Båda notiskällorna skickar till **ntfy** och/eller en **Home Assistant-
webhook**, samma dubbla mönster som Bostadsvakt:

- **ntfy-ämne** — push till mobilen via [ntfy.sh](https://ntfy.sh).
- **HA-webhook-URL** — valfritt, POSTar `{ title, message }` till en HA-
  webhook-URL (**Inställningar → Automationer → Webhook-utlösare** i Home
  Assistant ger er URL:en). En HA-automation kan sen göra vad ni vill med
  notisen (visa på en skärm, säga den högt, blinka en lampa) utöver
  ntfy-pushen. Helt valfritt att sätta en av dem, båda, eller ingen.

**Den dagliga skördepåminnelse-kollen i panelen** ställs in direkt i
gränssnittet — klicka på ⚙️-knappen uppe till höger i panelen och fyll i
ntfy-ämne/webhook-URL, ingen SSH eller docker-compose behövs. Värdet sparas
i panelens datafil. Miljövariablerna `NTFY_TOPIC`/`WEBHOOK_URL` i
docker-compose fungerar fortfarande som förvalda värden om ni hellre vill
sätta dem där (t.ex. innan ni hunnit öppna panelen första gången) — det som
sparats via ⚙️ i panelen vinner om båda är satta.

**Frostvarnings-jobbet på GitHub Actions** är en fristående, schemalagd
process som körs på GitHubs servrar och saknar åtkomst till panelens
datafil — den kan alltså *inte* styras via ⚙️-knappen, utan behöver egna
repo-secrets enligt nedan.

## Frostvarning – kom igång

1. Skapa ett GitHub-repo-secret **`GEO_LAT`** och **`GEO_LON`** (era
   trädgårds koordinater, t.ex. `59.85` och `17.63` — sök på
   [OpenStreetMap](https://www.openstreetmap.org) och högerklicka på platsen
   för att få koordinaterna).
2. Sätt secret **`NTFY_TOPIC`** (samma eller ett nytt ämne som Bostadsvakt
   använder) och/eller secret **`WEBHOOK_URL`** (se "Notiser" ovan).
3. Valfritt: repo-variabel **`FROST_TROSKEL`** (grader C, standard `3` —
   marginal mot markfrost eftersom SMHI:s prognos är lufttemperatur 2 m upp,
   inte marktemperatur).
4. Fliken **Actions** → **Frostvarning** → **Run workflow** för att testa
   direkt, annars körs den automatiskt varje kväll kl 18 (sommartid).

Utan `GEO_LAT`/`GEO_LON` hoppar jobbet över och loggar varför, i stället för
att misslyckas — annars hade den schemalagda körningen larmat varje natt bara
för att bevakningen inte var påslagen än.

## Panelen – kom igång

```bash
sudo mkdir -p /opt/docker/tradgardsbevakning
cd /opt/docker/tradgardsbevakning
sudo git clone https://github.com/mathiasmholm/tradgardsbevakning.git .
```

Fyll i `HA_TOKEN` (samma långlivade token som för `hushallsekonomi` funkar
fint, eller skapa en ny) och `GEO_LAT`/`GEO_LON` i
`docker-compose.example.yml` (ntfy-ämne/webhook-URL kan lämnas tomma här och
istället sättas via ⚙️ i panelen efter start, se "Notiser" ovan), döp om och
starta:

```bash
sudo mv docker-compose.example.yml docker-compose.yml
sudo docker compose up -d
```

Bilden byggs och pushas automatiskt till GHCR av GitHub Actions vid varje
push (se `.github/workflows/docker-publish.yml`), och Watchtower-labeln på
containern gör att den nya versionen rullas ut automatiskt på home-vm — inga
manuella `git pull`/`docker compose up --build` behövs efter första
installationen.

Testa: `curl http://127.0.0.1:8097/api/vader` (obs: `127.0.0.1`, inte bara
`localhost` – annars kan IPv6/IPv4 krångla, se Bostadsvakt/Hushållsekonomis
felsökningshistorik).

### Koppla in bakom er reverse proxy

Samma mönster som de andra apparna: en **Custom Location** i Nginx Proxy
Manager på det befintliga Proxy Host som redan pekar mot Home Assistant:

- Location: `/tradgardsbevakning`
- Forward Hostname/IP: samma som ni redan använder för HA
- Forward Port: `8097`

Lägg sen till en egen sida i HA:s sidomeny (**Inställningar →
Kontrollpaneler → Lägg till kontrollpanel → Ny kontrollpanel från en URL**)
som pekar på `https://<er-domän>/tradgardsbevakning/` — **glöm inte det
avslutande snedstrecket**, annars letar panelen efter sina egna API-anrop
på fel ställe.

## Endpoints

| Metod | Path | Body | Gör |
|---|---|---|---|
| GET | `/` | – | Panelen (HTML) |
| GET | `/api/vader` | – | 5-dagars väderprognos från SMHI, plus nu-temperatur och koordinater (används av solkartan) |
| GET | `/api/odlingar` | – | Hämtar zoner + odlingsjournalen |
| POST | `/api/odlingar` | `{ namn, zonId?, antal?, layout?, planterad?, skordFonster?, skordManad?, anteckning? }` | Lägger till en odling (`antal`: 1–200 st, `layout`: `klunga`/`fyll`) |
| POST | `/api/odlingar/uppdatera` | `{ id, antal?, layout?, x?, y?, planterad?, skordFonster?, skordManad?, anteckning?, jord?, enhetIds? }` | Uppdaterar en odling, inkl. antal, utseende och plats i sin zon |
| POST | `/api/odlingar/ta-bort` | `{ id }` | Tar bort en odling |
| POST | `/api/zoner` | `{ namn, typ?, x?, y?, kartaId?, foralderId? }` | Lägger till en zon (`typ`: `vaxthus`/`utomhus`/`inomhus`/`odlingslada`/`annat`). Med `foralderId` blir den en sektion inuti den zonen |
| POST | `/api/kartor` | `{ namn }` | Lägger till en trädgårdskarta (flik) |
| POST | `/api/kartor/ta-bort` | `{ id }` | Tar bort en karta (zonerna flyttas till första kvarvarande) |
| POST | `/api/widgets` | `{ titel, typ, enhetIds?, entityId?, kolumn? }` | Lägger till ett eget block (`typ`: `entiteter`/`kamera`, `kolumn`: `huvud`/`sido`) |
| POST | `/api/widgets/uppdatera` | `{ id, titel?, enhetIds?, entityId?, kolumn? }` | Uppdaterar ett eget block |
| POST | `/api/widgets/ordna` | `{ ids: [...] }` | Sparar ny ordning på blocken (↑/↓ i panelen) |
| POST | `/api/widgets/ta-bort` | `{ id }` | Tar bort ett eget block |
| GET | `/api/kamera?entityId=` | – | Proxar en ögonblicksbild från en HA-kameraentitet (HA-token stannar på servern) |
| POST | `/api/zoner/uppdatera` | `{ id, jord?, anteckning?, enhetIds?, x?, y?, bredd?, hojd?, hojdM?, foralderId? }` | Uppdaterar en zon, inkl. position/storlek på kartan, höjd (för solkartan) och vilken zon den ligger i |
| POST | `/api/zoner/ta-bort` | `{ id }` | Tar bort en zon (plantor blir okategoriserade, sektioner flyttas upp en nivå) |
| GET | `/api/enheter/status` | – | Hämtar nuvarande tillstånd för alla bevakade HA-entiteter |
| POST | `/api/enheter` | `{ entityId, namn? }` | Lägger till en bevakad HA-entitet |
| POST | `/api/enheter/ta-bort` | `{ id }` | Tar bort en bevakad enhet |
| GET | `/api/ha-entiteter` | – | Hela HA:s entitetslista, för sökbar autocomplete (kräver `HA_TOKEN`) |
| GET | `/api/historik` | – | Hämtar loggad historik för entiteter kopplade till zoner/odlingar |
| GET | `/api/bevattning` | – | Hämtar den Claude-genererade bevattningsinsikten (cachad 4h) |
| POST | `/api/chatt` | `{ meddelanden: [{ roll, text, bild? }] }` | AI-chatt med valfritt foto (`bild: { typ, data }`, base64) |
| GET | `/api/installningar` | – | Hämtar sparat ntfy-ämne/webhook-URL samt kartans riktning/skala |
| POST | `/api/installningar` | `{ ntfyTopic?, webhookUrl?, norrGrader?, kartaBreddM? }` | Sparar inställningarna (via ⚙️ i panelen) |
| POST | `/api/notiser` | `{ id, atgard: "klar"\|"avvisad" }` | Markerar en notis i notiscentret som hanterad, så den inte dyker upp igen |
| POST | `/api/notiser/ai` | `{ kandidater: [{ id, titel, text, niva }] }` | Låter Claude prioritera/slå ihop/skriva om notiscentrets kandidater (kräver `ANTHROPIC_API_KEY`, annars returneras kandidaterna oförändrade) |

## Framtida utbyggnad

Automatisk vattenhantering är inte byggt än (kräver kända ventil-/pump-
entiteter, som ni inte har förrän ni har eget hus) men "Enheter"-listan är
redo att bli grunden för det: lägg till jordfuktighetssensorer där först,
och när ni vet exakt vilken integration/entitet er bevattningsventil blir
(t.ex. en `switch`- eller `valve`-entitet) hör av er, så bygger vi
automatiseringslogik (t.ex. "vattna om jordfuktighet under X% och ingen
nederbörd väntas") ovanpå samma data.
