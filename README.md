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
   - **Väderprognos**, 5 dagar framåt med riktiga väderikoner, frostrisk
     markerad.
   - **Bevattning** — en Claude-genererad rekommendation som väger in
     väderprognosen, era zoner/odlingar och kopplade jordfuktighetssensorers
     senaste värden (se "Smart bevattning" nedan). Faller tillbaka på en
     enkel regelbaserad insikt (baserad på väntad nederbörd) om
     `ANTHROPIC_API_KEY` inte är satt.
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
     på pekskärm, och ctrl/⌘ + rulle på dator. På mobilen anpassas zoomen
     automatiskt vid första ritningen, vid flikbyte och vid skärmrotation,
     så zonerna aldrig sticker utanför ramen. Lodräta svep skrollar sidan
     som vanligt.

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
| GET | `/api/vader` | – | 5-dagars väderprognos från SMHI |
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
| POST | `/api/zoner/uppdatera` | `{ id, jord?, anteckning?, enhetIds?, x?, y?, bredd?, hojd?, foralderId? }` | Uppdaterar en zon, inkl. position och storlek på kartan (dragning) och vilken zon den ligger i |
| POST | `/api/zoner/ta-bort` | `{ id }` | Tar bort en zon (plantor blir okategoriserade, sektioner flyttas upp en nivå) |
| GET | `/api/enheter/status` | – | Hämtar nuvarande tillstånd för alla bevakade HA-entiteter |
| POST | `/api/enheter` | `{ entityId, namn? }` | Lägger till en bevakad HA-entitet |
| POST | `/api/enheter/ta-bort` | `{ id }` | Tar bort en bevakad enhet |
| GET | `/api/ha-entiteter` | – | Hela HA:s entitetslista, för sökbar autocomplete (kräver `HA_TOKEN`) |
| GET | `/api/historik` | – | Hämtar loggad historik för entiteter kopplade till zoner/odlingar |
| GET | `/api/bevattning` | – | Hämtar den Claude-genererade bevattningsinsikten (cachad 4h) |
| POST | `/api/chatt` | `{ meddelanden: [{ roll, text, bild? }] }` | AI-chatt med valfritt foto (`bild: { typ, data }`, base64) |
| GET | `/api/installningar` | – | Hämtar sparat ntfy-ämne/webhook-URL |
| POST | `/api/installningar` | `{ ntfyTopic?, webhookUrl? }` | Sparar ntfy-ämne/webhook-URL (via ⚙️ i panelen) |

## Framtida utbyggnad

Automatisk vattenhantering är inte byggt än (kräver kända ventil-/pump-
entiteter, som ni inte har förrän ni har eget hus) men "Enheter"-listan är
redo att bli grunden för det: lägg till jordfuktighetssensorer där först,
och när ni vet exakt vilken integration/entitet er bevattningsventil blir
(t.ex. en `switch`- eller `valve`-entitet) hör av er, så bygger vi
automatiseringslogik (t.ex. "vattna om jordfuktighet under X% och ingen
nederbörd väntas") ovanpå samma data.
