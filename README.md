# 🌱 Trädgårdsbevakning

Två delar i ett repo:

1. **Frostvarning** — körs gratis på GitHub Actions en gång per kväll, kollar
   [SMHI:s väderprognos](https://opendata.smhi.se) (gratis, ingen nyckel
   behövs) och skickar push via [ntfy.sh](https://ntfy.sh) om frostrisk
   väntas kommande dygn. Samma mönster som Bostadsvakt.
2. **En panel** (Docker, körs på home-vm som `bostadsvakt-api`/
   `hushallsekonomi`) med:
   - **Väderprognos**, 5 dagar framåt, frostrisk markerad.
   - **Odlingsjournal** — vad som planterats var, när, och när det ska skördas.
   - **HA-enheter** — lägg till valfri Home Assistant-entitet (namn +
     `entity_id`) och se dess nuvarande värde. Tänkt att växa: den dagen ni
     har jordfuktighetssensorer, ventiler eller annat i HA, lägg bara in
     `entity_id` här — ingen kodändring behövs.

Ingen inloggning i panelen – samma modell som de andra apparna: skyddet
ligger i att den bara är nåbar via ert eget nätverk/VPN eller bakom samma
Zero Trust-lager som resten av er Home Assistant-domän.

## Frostvarning – kom igång

1. Skapa ett GitHub-repo-secret **`GEO_LAT`** och **`GEO_LON`** (era
   trädgårds koordinater, t.ex. `59.85` och `17.63` — sök på
   [OpenStreetMap](https://www.openstreetmap.org) och högerklicka på platsen
   för att få koordinaterna).
2. Sätt secret **`NTFY_TOPIC`** (samma eller ett nytt ämne som Bostadsvakt
   använder).
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
fint, eller skapa en ny), `GEO_LAT`/`GEO_LON` i
`docker-compose.example.yml`, döp om och starta:

```bash
sudo mv docker-compose.example.yml docker-compose.yml
sudo docker compose up -d --build
```

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
| GET | `/api/odlingar` | – | Hämtar odlingsjournalen |
| POST | `/api/odlingar` | `{ namn, plats?, planterad?, skordFonster?, anteckning? }` | Lägger till en odling |
| POST | `/api/odlingar/ta-bort` | `{ id }` | Tar bort en odling |
| GET | `/api/enheter/status` | – | Hämtar nuvarande tillstånd för alla bevakade HA-entiteter |
| POST | `/api/enheter` | `{ entityId, namn? }` | Lägger till en bevakad HA-entitet |
| POST | `/api/enheter/ta-bort` | `{ id }` | Tar bort en bevakad enhet |

## Framtida utbyggnad

Automatisk vattenhantering är inte byggt än (kräver kända ventil-/pump-
entiteter, som ni inte har förrän ni har eget hus) men "Enheter"-listan är
redo att bli grunden för det: lägg till jordfuktighetssensorer där först,
och när ni vet exakt vilken integration/entitet er bevattningsventil blir
(t.ex. en `switch`- eller `valve`-entitet) hör av er, så bygger vi
automatiseringslogik (t.ex. "vattna om jordfuktighet under X% och ingen
nederbörd väntas") ovanpå samma data.
