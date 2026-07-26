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
     markerad, plus en enkel bevattningsinsikt baserad på väntad nederbörd.
   - **Trädgårdskarta** — en visuell karta som grupperar alla odlingar per
     zon (färgad efter zontyp, med ett auto-gissat växtemoji per planta).
     Odlingar utan zon hamnar i en egen "Okategoriserat"-grupp. Klicka på en
     zon eller en planta för att öppna en popup där ni kan skriva jordtyp och
     fria anteckningar, samt koppla valfritt antal HA-entiteter till just den
     zonen/plantan — deras senaste värde visas sen direkt som en badge på
     kartan (t.ex. 💧 42 % jordfuktighet på ett växthus, eller på en enskild
     kruka).
   - **Historik** — varje HA-entitet som är kopplad till en zon eller odling
     loggas en gång i timmen, och panelen ritar en trendkurva (senaste,
     min/max) per koppling. Byggs upp av sig själv från den dag ni kopplar en
     entitet — ingen bakåtgående data.

   **Inställningar** (`/#installningar`) — allt ni fyller i eller lägger till:
   - **⚙️ Notiser** — ntfy-ämne och HA-webhook-URL för skördepåminnelser.
   - **Zoner** — lägg till nya bäddar, växthus, odlingslådor, inomhus/utomhus.
   - **Odlingsjournal** — lägg till vad som planterats, i vilken zon, när, och
     när det ska skördas (med automatisk skördepåminnelse, se nedan).
   - **HA-enheter** — lägg till valfri Home Assistant-entitet (namn +
     `entity_id`) och se dess nuvarande värde. Tänkt att växa: den dagen ni
     har jordfuktighetssensorer, ventiler eller annat i HA, lägg bara in
     `entity_id` här — ingen kodändring behövs, sen kopplar ni den till en
     zon/odling via Trädgårdskartans popup på översikten.

Ingen inloggning i panelen – samma modell som de andra apparna: skyddet
ligger i att den bara är nåbar via ert eget nätverk/VPN eller bakom samma
Zero Trust-lager som resten av er Home Assistant-domän.

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
| POST | `/api/odlingar` | `{ namn, zonId?, planterad?, skordFonster?, skordManad?, anteckning? }` | Lägger till en odling |
| POST | `/api/odlingar/uppdatera` | `{ id, planterad?, skordFonster?, skordManad?, anteckning?, jord?, enhetIds? }` | Uppdaterar en odling (via popupen i Trädgårdskartan) |
| POST | `/api/odlingar/ta-bort` | `{ id }` | Tar bort en odling |
| POST | `/api/zoner` | `{ namn, typ? }` | Lägger till en zon (`typ`: `vaxthus`/`utomhus`/`inomhus`/`odlingslada`/`annat`) |
| POST | `/api/zoner/uppdatera` | `{ id, jord?, anteckning?, enhetIds? }` | Uppdaterar en zon (via popupen i Trädgårdskartan) |
| POST | `/api/zoner/ta-bort` | `{ id }` | Tar bort en zon (odlingar i den blir okategoriserade) |
| GET | `/api/enheter/status` | – | Hämtar nuvarande tillstånd för alla bevakade HA-entiteter |
| POST | `/api/enheter` | `{ entityId, namn? }` | Lägger till en bevakad HA-entitet |
| POST | `/api/enheter/ta-bort` | `{ id }` | Tar bort en bevakad enhet |
| GET | `/api/historik` | – | Hämtar loggad historik för entiteter kopplade till zoner/odlingar |
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
