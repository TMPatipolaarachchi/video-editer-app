import express from 'express'
import cors from 'cors'
import multer from 'multer'
import ffmpegPath from 'ffmpeg-static'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const app = express()
const port = process.env.PORT || 3001
const uploadDirectory = path.join(process.cwd(), 'server-work')

await fs.mkdir(uploadDirectory, { recursive: true })

const upload = multer({ dest: uploadDirectory })

app.use(cors())

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, timestamp: Date.now() })
})

app.use((error, _request, response, _next) => {
  console.error('[✗] Error:', error.message)
  response.status(500).send(error.message || 'Internal server error')
})

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00'
  }

  const totalSeconds = Math.floor(seconds)
  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60

  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

const buildTempoFilter = (speed) => {
  if (speed === 1) {
    return 'atempo=1'
  }

  const filters = []
  let remainingSpeed = speed

  while (remainingSpeed < 0.5) {
    filters.push('atempo=0.5')
    remainingSpeed /= 0.5
  }

  while (remainingSpeed > 2) {
    filters.push('atempo=2')
    remainingSpeed /= 2
  }

  filters.push(`atempo=${remainingSpeed.toFixed(2)}`)
  return filters.join(',')
}

const runFfmpeg = (args) => {
  if (!ffmpegPath) {
    throw new Error('FFmpeg binary is unavailable in this environment.')
  }

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })

    let stderr = ''

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(stderr.trim() || `FFmpeg exited with code ${code}`))
    })
  })
}

const removeFiles = async (...filePaths) => {
  await Promise.allSettled(
    filePaths.filter(Boolean).map((filePath) => fs.rm(filePath, { force: true })),
  )
}

app.post(
  '/api/render',
  upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'music', maxCount: 1 },
  ]),
  async (request, response) => {
    const videoFile = request.files?.video?.[0]
    const musicFile = request.files?.music?.[0]
    const start = Number.parseFloat(request.body.start ?? '0')
    const end = Number.parseFloat(request.body.end ?? '0')
    const speed = Number.parseFloat(request.body.speed ?? '1')
    const muteOriginal = request.body.muteOriginal === 'true'

    if (!videoFile) {
      response.status(400).send('A video file is required.')
      return
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      await removeFiles(videoFile.path, musicFile?.path)
      response.status(400).send('Invalid trim range.')
      return
    }

    const safeSpeed = Math.min(2, Math.max(0.5, Number.isFinite(speed) ? speed : 1))
    const renderDuration = Math.max(0.1, (end - start) / safeSpeed)
    const outputPath = path.join(uploadDirectory, `${Date.now()}-rendered.mp4`)
    const outputName = `${path.basename(videoFile.originalname, path.extname(videoFile.originalname))}-edited.mp4`

    try {
      const trimArgs = ['-ss', String(start), '-to', String(end), '-i', videoFile.path]

      if (!musicFile) {
        const args = [
          ...trimArgs,
          '-vf',
          `setpts=(PTS-STARTPTS)/${safeSpeed}`,
          muteOriginal ? '-an' : '-af',
          muteOriginal ? '' : buildTempoFilter(safeSpeed),
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '23',
          '-pix_fmt',
          'yuv420p',
          '-threads',
          '0',
          '-max_muxing_queue_size',
          '1024',
          '-movflags',
          '+faststart',
          outputPath,
        ].filter(Boolean)

        await runFfmpeg(args)
      } else {
        const musicArgs = muteOriginal
          ? [
              ...trimArgs,
              '-stream_loop',
              '-1',
              '-t',
              String(renderDuration),
              '-i',
              musicFile.path,
              '-filter_complex',
              `[0:v]setpts=(PTS-STARTPTS)/${safeSpeed}[vout];[1:a]${buildTempoFilter(safeSpeed)},volume=1.0[aout]`,
              '-map',
              '[vout]',
              '-map',
              '[aout]',
              '-shortest',
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-crf',
              '23',
              '-c:a',
              'aac',
              '-b:a',
              '192k',
              '-pix_fmt',
              'yuv420p',
              '-threads',
              '0',
              '-max_muxing_queue_size',
              '1024',
              '-movflags',
              '+faststart',
              outputPath,
            ]
          : [
              ...trimArgs,
              '-stream_loop',
              '-1',
              '-t',
              String(renderDuration),
              '-i',
              musicFile.path,
              '-filter_complex',
              [
                `[0:v]setpts=(PTS-STARTPTS)/${safeSpeed}[vout]`,
                `[0:a]${buildTempoFilter(safeSpeed)},volume=0.85[orig]`,
                `[1:a]${buildTempoFilter(safeSpeed)},volume=0.35[music]`,
                '[orig][music]amix=inputs=2:duration=shortest:dropout_transition=2[aout]',
              ].join(';'),
              '-map',
              '[vout]',
              '-map',
              '[aout]',
              '-shortest',
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-crf',
              '23',
              '-c:a',
              'aac',
              '-b:a',
              '192k',
              '-pix_fmt',
              'yuv420p',
              '-threads',
              '0',
              '-max_muxing_queue_size',
              '1024',
              '-movflags',
              '+faststart',
              outputPath,
            ]

        await runFfmpeg(musicArgs)
      }

      response.setHeader('X-Filename', outputName)
      response.download(outputPath, outputName, async (downloadError) => {
        await removeFiles(videoFile.path, musicFile?.path, outputPath)

        if (downloadError) {
          console.error(downloadError)
        }
      })
    } catch (error) {
      console.error(error)
      await removeFiles(videoFile.path, musicFile?.path, outputPath)
      response.status(500).send(error instanceof Error ? error.message : 'Render failed.')
    }
  },
)

app.listen(port, '0.0.0.0', () => {
  console.log(`[✓] Render server ready on port ${port}`)
  console.log(`[✓] CORS enabled - accepting requests from any origin`)
  console.log(`[✓] Health check: GET /api/health`)
  console.log(`[✓] Render endpoint: POST /api/render`)
})

process.on('uncaughtException', (error) => {
  console.error('[✗] Uncaught error:', error)
})
