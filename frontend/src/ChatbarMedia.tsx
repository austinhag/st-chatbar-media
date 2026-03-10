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

function ensureStyles(mountEl: HTMLElement | ShadowRoot) {
  const STYLE_ID = "chatbar-media-inline-style"

  // This returns either Document or ShadowRoot
  const root = mountEl.getRootNode() as Document | ShadowRoot

  const existing =
    root instanceof ShadowRoot
      ? root.getElementById?.(STYLE_ID) ?? root.querySelector(`#${STYLE_ID}`)
      : (document.getElementById(STYLE_ID) as HTMLElement | null)

  if (existing) return

  const style = document.createElement("style")
  style.id = STYLE_ID
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
      <div className={responsive ? "cbm-responsive" : "cbm-nonresponsive"}>
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

            {cameraError ? <div className="photo-error">{cameraError}</div> : null}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={onUploadFileSelected}
            />

            {photoMode === "upload" ? (
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