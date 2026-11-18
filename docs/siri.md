# Siri-opdracht "Nieuwe todo"

Je zegt "Hé Siri, nieuwe todo", daarna dicteer je je taak(ken), en ze staan in de app. Dit gebruikt de Opdrachten-app (Shortcuts) die al op je iPhone en Mac staat.

> Eerlijk vooraf: de namen van de acties heb ik gecontroleerd in Apples handleiding waar die ze noemt (**Get Contents of URL**, de keuzes **GET/POST** en **Request Body**). De actie **Dictate Text** en de Nederlandse namen van de acties kon ik niet in Apples handleiding terugvinden; die staan hieronder uit mijn hoofd en ze kunnen in jouw iOS-versie net anders heten. Zoek in de actielijst gewoon op het Engelse woord. Het stuk over de Mac is helemaal niet geverifieerd.

## Wat je vooraf nodig hebt

1. **Het adres van de server.** Dat is het adres waar `POST /capture` draait, bijvoorbeeld `https://…/capture`. Vraag het aan wie de server heeft uitgerold, of kijk in `docs/koppelingen.md`.
2. **Een persoonlijk token.** In de app: Instellingen, dan Koppelingen, dan een nieuw token maken (geef het de naam "Siri"). Kopieer het meteen; je ziet het maar één keer. Beschouw het als een wachtwoord: deel het niet en zet het niet in een screenshot.

## Op de iPhone

1. Open de app **Opdrachten** (Shortcuts).
2. Tik rechtsboven op **+** (nieuwe opdracht). Tik bovenaan op de naam en noem hem **Nieuwe todo**. Dat is ook wat je tegen Siri zegt.
3. Tik op **Voeg actie toe** en zoek **Dictate Text** (Nederlands waarschijnlijk "Dicteer tekst"). Voeg toe. Tik op de taal in de actie en kies **Nederlands**. Zet "Stop met luisteren" op **Na pauze**.
4. Voeg een tweede actie toe: **Get Contents of URL** (Nederlands waarschijnlijk "Haal inhoud van URL op").
5. In die actie: vul bij **URL** het serveradres in (eindigend op `/capture`). Tik op **Toon meer** (Show More).
6. Zet **Methode** op **POST**.
7. Tik op **Voeg nieuw veld toe** bij **Headers** (die optie staat niet in Apples handleiding; zoek hem in de actie):
   - Sleutel `Authorization`, waarde `Bearer ` (met een spatie erachter) direct gevolgd door je token.
   - Voeg nog een header toe: sleutel `Content-Type`, waarde `application/json`.
8. Zet **Aanvraagtekst** (Request Body) op **JSON**. Voeg één veld toe:
   - Type Tekst, sleutel `text`, waarde: tik in het veld en kies bovenin de **variabele** "Gedicteerde tekst" (Dictated Text) uit de vorige actie.
9. Tik op de afspeelknop onderaan en zeg een taak. Open daarna de app: staat de taak erin, dan werkt het.
10. Klaar. Zeg "Hé Siri, nieuwe todo". Siri vraagt wat je wilt zeggen; je dicteert, en de taak wordt toegevoegd. Meerdere taken in één zin ("bel Keesing en morgen het deck voor Wehkamp afmaken") worden door de server gesplitst.

Tips: voeg als laatste actie **Show Notification** ("Toon melding") toe met de tekst "Todo toegevoegd", zodat je weet dat het gelukt is. Wil je een knop op je beginscherm of in de Actieknop: tik op de **i** onderaan de opdracht en kies "Zet op beginscherm", of koppel hem aan de Actieknop in Instellingen.

## Op de Mac

De Opdrachten-app bestaat ook op de Mac en synchroniseert via iCloud. Staat de iPhone-opdracht al in je iCloud, dan staat hij er waarschijnlijk al; ga dan naar stap 3.

1. Open **Opdrachten** op de Mac en kijk of "Nieuwe todo" er staat. Zo niet: maak hem op dezelfde manier als hierboven (de acties heten hetzelfde).
2. Zeg "Hé Siri, nieuwe todo" (als Siri op je Mac aan staat), of start hem uit het menu van de Opdrachten-app in de menubalk.
3. Een eigen toetscombinatie koppelen kan in de opdracht via het infopaneel (zoek naar "Voeg sneltoets toe"); die optie kon ik niet verifiëren.

## Als het niet werkt

- **"Not authorized" of 401:** het token klopt niet. Controleer dat er `Bearer ` (met spatie) voor staat en geen extra regeleinde.
- **Niets in de app:** open de opdracht, tik op afspelen en kijk bij de actie "Haal inhoud van URL op" naar het antwoord (tik op het resultaat). Daar staat de foutmelding.
- **Geen internet:** de opdracht kan dan niets sturen. Typ de taak dan in de app zelf.
- Token kwijt of gelekt: maak in de app een nieuw token en haal het oude weg.
