import { describe, expect, it } from 'vitest'
import { initialVoiceState, voiceReducer, type VoiceEvent, type VoiceState } from './voiceMachine'
import { pickMode, pickRecorderMime, type VoiceEnv } from './capabilities'

const run = (events: VoiceEvent[], from: VoiceState = initialVoiceState) => events.reduce(voiceReducer, from)

describe('voiceReducer: live', () => {
  it('doorloopt idle → listening → done met de laatste tekst', () => {
    const s = run([
      { type: 'START', mode: 'live' },
      { type: 'STARTED' },
      { type: 'RESULT', final: 'bel Jan', interim: 'en morgen' },
      { type: 'STOP' },
    ])
    expect(s.status).toBe('finishing')
    // laatste resultaten komen na stop nog binnen
    const done = run([{ type: 'RESULT', final: 'bel Jan en morgen deck', interim: '' }, { type: 'END' }], s)
    expect(done).toMatchObject({ status: 'done', text: 'bel Jan en morgen deck', interim: '' })
  })

  it('voegt voorlopige tekst toe als de herkenner stopt (de oude closure-bug)', () => {
    const s = run([
      { type: 'START', mode: 'live' },
      { type: 'STARTED' },
      { type: 'RESULT', final: 'deck maken', interim: 'voor Wehkamp' },
      { type: 'END' },
    ])
    expect(s).toMatchObject({ status: 'done', text: 'deck maken voor Wehkamp' })
  })

  it('geeft "silence" als er niets gezegd is', () => {
    const s = run([{ type: 'START', mode: 'live' }, { type: 'STARTED' }, { type: 'END' }])
    expect(s).toMatchObject({ status: 'error', error: 'silence' })
  })

  it('negeert END nadat er al een fout was', () => {
    const s = run([{ type: 'START', mode: 'live' }, { type: 'STARTED' }, { type: 'FAIL', kind: 'denied' }, { type: 'END' }])
    expect(s).toMatchObject({ status: 'error', error: 'denied' })
  })

  it('bewaart gehoorde tekst bij een fout halverwege', () => {
    const s = run([
      { type: 'START', mode: 'live' },
      { type: 'STARTED' },
      { type: 'RESULT', final: 'mail Keesing', interim: '' },
      { type: 'FAIL', kind: 'offline' },
    ])
    expect(s).toMatchObject({ status: 'error', error: 'offline', text: 'mail Keesing' })
  })
})

describe('voiceReducer: opnemen', () => {
  it('gaat na stop naar uitschrijven en dan naar klaar', () => {
    const s = run([{ type: 'START', mode: 'record' }, { type: 'STARTED' }, { type: 'STOP' }])
    expect(s.status).toBe('transcribing')
    expect(run([{ type: 'TRANSCRIBED', text: ' deck afmaken ' }], s)).toMatchObject({ status: 'done', text: 'deck afmaken' })
  })

  it('een lege uitschrijving is stilte', () => {
    const s = run([{ type: 'START', mode: 'record' }, { type: 'STARTED' }, { type: 'STOP' }, { type: 'TRANSCRIBED', text: '  ' }])
    expect(s).toMatchObject({ status: 'error', error: 'silence' })
  })

  it('geen verbinding tijdens uitschrijven is een fout', () => {
    const s = run([{ type: 'START', mode: 'record' }, { type: 'STARTED' }, { type: 'STOP' }, { type: 'FAIL', kind: 'offline' }])
    expect(s).toMatchObject({ status: 'error', error: 'offline' })
  })

  it('stoppen voor de microfoon klaar is, breekt af', () => {
    const s = run([{ type: 'START', mode: 'record' }, { type: 'STOP' }])
    expect(s.status).toBe('idle')
  })
})

describe('voiceReducer: overig', () => {
  it('start niet dubbel', () => {
    const s = run([{ type: 'START', mode: 'live' }, { type: 'START', mode: 'live' }])
    expect(s.status).toBe('requesting')
  })
  it('zonder ondersteuning meteen een fout', () => {
    expect(run([{ type: 'START', mode: 'none' }])).toMatchObject({ status: 'error', error: 'unsupported' })
  })
  it('typen na een fout haalt de fout weg', () => {
    const s = run([{ type: 'START', mode: 'none' }, { type: 'SET_TEXT', text: 'bel Jan' }])
    expect(s).toMatchObject({ status: 'idle', error: null, text: 'bel Jan' })
  })
  it('opnieuw starten kan na klaar of fout', () => {
    const s = run([{ type: 'START', mode: 'live' }, { type: 'STARTED' }, { type: 'FAIL', kind: 'silence' }, { type: 'START', mode: 'live' }])
    expect(s).toMatchObject({ status: 'requesting', text: '', error: null })
  })
})

const env = (o: Partial<VoiceEnv>): VoiceEnv => ({
  hasSpeechRecognition: true,
  hasRecorder: true,
  isIOS: false,
  isSafariDesktop: false,
  isStandalone: false,
  hasServer: true,
  ...o,
})

describe('pickMode', () => {
  it('Chrome: live', () => expect(pickMode(env({}))).toBe('live'))
  it('iPhone met server: opnemen, ook in de app op het beginscherm', () => {
    expect(pickMode(env({ isIOS: true }))).toBe('record')
    expect(pickMode(env({ isIOS: true, isStandalone: true }))).toBe('record')
  })
  it('iPhone zonder server: live alleen buiten de beginscherm-app', () => {
    expect(pickMode(env({ isIOS: true, hasServer: false }))).toBe('live')
    expect(pickMode(env({ isIOS: true, hasServer: false, isStandalone: true }))).toBe('none')
  })
  it('Safari op de Mac met server: opnemen', () => expect(pickMode(env({ isSafariDesktop: true }))).toBe('record'))
  it('Firefox zonder Web Speech maar met server: opnemen', () => {
    expect(pickMode(env({ hasSpeechRecognition: false }))).toBe('record')
    expect(pickMode(env({ hasSpeechRecognition: false, hasServer: false }))).toBe('none')
  })
})

describe('pickRecorderMime', () => {
  it('kiest mp4 op Apple, webm elders', () => {
    const all = () => true
    expect(pickRecorderMime(all, true)).toBe('audio/mp4')
    expect(pickRecorderMime(all, false)).toBe('audio/webm;codecs=opus')
    expect(pickRecorderMime((t) => t === 'audio/mp4', false)).toBe('audio/mp4')
    expect(pickRecorderMime(() => false, false)).toBeUndefined()
  })
})
