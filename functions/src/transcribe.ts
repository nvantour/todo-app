// Spraak naar tekst voor de route POST /transcribe.
// Gekozen: ElevenLabs Scribe (zie docs/voice.md). Geen extra pakket nodig: alleen fetch.
// De sleutel komt uit het secret ELEVENLABS_API_KEY (nooit in code).

const ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text'
const MODEL = 'scribe_v2'

/** Bestandsnaam met de juiste extensie; Scribe herkent het formaat mede daaraan. */
function extensionFor(mimeType: string): string {
  const base = mimeType.split(';')[0].trim().toLowerCase()
  switch (base) {
    case 'audio/mp4':
    case 'audio/x-m4a':
    case 'audio/m4a':
    case 'audio/aac':
      return 'm4a'
    case 'audio/webm':
      return 'webm'
    case 'audio/ogg':
      return 'ogg'
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3'
    case 'audio/wav':
    case 'audio/x-wav':
    case 'audio/wave':
      return 'wav'
    default:
      return 'webm'
  }
}

export class TranscribeConfigError extends Error {}

/** Schrijft een opname (Nederlands) uit. Geeft lege tekst terug bij stilte. */
export async function transcribeAudio(audio: Buffer, mimeType: string): Promise<string> {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) throw new TranscribeConfigError('ELEVENLABS_API_KEY ontbreekt (secret niet gekoppeld aan de functie)')
  if (audio.length === 0) return ''

  const base = mimeType.split(';')[0].trim() || 'audio/webm'
  const form = new FormData()
  form.append('model_id', MODEL)
  form.append('language_code', 'nl')
  form.append('tag_audio_events', 'false') // geen "(lacht)" of "(muziek)" in de tekst
  form.append('file', new Blob([new Uint8Array(audio)], { type: base }), `opname.${extensionFor(mimeType)}`)

  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'xi-api-key': key }, body: form })
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`Uitschrijven mislukt (${res.status}): ${detail}`)
  }
  const json = (await res.json()) as { text?: unknown }
  return typeof json.text === 'string' ? json.text.trim() : ''
}
