// Welke manier van inspreken past bij dit apparaat? Zie docs/voice.md voor de onderbouwing.

export type VoiceMode =
  /** Live dicteren met de Web Speech API van de browser. */
  | 'live'
  /** Opnemen met MediaRecorder en na stoppen laten uitschrijven door de server. */
  | 'record'
  /** Niets werkt: alleen typen. */
  | 'none'

export interface VoiceEnv {
  hasSpeechRecognition: boolean
  hasRecorder: boolean
  /** iPhone of iPad (ook iPadOS dat zich als Mac voordoet). */
  isIOS: boolean
  /** Safari op de Mac (niet Chrome, Edge of Firefox). */
  isSafariDesktop: boolean
  /** Draait als app op het beginscherm. */
  isStandalone: boolean
  /** Er is een server ingesteld (VITE_API_URL). */
  hasServer: boolean
}

/**
 * - iPhone/iPad: Web Speech is onbetrouwbaar (in een app op het beginscherm niet beschikbaar),
 *   dus opnemen + server. Zonder server proberen we live alleen buiten de beginscherm-app.
 * - Safari op de Mac: Web Speech bestaat maar hangt af van Siri/dicteren; opnemen + server is betrouwbaarder.
 * - Chrome/Edge: live, het snelst en gratis.
 */
export function pickMode(env: VoiceEnv): VoiceMode {
  const canRecord = env.hasRecorder && env.hasServer
  if (env.isIOS) {
    if (canRecord) return 'record'
    return env.hasSpeechRecognition && !env.isStandalone ? 'live' : 'none'
  }
  if (env.isSafariDesktop) {
    if (canRecord) return 'record'
    return env.hasSpeechRecognition ? 'live' : 'none'
  }
  if (env.hasSpeechRecognition) return 'live'
  return canRecord ? 'record' : 'none'
}

export function detectEnv(): VoiceEnv {
  const w = window as unknown as Record<string, unknown>
  const nav = navigator
  const ua = nav.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
  const isSafariDesktop = !isIOS && /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(ua)
  const standaloneNav = (nav as unknown as { standalone?: boolean }).standalone === true
  return {
    hasSpeechRecognition: Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition),
    hasRecorder: typeof MediaRecorder !== 'undefined' && Boolean(nav.mediaDevices?.getUserMedia),
    isIOS,
    isSafariDesktop,
    isStandalone: standaloneNav || window.matchMedia?.('(display-mode: standalone)').matches === true,
    hasServer: Boolean(apiBase()),
  }
}

export function apiBase(): string {
  const url = (import.meta.env.VITE_API_URL as string | undefined)?.trim() ?? ''
  return url.replace(/\/+$/, '')
}

/** Eerste formaat dat de browser kan opnemen. Safari neemt audio/mp4 op; nieuwere versies ook webm/opus. */
export function pickRecorderMime(isTypeSupported: (t: string) => boolean, preferMp4: boolean): string | undefined {
  const webm = ['audio/webm;codecs=opus', 'audio/webm']
  const mp4 = ['audio/mp4', 'audio/aac']
  const candidates = preferMp4 ? [...mp4, ...webm, 'audio/ogg;codecs=opus'] : [...webm, 'audio/ogg;codecs=opus', ...mp4]
  return candidates.find((t) => isTypeSupported(t))
}
