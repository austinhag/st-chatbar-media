import React, { useCallback, useEffect, useRef, useState } from "react"
import type { FrontendRenderer } from "@streamlit/component-v2-lib"
import { createRoot, Root } from "react-dom/client"

import SendIcon from "@mui/icons-material/Send"
import MicIcon from "@mui/icons-material/Mic"
import StopIcon from "@mui/icons-material/Stop"
import AddIcon from "@mui/icons-material/Add"

import cssText from "./chatbar_media.css"

type SubmitPayload = {
  text?: string
  audioFile?: number[]        // raw bytes array
  audioMime?: string
  imageFile?: number[]        // raw bytes array
  imageMime?: string
}

type MediaChatbarData = {
  placeholder?: string
  disabled?: boolean
  responsive?: boolean
}

function asComponent<T>(m: any): T {
  return (m?.default ?? m) as T
}

import * as AddIconMod from "@mui/icons-material/Add"
import * as SendIconMod from "@mui/icons-material/Send"
import * as MicIconMod from "@mui/icons-material/Mic"
import * as StopIconMod from "@mui/icons-material/Stop"

//const AddIcon = asComponent<React.ComponentType>(AddIconMod)
//const SendIcon = asComponent<React.ComponentType>(SendIconMod)
//const MicIcon  = asComponent<React.ComponentType>(MicIconMod)
//const StopIcon = asComponent<React.ComponentType>(StopIconMod)

type ChatbarMediaData = {
  placeholder?: string
  disabled?: boolean
  responsive?: boolean
}

// Stamp the CSS version into the bundle so stale cached style tags are always replaced
const STYLE_VERSION = String(cssText.length)

function ensureStyles(mountEl: HTMLElement | ShadowRoot) {
  const STYLE_ID = "chatbar-media-inline-style"

  // This returns either Document or ShadowRoot
  const root = mountEl.getRootNode() as Document | ShadowRoot

  const existing =
    root instanceof ShadowRoot
      ? root.getElementById?.(STYLE_ID) ?? root.querySelector(`#${STYLE_ID}`)
      : (document.getElementById(STYLE_ID) as HTMLElement | null)

  // Replace if found but stale (different build)
  if (existing) {
    if (existing.getAttribute("data-v") === STYLE_VERSION) return
    existing.remove()
  }

  const style = document.createElement("style")
  style.id = STYLE_ID
  style.setAttribute("data-v", STYLE_VERSION)
  style.textContent = cssText

  if (root instanceof ShadowRoot) {
    root.appendChild(style)        // key line: inject into shadow root
  } else {
    document.head.appendChild(style)
  }
}

function blobToBytesArray(blob: Blob): Promise<number[]> {
  return blob.arrayBuffer().then((buffer) => Array.from(new Uint8Array(buffer)))
}

function mergeFloat32Arrays(chunks: Float32Array[]): Float32Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Float32Array(totalLength)

  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  return result
}

function floatTo16BitPCM(float32Array: Float32Array): Int16Array {
  const output = new Int16Array(float32Array.length)

  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]))
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }

  return output
}

// ── Streamlit theme detection ─────────────────────────────────────────────────
// Streamlit's light/dark default palette
const THEME_LIGHT = { primary: "#ff4b4b", bg: "#ffffff", secondaryBg: "#f0f2f6", text: "#31333f" }
const THEME_DARK  = { primary: "#ff4b4b", bg: "#0e1117", secondaryBg: "#262730", text: "#fafafa"  }
type CBTheme = typeof THEME_LIGHT

function getCSSVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function parseLuminance(colorStr: string): number | null {
  const m = colorStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/)
  if (!m) return null
  const alpha = m[4] !== undefined ? parseFloat(m[4]) : 1
  if (alpha < 0.05) return null  // skip transparent
  return 0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]
}

function getBaseMode(): "dark" | "light" {
  const log: Record<string, unknown> = {}

  // 1. data-theme attribute
  const dataTheme =
    document.documentElement.getAttribute("data-theme") ??
    document.querySelector("[data-testid='stApp']")?.getAttribute("data-theme")
  log["data-theme"] = dataTheme
  if (dataTheme === "dark") return "dark"
  if (dataTheme === "light") return "light"

  // 2. localStorage
  let lsResult: string | null = null
  try {
    for (const key of ["streamlit:activeTheme", "streamlit:theme", "stTheme"]) {
      const raw = localStorage.getItem(key)
      log[`localStorage[${key}]`] = raw
      if (!raw) continue
      const parsed = JSON.parse(raw)
      const base = (parsed?.base ?? parsed?.name ?? "").toLowerCase()
      if (base.includes("dark")) { lsResult = "dark"; break }
      if (base.includes("light")) { lsResult = "light"; break }
    }
  } catch {}
  if (lsResult) return lsResult as "dark" | "light"

  // 3. CSS background-color / custom property scan
  const cssCandidates: [string, HTMLElement | null][] = [
    ["--background-color css var", null],
    ["stApp", document.querySelector<HTMLElement>("[data-testid='stApp']")],
    ["stAppViewContainer", document.querySelector<HTMLElement>("[data-testid='stAppViewContainer']")],
    ["body", document.body],
    ["html", document.documentElement],
  ]

  const cssVarBg = getCSSVar("--background-color")
  log["--background-color"] = cssVarBg
  if (cssVarBg) {
    const lum = parseLuminance(cssVarBg) ?? (cssVarBg.includes("#") ? null : null)
    // hex check
    const hexM = cssVarBg.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i)
    if (hexM) {
      const l = 0.299 * parseInt(hexM[1],16) + 0.587 * parseInt(hexM[2],16) + 0.114 * parseInt(hexM[3],16)
      log["--background-color lum"] = l
      console.log("[chatbar-media theme]", log)
      return l < 128 ? "dark" : "light"
    }
    if (lum !== null) {
      log["--background-color lum"] = lum
      console.log("[chatbar-media theme]", log)
      return lum < 128 ? "dark" : "light"
    }
  }

  for (const [label, el] of cssCandidates.slice(1)) {
    if (!el) { log[label] = "not found"; continue }
    const bg = getComputedStyle(el).backgroundColor
    const lum = parseLuminance(bg)
    log[label] = { bg, lum }
    if (lum !== null) {
      console.log("[chatbar-media theme]", log)
      return lum < 128 ? "dark" : "light"
    }
  }

  // 4. OS preference
  const osDark = window.matchMedia("(prefers-color-scheme: dark)").matches
  log["OS dark"] = osDark
  console.log("[chatbar-media theme]", log)
  return osDark ? "dark" : "light"
}

function detectTheme(): CBTheme {
  const mode = getBaseMode()
  const defaults = mode === "dark" ? THEME_DARK : THEME_LIGHT

  const primary     = getCSSVar("--primary-color")
  const bg          = getCSSVar("--background-color")
  const secondaryBg = getCSSVar("--secondary-background-color")
  const text        = getCSSVar("--text-color")

  return {
    primary:     primary     || defaults.primary,
    bg:          bg          || defaults.bg,
    secondaryBg: secondaryBg || defaults.secondaryBg,
    text:        text        || defaults.text,
  }
}

function useStreamlitTheme(): CBTheme {
  const [theme, setTheme] = useState<CBTheme>(detectTheme)

  useEffect(() => {
    const refresh = () => setTheme(detectTheme())

    const timers = [50, 150, 300, 600, 1200, 2500].map((ms) => setTimeout(refresh, ms))

    const observer = new MutationObserver(refresh)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme", "color-scheme"],
    })
    const appEl = document.querySelector("[data-testid='stApp']")
    if (appEl) observer.observe(appEl, { attributes: true })
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })

    return () => {
      timers.forEach(clearTimeout)
      observer.disconnect()
    }
  }, [])

  return theme
}
// ─────────────────────────────────────────────────────────────────────────────

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const pcm = floatTo16BitPCM(samples)
  const buffer = new ArrayBuffer(44 + pcm.length * 2)
  const view = new DataView(buffer)

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  writeString(0, "RIFF")
  view.setUint32(4, 36 + pcm.length * 2, true)
  writeString(8, "WAVE")

  writeString(12, "fmt ")
  view.setUint32(16, 16, true)   // PCM chunk size
  view.setUint16(20, 1, true)    // PCM format
  view.setUint16(22, 1, true)    // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate = sampleRate * channels * bytesPerSample
  view.setUint16(32, 2, true)    // block align
  view.setUint16(34, 16, true)   // bits per sample

  writeString(36, "data")
  view.setUint32(40, pcm.length * 2, true)

  let offset = 44
  for (let i = 0; i < pcm.length; i++, offset += 2) {
    view.setInt16(offset, pcm[i], true)
  }

  return new Blob([buffer], { type: "audio/wav" })
}

const MediaChatbarUI: React.FC<{
  placeholder?: string
  disabled?: boolean
  responsive?: boolean
  onSubmit: (payload: SubmitPayload) => void
}> = ({ placeholder, responsive, disabled, onSubmit }) => {
  const cbTheme = useStreamlitTheme()
  const themeStyle = {
    "--cb-primary":      cbTheme.primary,
    "--cb-bg":           cbTheme.bg,
    "--cb-secondary-bg": cbTheme.secondaryBg,
    "--cb-text":         cbTheme.text,
  } as React.CSSProperties

  const [inputText, setInputText] = useState<string>("")
  const [isRecording, setIsRecording] = useState<boolean>(false)
  const textAreaRef = useRef<HTMLTextAreaElement>(null)

  // Audio recording state
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioStreamRef = useRef<MediaStream | null>(null)
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const audioChunksRef = useRef<Float32Array[]>([])
  const audioSampleRateRef = useRef<number>(16000)

  // Photo popup state
  const [showPhotoPopup, setShowPhotoPopup] = useState<boolean>(false)
  const [photoMode, setPhotoMode] = useState<"upload" | "camera">("upload")
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 768px)").matches)

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)")
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  // Upload
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Camera
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [selectedCamId, setSelectedCamId] = useState<string>("")
  const videoRef = useRef<HTMLVideoElement>(null)
  const camStreamRef = useRef<MediaStream | null>(null)

  const cleanupAudioRecording = useCallback(async () => {
    try {
      if (processorRef.current) {
        processorRef.current.disconnect()
        processorRef.current.onaudioprocess = null
      }
    } catch {}

    try {
      audioSourceRef.current?.disconnect()
    } catch {}

    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop())
      audioStreamRef.current = null
    }

    if (audioContextRef.current) {
      try {
        await audioContextRef.current.close()
      } catch {}
      audioContextRef.current = null
    }

    processorRef.current = null
    audioSourceRef.current = null
  }, [])

  const startWavRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      audioStreamRef.current = stream

      const audioContext = new AudioContext({ sampleRate: 16000 })
      audioContextRef.current = audioContext
      audioSampleRateRef.current = audioContext.sampleRate

      const source = audioContext.createMediaStreamSource(stream)
      audioSourceRef.current = source

      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor

      audioChunksRef.current = []

      processor.onaudioprocess = (event: AudioProcessingEvent) => {
        const input = event.inputBuffer.getChannelData(0)
        audioChunksRef.current.push(new Float32Array(input))
      }

      source.connect(processor)
      processor.connect(audioContext.destination)

      setIsRecording(true)
      console.log("Started WAV recording. sampleRate=", audioContext.sampleRate)
    } catch (err) {
      console.error("Failed to start WAV recording:", err)
      await cleanupAudioRecording()
      setIsRecording(false)
    }
  }, [cleanupAudioRecording])

  const stopWavRecording = useCallback(async () => {
    try {
      setIsRecording(false)

      await cleanupAudioRecording()

      const mergedSamples = mergeFloat32Arrays(audioChunksRef.current)
      audioChunksRef.current = []

      if (!mergedSamples.length) {
        console.warn("No audio samples captured.")
        return
      }

      const wavBlob = encodeWav(mergedSamples, audioSampleRateRef.current)
      const audioArray = await blobToBytesArray(wavBlob)

      console.log("Created WAV blob", {
        size: wavBlob.size,
        type: wavBlob.type,
        sampleRate: audioSampleRateRef.current,
        firstBytes: audioArray.slice(0, 16),
      })

      onSubmit({
        audioFile: audioArray,
        audioMime: "audio/wav",
      })
    } catch (err) {
      console.error("Failed to stop WAV recording:", err)
    } finally {
      audioChunksRef.current = []
    }
  }, [cleanupAudioRecording, onSubmit])

  useEffect(() => {
    return () => {
      cleanupAudioRecording().catch(() => {})
      if (camStreamRef.current) {
        camStreamRef.current.getTracks().forEach((t) => t.stop())
        camStreamRef.current = null
      }
    }
  }, [cleanupAudioRecording])

  // ---------- Textarea height ----------
  const adjustTextAreaHeight = (reset: boolean = false) => {
    if (!textAreaRef.current) return
    textAreaRef.current.style.height = "auto"
    if (!reset) textAreaRef.current.style.height = `${textAreaRef.current.scrollHeight}px`
  }

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(event.target.value)
    adjustTextAreaHeight()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      if (!disabled && inputText.trim().length > 0) {
        onSubmit({ text: inputText })
        setInputText("")
        adjustTextAreaHeight(true)
      }
    }
  }

  const handleIconClick = () => {
    if (disabled) return

    if (inputText.trim().length > 0) {
      onSubmit({ text: inputText })
      setInputText("")
      adjustTextAreaHeight(true)
    } else {
      if (isRecording) {
        stopWavRecording()
      } else {
        startWavRecording()
      }
    }
  }

  // ---------- Photo helpers ----------
  const stopCameraPreview = () => {
    if (camStreamRef.current) {
      camStreamRef.current.getTracks().forEach((t) => t.stop())
      camStreamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
  }

  const closePhotoPopup = () => {
    stopCameraPreview()
    setShowPhotoPopup(false)
    setCameraError(null)
    setPhotoMode("upload")
  }

  const openPhotoPopup = () => {
    if (disabled) return
    setShowPhotoPopup(true)
    setCameraError(null)
    setPhotoMode("upload")
  }

  const handleUploadClick = () => {
    setPhotoMode("upload")
    setCameraError(null)
    stopCameraPreview()
    fileInputRef.current?.click()
  }


  const ensureCameraList = async () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera API not available")

    const temp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    temp.getTracks().forEach((t) => t.stop())

    const devices = await navigator.mediaDevices.enumerateDevices()
    const vids = devices.filter((d) => d.kind === "videoinput")
    if (!vids.length) throw new Error("No cameras found")

    setCameras(vids)
    const preferred = vids.find((d) => /rear|back|environment/i.test(d.label)) ?? vids[0]
    setSelectedCamId((prev) => prev || preferred.deviceId)
  }

  const startCameraPreview = async (deviceId: string) => {
    stopCameraPreview()
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId } },
      audio: false,
    })
    camStreamRef.current = stream
    if (videoRef.current) {
      videoRef.current.srcObject = stream
      await videoRef.current.play()
    }
  }

  const handleCameraMode = async () => {
    setPhotoMode("camera")
    setCameraError(null)
    try {
      await ensureCameraList()
    } catch {
      setCameraError("Unable to access camera. Check permissions or device availability.")
    }
  }

  useEffect(() => {
    if (showPhotoPopup && photoMode === "camera" && selectedCamId && !cameraError) {
      startCameraPreview(selectedCamId).catch(() => {
        setCameraError("Could not start camera preview for the selected camera.")
      })
    }
  }, [showPhotoPopup, photoMode, selectedCamId, cameraError])

  const onUploadFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const bytes = await blobToBytesArray(file)
    const mime = file.type || "image/jpeg"
    onSubmit({ imageFile: bytes, imageMime: mime })

    e.target.value = ""
    closePhotoPopup()
  }

  const capturePhoto = async () => {
    const video = videoRef.current
    if (!video) return

    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9))
    if (!blob) return

    const bytes = await blobToBytesArray(blob)
    onSubmit({ imageFile: bytes, imageMime: "image/jpeg" })
    closePhotoPopup()
  }

  return (
      <div className={responsive ? "cbm-responsive" : "cbm-nonresponsive"} style={themeStyle}>
        <div className="chat-container">
        <button className="icon-btn-photo" onClick={openPhotoPopup} disabled={disabled}>
          <AddIcon />
        </button>

        <textarea
          ref={textAreaRef}
          className="chat-input"
          placeholder={placeholder ?? "Type a message..."}
          value={inputText}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={disabled}
        />

        <button className="icon-btn-audio" onClick={handleIconClick} disabled={disabled}>
          {inputText.trim().length > 0 ? <SendIcon /> : isRecording ? <StopIcon /> : <MicIcon />}
        </button>
      </div>

      {showPhotoPopup && (
        <div
          className="photo-popup-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePhotoPopup()
          }}
        >
          <div className="photo-popup">
            <div className="photo-popup-header">
              <strong style={{ flex: 1 }}>Add a photo</strong>
              <button className="photo-popup-close" onClick={closePhotoPopup}>
                ✕
              </button>
            </div>

            {!isMobile && (
              <div className="photo-popup-modes">
                <button
                  type="button"
                  className={photoMode === "upload" ? "mode-btn mode-btn-active" : "mode-btn"}
                  onClick={handleUploadClick}
                >
                  Upload
                </button>
                <button
                  type="button"
                  className={photoMode === "camera" ? "mode-btn mode-btn-active" : "mode-btn"}
                  onClick={handleCameraMode}
                >
                  Camera
                </button>
              </div>
            )}

            {isMobile && (
              <div className="photo-popup-modes">
                <button
                  type="button"
                  className={photoMode === "camera" ? "mode-btn mode-btn-active" : "mode-btn"}
                  onClick={handleCameraMode}
                >
                  Camera
                </button>
              </div>
            )}

            {cameraError ? <div className="photo-error">{cameraError}</div> : null}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={onUploadFileSelected}
            />

            {(!isMobile && photoMode === "upload") || isMobile ? (
              <button className="choose-file-btn" onClick={() => fileInputRef.current?.click()}>
                Choose image file
              </button>
            ) : null}

            {photoMode === "camera" && !cameraError ? (
              <>
                <select
                  value={selectedCamId}
                  onChange={(e) => setSelectedCamId(e.target.value)}
                  className="camera-select"
                >
                  {cameras.map((c, idx) => (
                    <option key={c.deviceId} value={c.deviceId}>
                      {c.label || `Camera ${idx + 1}`}
                    </option>
                  ))}
                </select>

                <video ref={videoRef} playsInline className="camera-preview" />

                <div className="camera-actions">
                  <button className="camera-cancel" onClick={closePhotoPopup}>
                    Cancel
                  </button>
                  <button className="camera-capture" onClick={capturePhoto}>
                    Take photo
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

const renderer: FrontendRenderer<any, MediaChatbarData> = (component) => {
  let root: Root | null = null
  const mount = component.parentElement

  mount.innerHTML = ""
  ensureStyles(mount)

  root = createRoot(mount)

  const data = (component.data ?? {}) as ChatbarMediaData
  const placeholder = data.placeholder
  const disabled = data.disabled ?? false
  const responsive = data.responsive ?? false


  root.render(
    <MediaChatbarUI
      placeholder={placeholder}
      disabled={disabled}
      responsive={responsive}
      onSubmit={(payload) => {
        component.setTriggerValue("submit", payload)
      }}
    />
  )

  return () => {
    try {
      root?.unmount()
    } catch {}
    mount.innerHTML = ""
  }
}

export default renderer