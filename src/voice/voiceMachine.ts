// De statusmachine van het inspreken, los van de browser zodat hij te testen is.

import type { VoiceMode } from './capabilities'

export type VoiceStatus =
  | 'idle'
  | 'requesting' // toestemming/microfoon wordt gevraagd
  | 'listening'
  | 'finishing' // live: gestopt, laatste woorden komen nog binnen
  | 'transcribing' // opname: wordt uitgeschreven door de server
  | 'done'
  | 'error'

export type VoiceErrorKind = 'denied' | 'no-mic' | 'offline' | 'silence' | 'unsupported' | 'failed'

export interface VoiceState {
  status: VoiceStatus
  mode: VoiceMode
  /** Definitieve tekst. */
  text: string
  /** Voorlopige tekst die nog kan veranderen (alleen live). */
  interim: string
  error: VoiceErrorKind | null
}

export type VoiceEvent =
  | { type: 'START'; mode: VoiceMode }
  | { type: 'STARTED' }
  | { type: 'RESULT'; final: string; interim: string }
  | { type: 'STOP' }
  | { type: 'END' } // live: herkenner is klaar
  | { type: 'TRANSCRIBED'; text: string }
  | { type: 'FAIL'; kind: VoiceErrorKind }
  | { type: 'SET_TEXT'; text: string }
  | { type: 'RESET' }

export const initialVoiceState: VoiceState = { status: 'idle', mode: 'none', text: '', interim: '', error: null }

const blank = (s: string) => s.trim().length === 0
const join = (a: string, b: string) => [a.trim(), b.trim()].filter(Boolean).join(' ')

export function voiceReducer(state: VoiceState, event: VoiceEvent): VoiceState {
  switch (event.type) {
    case 'START':
      if (state.status !== 'idle' && state.status !== 'done' && state.status !== 'error') return state
      if (event.mode === 'none') return { ...initialVoiceState, status: 'error', error: 'unsupported' }
      return { status: 'requesting', mode: event.mode, text: '', interim: '', error: null }

    case 'STARTED':
      return state.status === 'requesting' ? { ...state, status: 'listening' } : state

    case 'RESULT':
      if (state.status !== 'listening' && state.status !== 'finishing') return state
      return { ...state, text: event.final, interim: event.interim }

    case 'STOP':
      if (state.status === 'requesting') return { ...initialVoiceState }
      if (state.status !== 'listening') return state
      return { ...state, status: state.mode === 'record' ? 'transcribing' : 'finishing' }

    case 'END': {
      if (state.mode !== 'live' || (state.status !== 'listening' && state.status !== 'finishing')) return state
      const text = join(state.text, state.interim)
      return blank(text)
        ? { ...state, status: 'error', text: '', interim: '', error: 'silence' }
        : { ...state, status: 'done', text, interim: '', error: null }
    }

    case 'TRANSCRIBED':
      if (state.status !== 'transcribing') return state
      return blank(event.text)
        ? { ...state, status: 'error', text: '', error: 'silence' }
        : { ...state, status: 'done', text: event.text.trim(), error: null }

    case 'FAIL':
      if (state.status === 'idle') return state
      // wat al gehoord is blijft staan, zodat niets verloren gaat
      return { ...state, status: 'error', interim: '', text: join(state.text, state.interim), error: event.kind }

    case 'SET_TEXT':
      return {
        ...state,
        text: event.text,
        interim: '',
        // typen na een fout of in rust: de fout is dan niet meer relevant
        status: state.status === 'error' ? 'idle' : state.status,
        error: state.status === 'error' ? null : state.error,
      }

    case 'RESET':
      return { ...initialVoiceState, mode: state.mode }
  }
}

/** Is de microfoon nu in gebruik of wordt er gewerkt aan het resultaat? */
export const isBusy = (s: VoiceStatus) => s === 'requesting' || s === 'listening' || s === 'finishing' || s === 'transcribing'
