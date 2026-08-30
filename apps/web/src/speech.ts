import { useCallback, useEffect, useRef, useState } from 'react'

interface SpeechAlternativeLike { transcript: string }
interface SpeechResultLike { 0: SpeechAlternativeLike; isFinal: boolean }
interface SpeechEventLike { resultIndex: number; results: { length: number; [index: number]: SpeechResultLike } }
export type SpeechErrorCode = 'not-allowed' | 'network' | 'unknown'

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((event: SpeechEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

export function speechSupported(): boolean {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition)
}

// Dictation hook over the browser's Web Speech API. Chrome ends the session on
// silence, so while the user keeps the mic on we restart it; a real error
// (permission, network) stops the loop and surfaces a code for the UI.
export function useSpeechRecognition(onText: (chunk: string, finalText: string) => void) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<SpeechErrorCode | null>(null)
  const onTextRef = useRef(onText)
  onTextRef.current = onText
  const listeningRef = useRef(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const finalRef = useRef('')

  const start = useCallback(() => {
    const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Ctor) return
    finalRef.current = ''
    const recognition = new Ctor()
    recognition.lang = 'zh-CN'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (event) => {
      let chunk = ''
      let finalChunk = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (result.isFinal) finalChunk += result[0].transcript
        else chunk += result[0].transcript
      }
      if (finalChunk) finalRef.current += finalChunk
      onTextRef.current(chunk, finalRef.current)
    }
    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return
      listeningRef.current = false
      setListening(false)
      setError(event.error === 'not-allowed' ? 'not-allowed' : event.error === 'network' ? 'network' : 'unknown')
    }
    recognition.onend = () => {
      if (listeningRef.current) {
        try { recognition.start(); return } catch { /* session is over */ }
      }
      setListening(false)
    }
    recognitionRef.current = recognition
    listeningRef.current = true
    setError(null)
    setListening(true)
    try { recognition.start() } catch { listeningRef.current = false; setListening(false) }
  }, [])

  const stop = useCallback(() => {
    listeningRef.current = false
    recognitionRef.current?.stop()
    setListening(false)
  }, [])

  useEffect(() => () => {
    listeningRef.current = false
    recognitionRef.current?.stop()
  }, [])

  return { listening, error, start, stop, clearError: () => setError(null) }
}
