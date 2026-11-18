# Inspreken

Code staat in `src/voice/`. Server: `functions/src/transcribe.ts`. Open de sheet met de knop "Inspreken" (zijbalk, dock) of de toets `M`.

## Aanpak per apparaat

| Apparaat | Manier | Waarom |
|---|---|---|
| Chrome / Edge (laptop, Android) | **Live dicteren** met de Web Speech API (`nl-NL`, tussentijdse tekst) | Snel, gratis, werkt zonder eigen server. |
| iPhone en iPad (Safari én app op het beginscherm) | **Opnemen** met `MediaRecorder`, na stoppen naar `POST /transcribe` | Web Speech is hier onbetrouwbaar (zie onder). |
| Safari op de Mac | Opnemen + server (als die er is), anders live | Web Speech bestaat er wel, maar hangt af van Siri/dicteren in macOS. |
| Geen van beide mogelijk (geen server, geen Web Speech) | Alleen typen in de sheet | De sheet blijft bruikbaar; dezelfde splitsing en herkenning. |

De keuze zit in `pickMode()` (`capabilities.ts`, met tests). Zonder `VITE_API_URL` is er geen server: dan proberen we op iPhone alleen live buiten de beginscherm-app, en anders alleen typen.

### Wat de bronnen zeggen (gecontroleerd 2026-11-18)

- **Web Speech op iPhone.** Een WebKit-medewerker schreef dat SpeechRecognition niet beschikbaar is in SafariViewController en in web-apps op het beginscherm ([WebKit bug 225298](https://bugs.webkit.org/show_bug.cgi?id=225298)). Op Apples forum meldt een ontwikkelaar dat de knop in Safari werkt maar na toevoegen aan het beginscherm niet meer ([forum](https://developer.apple.com/forums/thread/748048)). Een andere bron beweert het tegendeel ([whatpwacando.today](https://whatpwacando.today/speech-recognition)), zonder datum of versie. De API kan bovendien wel bestaan maar niets doen, dus aanwezigheid detecteren is geen bewijs. Conclusie: niet op vertrouwen. **Dit heb ik niet op een echte iPhone kunnen testen.**
- **MediaRecorder in Safari.** Beschikbaar sinds Safari 14.1 ([WebKit-blog](https://webkit.org/blog/11353/mediarecorder-api/)). Safari neemt `audio/mp4` (AAC) op; WebM met Opus kwam pas met Safari 18.4 ([addpipe](https://blog.addpipe.com/record-high-quality-audio-in-safari-with-alac-and-pcm-support-via-mediarecorder/), een externe bron). Daarom kiest `pickRecorderMime()` op Apple eerst `audio/mp4`, elders `audio/webm;codecs=opus`.
- Microfoon in een PWA op het beginscherm: `getUserMedia` werkt daar in iOS, maar de toestemming wordt per app gevraagd. Ook dit alleen op een echt toestel te bevestigen.

## Wat de hook doet (`useVoice`)

- Statusmachine (`voiceMachine.ts`): rust, microfoon vragen, luisteren, afronden, uitschrijven, klaar, fout. Fouten: geen toestemming, geen microfoon, geen verbinding, stilte, niet ondersteund, mislukt.
- De oude bug (verouderde tekst in `onEnd`) is structureel opgelost: de herkenner, recorder, stream en timers staan in refs; de tekst staat in de reducer en wordt bij het einde daar samengevoegd, dus geen closure die een oude waarde leest. Een sessienummer zorgt dat late events van een afgebroken sessie genegeerd worden.
- Een opname die niet uitgeschreven kon worden (geen verbinding) blijft bewaard; "Opnieuw proberen" verstuurt hem opnieuw.
- Opnames korter dan 0,7 seconde gelden als stilte; na 2 minuten stopt de opname vanzelf.

## Taken herkennen (`capture.ts`)

1. Server: `POST /capture` met `{ text, dryRun: true, source: { type: "voice" } }` (AI splitst en herkent, slaat niets op).
2. Geen server, offline, time-out (12 s) of fout: lokaal. `splitSpeech()` splitst (komma, punt, "daarnaast", "en" alleen als er een datumwoord of minstens drie woorden volgen, zodat "mail Wehkamp en Keesing" één taak blijft), daarna `parseQuickAdd` per stuk.
3. De gebruiker past het lijstje aan (titel, klant, datum, nu/niet vergeten, weghalen) en tikt "Toevoegen": `store.addTodo({ ..., source: { type: "voice" } })`.

## Transcriptiedienst: ElevenLabs Scribe

- **Gekozen: ElevenLabs Scribe** (`scribe_v2`, `language_code: nl`), aangeroepen met gewone `fetch`; geen nieuw pakket.
- Reden 1, formaat: Google Cloud Speech-to-Text ondersteunt geen MP4/AAC ([formatenlijst](https://docs.cloud.google.com/speech-to-text/docs/encoding)), en dat is precies wat Safari opneemt. Dan moet de server eerst omzetten (ffmpeg). Scribe neemt alle gangbare audioformaten aan ([API](https://elevenlabs.io/docs/api-reference/speech-to-text/convert)).
- Reden 2, eenvoud en kosten: er is al een sleutel; $0,20 per uur audio ([prijzen](https://elevenlabs.io/pricing/api)), voor een persoonlijk gebruik verwaarloosbaar.
- Nadeel: Google zit in hetzelfde project en vraagt geen sleutel; Scribe wel. Kwaliteit voor Nederlands niet zelf vergeleken, dus beoordeel dat bij gebruik.
- **Nodig:** secret `ELEVENLABS_API_KEY` koppelen aan de functie (`firebase functions:secrets:set ELEVENLABS_API_KEY` en `secrets: [...]` bij de route). Geen dependency.

## Route `POST /transcribe` (voor de bouwer van de server)

Body = ruwe audio, `Content-Type` = mime-type van de opname (`audio/mp4` of `audio/webm`), `Authorization: Bearer <ID-token>`. Roep `transcribeAudio(buffer, mimeType)` aan en antwoord `{ "text": "..." }`. Zorg dat de body-parser ruwe audio doorlaat (bij Express: `express.raw({ type: 'audio/*', limit: '10mb' })`) en dat het secret beschikbaar is.

## Alleen op een echt toestel te controleren

Gedrag van Web Speech en de microfoontoestemming op iPhone (Safari-tab én beginscherm), echte opnames van Safari door Scribe, kwaliteit van het Nederlands, en de sneltoets `M` naast een schermlezer.
