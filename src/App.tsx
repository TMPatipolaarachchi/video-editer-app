import { useEffect, useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'
import {
  Download,
  Gauge,
  LoaderCircle,
  Music2,
  Scissors,
  Sparkles,
  Upload,
  Video,
  Volume2,
} from 'lucide-react'
import './App.css'

// Always use localhost:3001 in dev, or same origin in production
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

if (import.meta.env.DEV) {
  console.log('[✓] API Base URL:', apiBaseUrl)
}

const speedPresets = [0.5, 0.75, 1, 1.25, 1.5, 2]

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00'
  }

  const totalSeconds = Math.floor(seconds)
  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60

  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

function App() {
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [musicFile, setMusicFile] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState('')
  const [outputUrl, setOutputUrl] = useState('')
  const [outputName, setOutputName] = useState('')
  const [duration, setDuration] = useState(0)
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [muteOriginal, setMuteOriginal] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('Upload a video to start editing.')

  const previewRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (!outputUrl) {
      return
    }

    return () => URL.revokeObjectURL(outputUrl)
  }, [outputUrl])

  useEffect(() => {
    const previewVideo = previewRef.current

    if (!previewVideo || !videoUrl) {
      return
    }

    if (trimStart <= previewVideo.duration) {
      previewVideo.currentTime = trimStart
    }
  }, [trimStart, videoUrl])

  const clearRenderedOutput = () => {
    setOutputUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl)
      }

      return ''
    })
    setOutputName('')
  }

  const handleVideoChange = (file: File | null) => {
    setVideoUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl)
      }

      return file ? URL.createObjectURL(file) : ''
    })
    setVideoFile(file)
    setDuration(0)
    setTrimStart(0)
    setTrimEnd(0)
    setStatus(file ? `Loaded ${file.name}.` : 'Upload a video to start editing.')
    setProgress(0)
    clearRenderedOutput()
  }

  const handleMusicChange = (file: File | null) => {
    setMusicFile(file)
    setStatus(file ? `Loaded music track ${file.name}.` : 'Music removed.')
    clearRenderedOutput()
  }

  const handleTrimStartChange = (nextStart: number) => {
    const safeStart = Math.max(0, Math.min(nextStart, duration))
    const safeEnd = Math.max(safeStart + 0.1, trimEnd || duration)

    setTrimStart(safeStart)
    setTrimEnd(Math.min(safeEnd, duration || safeEnd))
    setStatus('Crop updated. Export again to apply it.')
    clearRenderedOutput()
  }

  const handleTrimEndChange = (nextEnd: number) => {
    const safeEnd = Math.max(0.1, Math.min(nextEnd, duration))
    const safeStart = Math.min(trimStart, safeEnd - 0.1)

    setTrimStart(Math.max(0, safeStart))
    setTrimEnd(safeEnd)
    setStatus('Crop updated. Export again to apply it.')
    clearRenderedOutput()
  }

  const handleSpeedChange = (nextSpeed: number) => {
    setSpeed(nextSpeed)
    setStatus(`Playback speed set to ${nextSpeed.toFixed(2)}x.`)
    clearRenderedOutput()
  }

  const handleLoadedMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    const nextDuration = event.currentTarget.duration || 0
    setDuration(nextDuration)
    setTrimStart(0)
    setTrimEnd(nextDuration)
  }

  const handleExport = async () => {
    if (!videoFile || !trimEnd) {
      setStatus('Upload a video first.')
      return
    }

    const start = Math.max(0, Math.min(trimStart, trimEnd))
    const end = Math.max(start + 0.1, Math.min(trimEnd, duration || trimEnd))
    const selectedSpeed = Math.min(2, Math.max(0.5, speed))
    const outputFileName = `${videoFile.name.replace(/\.[^.]+$/, '')}-edited.mp4`
    const formData = new FormData()

    formData.append('video', videoFile)

    if (musicFile) {
      formData.append('music', musicFile)
    }

    formData.append('start', String(start))
    formData.append('end', String(end))
    formData.append('speed', String(selectedSpeed))
    formData.append('muteOriginal', String(muteOriginal))

    setIsProcessing(true)
    setProgress(0.08)
    setStatus('Checking the render server...')

    try {
      setProgress(0.15)
      setStatus(`Checking render server at ${apiBaseUrl}...`)

      let healthResponse

      try {
        const healthUrl = `${apiBaseUrl}/api/health`
        console.log('[✓] Health check URL:', healthUrl)
        healthResponse = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) })
      } catch (error) {
        console.error('[✗] Health check failed:', error)
        throw new Error(
          `Cannot reach render server at ${apiBaseUrl}. Make sure 'npm run dev' is running to start the backend on port 3001.`,
          { cause: error },
        )
      }

      if (!healthResponse.ok) {
        throw new Error('Render server is not available. Start the backend and try again.')
      }

      setProgress(0.35)
      setStatus('Sending your edit to the server...')

      let response

      try {
        response = await fetch(`${apiBaseUrl}/api/render`, {
          method: 'POST',
          body: formData,
          signal: AbortSignal.timeout(300000),
        })
      } catch (error) {
        console.error('Render request failed:', error)
        if (error instanceof TypeError && error.message.includes('fetch')) {
          throw new Error('Network error. Check that the server is running and accessible.', { cause: error })
        }
        throw error
      }

      if (!response.ok) {
        const message = await response.text()
        throw new Error(message || 'The render server rejected the export.')
      }

      setProgress(0.9)

      const renderedBlob = await response.blob()
      const renderedUrl = URL.createObjectURL(renderedBlob)

      setOutputUrl((currentUrl) => {
        if (currentUrl) {
          URL.revokeObjectURL(currentUrl)
        }

        return renderedUrl
      })
      setOutputName(outputFileName)
      setProgress(1)
      setStatus('Export ready. Download the rendered MP4 below.')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('Export error:', errorMessage)
      setStatus(errorMessage || 'Export failed. Check the browser console and server logs for details.')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="app-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />

      <header className="hero-card">
        <div className="hero-copy">
          <span className="eyebrow">
            <Sparkles size={14} /> Social media video studio
          </span>
          <h1>Upload a clip, trim the cut, change the speed, mute it, and add music.</h1>
          <p>
            Build a ready-to-post MP4 in the browser with a focused edit flow for
            short-form social content.
          </p>
        </div>

        <div className="hero-stats">
          <div>
            <strong>Trim</strong>
            <span>Pick the start and end of the clip you want to post.</span>
          </div>
          <div>
            <strong>Speed</strong>
            <span>Slow down for emphasis or speed up for punchier cuts.</span>
          </div>
          <div>
            <strong>Audio</strong>
            <span>Mute the original track and layer in your own music.</span>
          </div>
        </div>
      </header>

      <main className="editor-grid">
        <section className="panel panel-upload">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">1. Import media</span>
              <h2>Video and music</h2>
            </div>
            <Upload size={22} />
          </div>

          <label className="dropzone" htmlFor="video-upload">
            <input
              id="video-upload"
              type="file"
              accept="video/*"
              onChange={(event) => handleVideoChange(event.target.files?.[0] ?? null)}
            />
            <Video size={28} />
            <strong>{videoFile ? videoFile.name : 'Drop or choose a video'}</strong>
            <span>MP4, MOV, and WebM clips work well for export.</span>
          </label>

          <label className="field-label" htmlFor="music-upload">
            <span>
              <Music2 size={16} /> Optional music track
            </span>
            <input
              id="music-upload"
              type="file"
              accept="audio/*"
              onChange={(event) => handleMusicChange(event.target.files?.[0] ?? null)}
            />
          </label>

          <div className="file-chip-row">
            {videoFile ? (
              <span className="chip chip-video">Video ready</span>
            ) : (
              <span className="chip">Waiting for video</span>
            )}
            {musicFile ? (
              <span className="chip chip-music">Music ready</span>
            ) : (
              <span className="chip">Music optional</span>
            )}
          </div>

          <div className="tip-box">
            <Scissors size={16} />
            <p>Use crop to trim the part of the video you want to share.</p>
          </div>
        </section>

        <section className="panel panel-preview">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">2. Preview and adjust</span>
              <h2>Timeline, speed, and mute</h2>
            </div>
            <Gauge size={22} />
          </div>

          <div className="video-frame">
            {videoUrl ? (
              <video
                ref={previewRef}
                src={videoUrl}
                controls
                playsInline
                onLoadedMetadata={handleLoadedMetadata}
              />
            ) : (
              <div className="video-placeholder">
                <Video size={32} />
                <p>Your preview will appear here after you upload a video.</p>
              </div>
            )}
          </div>

          <div className="range-grid">
            <label className="range-card">
              <span>Start</span>
              <strong>{formatTime(trimStart)}</strong>
              <input
                type="range"
                min="0"
                max={Math.max(duration, 0)}
                step="0.1"
                value={trimStart}
                onChange={(event) => handleTrimStartChange(Number(event.target.value))}
                disabled={!duration}
              />
            </label>

            <label className="range-card">
              <span>End</span>
              <strong>{formatTime(trimEnd || duration)}</strong>
              <input
                type="range"
                min="0.1"
                max={Math.max(duration, 0.1)}
                step="0.1"
                value={trimEnd || duration}
                onChange={(event) => handleTrimEndChange(Number(event.target.value))}
                disabled={!duration}
              />
            </label>
          </div>

          <div className="speed-block">
            <div className="speed-header">
              <Volume2 size={16} />
              <span>Playback speed</span>
            </div>
            <div className="speed-presets">
              {speedPresets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={preset === speed ? 'speed-pill is-active' : 'speed-pill'}
                  onClick={() => handleSpeedChange(preset)}
                >
                  {preset}x
                </button>
              ))}
            </div>
          </div>

          <label className="mute-toggle">
            <input
              type="checkbox"
              checked={muteOriginal}
              onChange={(event) => {
                setMuteOriginal(event.target.checked)
                setStatus(event.target.checked ? 'Original audio muted.' : 'Original audio restored.')
                clearRenderedOutput()
              }}
            />
            <span>Mute original audio while exporting</span>
          </label>
        </section>

        <section className="panel panel-export">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">3. Export</span>
              <h2>Render the final MP4</h2>
            </div>
            <Download size={22} />
          </div>

          <button
            type="button"
            className="export-button"
            onClick={handleExport}
            disabled={!videoFile || isProcessing}
          >
            {isProcessing ? <LoaderCircle className="spin" size={18} /> : <Download size={18} />}
            {isProcessing ? 'Rendering your edit' : 'Export video'}
          </button>

          <div className="progress-shell" aria-hidden="true">
            <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
          </div>

          <div className="status-card">
            <p>{status}</p>
            <span>
              {duration
                ? `${formatTime(trimStart)} - ${formatTime(trimEnd || duration)} at ${speed.toFixed(2)}x`
                : 'Waiting for a source video.'}
            </span>
          </div>

          {outputUrl ? (
            <div className="result-card">
              <strong>Rendered file</strong>
              <p>{outputName}</p>
              <video src={outputUrl} controls playsInline />
              <a href={outputUrl} download={outputName} className="download-link">
                <Download size={16} /> Download MP4
              </a>
            </div>
          ) : (
            <div className="result-card empty-state">
              <strong>No export yet</strong>
              <p>Your finished video will appear here after rendering.</p>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

export default App
