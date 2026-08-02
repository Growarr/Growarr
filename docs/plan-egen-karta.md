# Plan: egen karta (bakgrundsbild + egna objekt)

Status: **planerad, inte byggd.** Det här dokumentet är underlaget vi kom
överens om innan bygget, så vi vet vad vi bestämt och varför.

## Målet

Kunna bygga upp sin faktiska tomt i appen: lägga en flygbild (t.ex. en
skärmdump från Google Maps) som bakgrund, placera ut hus, altan, träd,
stenpartier och staket, och sedan placera odlingszonerna i det. Plus kunna
stänga av det befintliga rutnätet i både karta- och kompaktvyn.

Det uttalade kravet är att det ska se **proffsigt ut, inte klottrigt**. Det
kravet är faktiskt det som styr hela designen nedan.

## Den viktigaste designregeln: ingen frihandsritning

Det naturliga första förslaget vore "lägg till en pensel så man kan rita
träd och rabatter". **Det är precis det vi inte ska göra.** Frihandsritning
med mus eller finger blir alltid ojämnt, och resultatet ser hemmagjort ut
oavsett hur bra verktyget är. Det är också tråkigt att använda, eftersom
man känner att man borde kunna rita bättre än man gör.

I stället: ett **kurerat bibliotek av färdiga objekt** som man drar ut och
skalar. Varje objekt är ritat i samma uppifrån-stil som de befintliga
zonerna redan har (växthusets glasparti, odlingslådans träram, jordens
textur). Då blir resultatet snyggt av sig självt, för det är formgivet i
förväg, och man kan inte råka göra något fult.

Kompromissen: man kan inte rita exakt sin egen konstiga form. Den
kompromissen är värd det, och en bakgrundsbild täcker ändå upp för det som
inte finns i biblioteket.

## Delarna

### 1. Bakgrundsläge per karta (litet, gör först)

Varje kartflik får ett läge:

- `rutnat` – dagens utseende (rutnät + mjuk grön glöd). Standard.
- `ren` – enfärgad yta, inget rutnät. Det som efterfrågades.
- `foto` – uppladdad flygbild.

Gäller **både** vanlig karta och kompaktvy, så en avskalad planritning kan
se lika ren ut som referensbilderna.

Datamodell: `karta.bakgrund`.

### 2. Flygbild som bakgrund

Ladda upp en bild per karta (skärmdump från Google Maps eller ett foto).

**Lagring – viktigt vägval.** Bilden får *inte* ligga som base64 i
`tradgard.json`. Den filen läses om vid varje API-anrop, och en enda
megabyte-bild skulle göra hela appen märkbart trögare. I stället:

- Bilden skalas ner i webbläsaren före uppladdning (samma mönster som
  AI-chattens foton redan använder).
- Sparas som egen fil, `/data/kartor/<kartaId>.jpg`.
- Serveras via `GET /api/karta-bild?kartaId=…`.
- I JSON ligger bara ett filnamn och inställningar.

Plus en **opacitetsreglage** (t.ex. 35–100 %), för en full flygbild i
fullfärg gör plantikonerna svårlästa. Nedtonad bild + tydliga zoner ovanpå
ser dessutom mer "designat" ut än en rå skärmdump.

### 3. Skalkalibrering (det som gör kartan "riktig")

Appen har redan en inställning för kartans bredd i meter, som solkartan
bygger på. Med en flygbild går det att göra mycket bättre:

**Två klick + ett mått.** Klicka på två punkter i bilden som du vet
avståndet mellan (husväggens längd, altanens kortsida), skriv in metrarna.
Klart. Då vet appen exakt hur många meter en pixel är.

Det ger tre saker på köpet:
- Solkartans skuggor blir korrekta i verkligheten, inte bara proportionella.
- Zonernas storlek går att ange i meter i stället för att pixelpetas.
- "≈ 6,5 timmar sol" blir en siffra man faktiskt kan lita på.

Google Maps har en skalstock i hörnet som man kan använda som referens om
man inte vet något mått på tomten.

### 4. Objektbiblioteket

Kategorier (första omgången):

| Grupp | Objekt |
|---|---|
| Byggnader | hus, förråd/bod, altan/terrass, balkong |
| Växtlighet | lövträd, barrträd, fruktträd, buske, häck, gräsyta |
| Mark | grusgång, stenplattor, stenparti, damm |
| Övrigt | staket, kompost, vattenkran, utemöbler |

Varje objekt:
- ritas som SVG i samma stil som befintliga zoner,
- kan dras, skalas (hörnhandtag, finns redan för zoner) och **roteras**,
- har en z-ordning så en buske kan ligga framför eller bakom en bänk,
- har en höjd i meter (träd ~4 m, staket ~1,8 m, häck ~1,2 m).

**Snapping.** Den befintliga `zonSnappning()` med ledlinjer återanvänds, så
objekt radar upp sig mot varandra och mot zonerna. Rotation snäpper till
15°-steg om man inte håller in en tangent. Det är den enskilt viktigaste
detaljen för att resultatet inte ska se slarvigt ut: allt hamnar i linje
utan att man behöver pixelpeta.

Objekt är **inte** zoner. De kan inte innehålla plantor, syns inte i "Per
zon" och räknas inte i statistik. De är kontext.

### 5. Träd som kastar skugga (den stora vinsten)

Solkartan räknar idag bara skuggor från zoner (växthus, lådor). I en riktig
trädgård är **trädet grannens sida av tomten den viktigaste skuggkällan**,
inte odlingslådan.

Så fort objekten finns med höjd i meter kan de matas in i den befintliga
skuggberäkningen. Då blir solkartan för första gången realistisk: "den här
bädden ligger i skugga från eken efter klockan tre" är en insikt som
faktiskt påverkar var man planterar.

Det här är enligt mig det starkaste skälet att bygga hela funktionen, mer
än att kartan blir snyggare.

## Ordning att bygga i

Varje steg är användbart i sig, så det går att stanna var som helst.

1. **Bakgrundsläge** (`rutnat` / `ren`) i båda vyerna. Litet, ger direkt
   den renare känslan.
2. **Bilduppladdning** + opacitet. Nu ser man sin egen tomt.
3. **Skalkalibrering.** Kartan blir måttriktig.
4. **Objektbiblioteket** + placering, rotation, snapping. Störst jobb.
5. **Objektens skuggor i solkartan.** Störst funktionell vinst.

## Saker vi bör bestämma innan steg 4

- **Mobil.** Att placera och rotera objekt med fingret på en telefon blir
  fiddligt. Mitt förslag: redigering är skrivbordsläge (som "Redigera
  layout" redan i praktiken är), medan resultatet självklart visas fint på
  mobil. Värt att bekräfta innan vi bygger.
- **Hur många objekt i första omgången.** Hellre 12 välritade än 40 sådär.
  Listan ovan kan kortas.
- **Kartans egen storlek.** Idag är scenen fast 1000×700 enheter. En lång
  smal tomt kanske behöver egna proportioner per karta.

## Vad det här *inte* ska bli

- Ingen frihandspensel (se ovan).
- Ingen fritt roterbar 3D-vy. Uppifrån-perspektivet är det som gör att
  appen går att förstå på en sekund.
- Inget klisterark med dekorationer. Varje objekt ska ha en funktion:
  antingen skuggar det, eller så hjälper det en att hitta rätt på tomten.
