import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { detectEnv, pickMode, pickRecorderMime, type VoiceMode } from './capabilities'
import { initialVoiceState, voiceReducer, type VoiceErrorKind, type VoiceState } from './voiceMachine'
import { transcribe, TranscribeError } from './transcribeClient'

// Minimale typen voor de Web Speech API (zit niet in alle TypeScript-versies).
interface RecognitionResult {
  isFinal: boolean
  0: { transcript: string }
}
interface RecognitionEvent {
  results: ArrayLike<RecognitionResult>
}
interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onstart: (() => void) | null
  onresult: ((e: RecognitionEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

const MAX_RECORD_MS = 120_000
const MIN_RECORD_MS = 700
const FINISH_TIMEOUT_MS = 3000

export interface UseVoice {
  state: VoiceState
  mode: VoiceMode
  start(): void
  stop(): void
  /** Alles afbreken en terug naar rust (sluit de microfoon). */
  cancel(): void
  /** Na een fout: de bewaarde opname opnieuw versturen, of anders gewoon opnieuw beginnen. */
  retry(): void
  setText(text: string): void
}

export function useVoice({ lang = 'nl-NL' }: { lang?: string } = {}): UseVoice {
  const [state, dispatch] = useReducer(voiceReducer, initialVoiceState)
  const env = useMemo(() => detectEnv(), [])
  const mode = useMemo(() => pickMode(env), [env])

  // Alles wat tijdens het praten verandert staat in refs, niet in state of closures:
  // zo leest een callback nooit een verouderde waarde (de bug van de oude hook).
  const session = useRef(0)
  const recognition = useRef<Recognition | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const startedAt = useRef(0)
  const lastBlob = useRef<Blob | null>(null)
  const timers = useRef<number[]>([])
  const abort = useRef<AbortController | null>(null)

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
  }

  const releaseStream = () => {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
  }

  const teardown = useCallback(() => {
    clearTimers()
    abort.current?.abort()
    abort.current = null
    const rec = recognition.current
    recognition.current = null
    if (rec) {
      rec.onstart = rec.onresult = rec.onerror = rec.onend = null
      try {
        rec.abort()
      } catch {
        /* al gestopt */
      }
    }
    const mr = recorder.current
    recorder.current = null
    if (mr) {
      mr.ondataavailable = mr.onstop = mr.onerror = null
      if (mr.state !== 'inactive') {
        try {
          mr.stop()
        } catch {
          /* al gestopt */
        }
      }
    }
    releaseStream()
  }, [])

  const fail = useCallback((id: number, kind: VoiceErrorKind) => {
    if (id !== session.current) return
    clearTimers()
    releaseStream()
    dispatch({ type: 'FAIL', kind })
  }, [])

  const runTranscribe = useCallback(
    async (id: number, blob: Blob) => {
      abort.current = new AbortController()
      try {
        const text = await transcribe(blob, abort.current.signal)
        if (id !== session.current) return
            lastBlob.current = null
        dispatch({ type: 'TRANSCRIBED', text })
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        fail(id, e instanceof TranscribeError ? e.kind : 'failed')
      }
    },
    [fail],
  )

  const startLive = useCallback(
    (id: number) => {
      const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
      const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
      if (!Ctor) return fail(id, 'unsupported')
      const rec = new Ctor()
      rec.lang = lang
      rec.continuous = true
      rec.interimResults = true
      rec.onstart = () => id === session.current && dispatch({ type: 'STARTED' })
      rec.onresult = (e) => {
        if (id !== session.current) return
        let final = ''
        let interim = ''
        for (let i = 0; i < e.results.length; i++) {
          const r = e.results[i]
          if (r.isFinal) final += r[0].transcript
          else interim += r[0].transcript
        }
        dispatch({ type: 'RESULT', final: final.trim(), interim: interim.trim() })
      }
      rec.onerror = (e) => {
        if (id !== session.current) return
        switch (e.error) {
          case 'aborted':
            return
          case 'no-speech':
            return fail(id, 'silence')
          case 'not-allowed':
          case 'service-not-allowed':
            return fail(id, 'denied')
          case 'audio-capture':
            return fail(id, 'no-mic')
          case 'network':
            return fail(id, 'offline')
          default:
            return fail(id, 'failed')
        }
      }
      rec.onend = () => {
        if (id !== session.current) return
        clearTimers()
        recognition.current = null
        dispatch({ type: 'END' })
      }
      recognition.current = rec
      try {
        rec.start()
      } catch {
        fail(id, 'failed')
      }
    },
    [lang, fail],
  )

  const startRecord = useCallback(
    async (id: number) => {
      let media: MediaStream
      try {
        media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      } catch (e) {
        const name = (e as DOMException).name
        return fail(id, name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'no-mic')
      }
      if (id !== session.current) {
        media.getTracks().forEach((t) => t.stop())
        return
      }
      stream.current = media
      const mimeType = pickRecorderMime((t) => MediaRecorder.isTypeSupported(t), env.isIOS || env.isSafariDesktop)
      let mr: MediaRecorder
      try {
        mr = new MediaRecorder(media, mimeType ? { mimeType } : undefined)
      } catch {
        return fail(id, 'failed')
      }
      chunks.current = []
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data)
      }
      mr.onerror = () => fail(id, 'failed')
      mr.onstop = () => {
        if (id !== session.current) return
        clearTimers()
        releaseStream()
        recorder.current = null
        const duration = Date.now() - startedAt.current
        const base = (mr.mimeType || mimeType || 'audio/mp4').split(';')[0]
        const blob = new Blob(chunks.current, { type: base })
        if (duration < MIN_RECORD_MS || blob.size < 1500) return fail(id, 'silence')
        lastBlob.current = blob
        void runTranscribe(id, blob)
      }
      recorder.current = mr
      startedAt.current = Date.now()
      mr.start()
      dispatch({ type: 'STARTED' })
      // automatisch stoppen zodat een vergeten opname niet eindeloos doorloopt
      timers.current.push(
        window.setTimeout(() => {
          if (id === session.current && mr.state === 'recording') {
            dispatch({ type: 'STOP' })
            mr.stop()
          }
        }, MAX_RECORD_MS),
      )
    },
    [env, fail, runTranscribe],
  )

  const start = useCallback(() => {
    teardown()
    const id = ++session.current
    lastBlob.current = null
    dispatch({ type: 'START', mode })
    if (mode === 'live') startLive(id)
    else if (mode === 'record') void startRecord(id)
  }, [mode, startLive, startRecord, teardown])

  const stop = useCallback(() => {
    const id = session.current
    if (recognition.current) {
      dispatch({ type: 'STOP' })
      recognition.current.stop()
      // veiligheidsklep: komt het einde niet, sluit dan toch af
      timers.current.push(window.setTimeout(() => id === session.current && dispatch({ type: 'END' }), FINISH_TIMEOUT_MS))
    } else if (recorder.current && recorder.current.state === 'recording') {
      dispatch({ type: 'STOP' })
      recorder.current.stop()
    } else {
      // microfoon nog niet open: afbreken
      session.current++
      teardown()
      dispatch({ type: 'STOP' })
    }
  }, [teardown])

  const cancel = useCallback(() => {
    session.current++
    teardown()
    lastBlob.current = null
    dispatch({ type: 'RESET' })
  }, [teardown])

  const retry = useCallback(() => {
    const blob = lastBlob.current
    if (!blob) return start()
    const id = ++session.current
    dispatch({ type: 'START', mode: 'record' })
    dispatch({ type: 'STARTED' })
    dispatch({ type: 'STOP' })
    void runTranscribe(id, blob)
  }, [runTranscribe, start])

  const setText = useCallback((text: string) => dispatch({ type: 'SET_TEXT', text }), [])

  // bij sluiten van het scherm de microfoon altijd loslaten
  useEffect(
    () => () => {
      session.current++
      teardown()
    },
    [teardown],
  )

  return { state, mode, start, stop, cancel, retry, setText }
}
