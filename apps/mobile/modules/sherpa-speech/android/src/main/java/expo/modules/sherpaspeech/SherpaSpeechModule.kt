package expo.modules.sherpaspeech

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaCodec
import android.media.MediaCodecList
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineTransducerModelConfig
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import com.k2fsa.sherpa.onnx.OfflineWhisperModelConfig
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Sumrak's sherpa-onnx speech module (T11 TTS + T12 ASR, design §6).
 *
 * TTS: Piper Russian VITS voices, one loaded at a time; `speak` streams
 * synthesis chunks to an AudioTrack as they are generated, `synthesizeToFile`
 * renders a WAV for caching.
 *
 * ASR (T12): offline Zipformer transducer (Russian), one recognizer loaded at
 * a time on its own executor so recognition never queues behind synthesis.
 * Mic capture is done here too (AudioRecord → 16 kHz mono PCM16 WAV): Android
 * has no WAV MediaRecorder output, and the ASR models want exactly this
 * format, so recording anywhere else would just add a transcode step.
 *
 * T59 (M17 «Сценарии», design §11) adds two things on the same executors:
 * a WAV → Ogg/Opus transcoder (MediaCodec + MediaMuxer, no new dependency —
 * attempt recordings are kept as Opus) and a second, independently
 * resident Whisper multilingual recognizer (OfflineWhisperModelConfig) that
 * re-decodes the same recordings in English for «как сказать <word>».
 *
 * The module also carries the model-manager helpers that need native muscle:
 * streaming SHA-256, .tar.bz2 extraction, directory sizing.
 */
class SherpaSpeechModule : Module() {
  /** Serializes all TTS work (load/speak/synthesize) — sherpa's OfflineTts is not thread-safe. */
  private val ttsExecutor = Executors.newSingleThreadExecutor { r -> Thread(r, "SherpaTts") }

  /** Serializes ASR work (load/transcribe) — independent of TTS so neither blocks the other. */
  private val asrExecutor = Executors.newSingleThreadExecutor { r -> Thread(r, "SherpaAsr") }

  /** Model-manager I/O (hashing, extraction) must not block or be blocked by speech. */
  private val ioExecutor = Executors.newSingleThreadExecutor { r -> Thread(r, "SherpaIo") }

  @Volatile private var tts: OfflineTts? = null
  @Volatile private var loadedVoiceId: String? = null

  @Volatile private var asr: OfflineRecognizer? = null
  @Volatile private var loadedAsrId: String? = null

  // ---- Whisper assist recognizer (T59) — resident beside the Zipformer ----
  @Volatile private var whisper: OfflineRecognizer? = null
  @Volatile private var loadedWhisperId: String? = null
  /** Whisper's language is a model-config field, so a change = rebuild (see transcribeWhisper). */
  @Volatile private var whisperLanguage: String = "en"
  private var whisperFiles: WhisperFiles? = null

  private data class WhisperFiles(val encoder: File, val decoder: File, val tokens: File)

  // ---- mic recording state (guarded by recordingLock) ----
  private val recordingLock = Any()
  private var audioRecord: AudioRecord? = null
  private var recordingThread: Thread? = null
  @Volatile private var recordingActive = false
  private var recordingFile: File? = null

  /**
   * Monotonic utterance id: bumping it is the cancellation signal every
   * in-flight generation callback and drain loop checks. `stop()` and each
   * new `speak()` bump it.
   */
  private val utteranceSeq = AtomicLong(0)

  @Volatile private var activeTrack: AudioTrack? = null

  override fun definition() = ModuleDefinition {
    Name("SherpaSpeech")

    Events("onSpeakingStateChanged", "onRecordingLevel")

    /**
     * Load a Piper voice from extracted model files. Resolves with the load
     * time; a no-op (already loaded) resolves immediately. ~0.5–2 s cold —
     * callers should preload off the critical path.
     */
    AsyncFunction("loadVoice") { voiceId: String, modelPath: String, tokensPath: String, dataDir: String, promise: Promise ->
      ttsExecutor.execute {
        try {
          if (loadedVoiceId == voiceId && tts != null) {
            promise.resolve(mapOf("loadMs" to 0, "alreadyLoaded" to true))
            return@execute
          }
          cancelPlayback()
          tts?.release()
          tts = null
          loadedVoiceId = null

          val model = File(stripFileUri(modelPath))
          val tokens = File(stripFileUri(tokensPath))
          val data = File(stripFileUri(dataDir))
          if (!model.isFile || !tokens.isFile || !data.isDirectory) {
            throw CodedException("ERR_VOICE_FILES", "voice files missing for $voiceId", null)
          }

          val t0 = SystemClock.elapsedRealtime()
          val config = OfflineTtsConfig(
            model = OfflineTtsModelConfig(
              vits = OfflineTtsVitsModelConfig(
                model = model.absolutePath,
                tokens = tokens.absolutePath,
                dataDir = data.absolutePath,
              ),
              numThreads = 2,
              debug = false,
              provider = "cpu",
            ),
          )
          tts = OfflineTts(config = config)
          loadedVoiceId = voiceId
          promise.resolve(
            mapOf("loadMs" to (SystemClock.elapsedRealtime() - t0), "alreadyLoaded" to false),
          )
        } catch (t: Throwable) {
          promise.reject(asCoded("ERR_VOICE_LOAD", t))
        }
      }
    }

    AsyncFunction("unloadVoice") { promise: Promise ->
      ttsExecutor.execute {
        cancelPlayback()
        tts?.release()
        tts = null
        loadedVoiceId = null
        promise.resolve(null)
      }
    }

    Function("getLoadedVoiceId") { loadedVoiceId }

    /**
     * Speak text through the loaded voice. Resolves once playback has
     * STARTED (first synthesized chunk hits the AudioTrack) with the
     * measured first-audio latency — the design §6 "< ~1s" number. Playback
     * completion is signaled via onSpeakingStateChanged.
     */
    AsyncFunction("speak") { text: String, rate: Double, promise: Promise ->
      val engine = tts
      if (engine == null) {
        promise.reject(CodedException("ERR_NO_VOICE", "no voice loaded", null))
        return@AsyncFunction
      }
      val myId = utteranceSeq.incrementAndGet()
      cancelPlayback() // halt whatever was speaking; new utterance owns audio out

      ttsExecutor.execute {
        if (utteranceSeq.get() != myId) {
          promise.resolve(mapOf("started" to false, "cancelled" to true))
          return@execute
        }
        var track: AudioTrack? = null
        var totalFrames = 0L
        var resolved = false
        val t0 = SystemClock.elapsedRealtime()
        try {
          engine.generateWithCallback(
            text = text,
            sid = 0,
            speed = rate.toFloat(),
          ) { samples ->
            if (utteranceSeq.get() != myId) return@generateWithCallback 0
            if (track == null) {
              track = buildTrack(engine.sampleRate()).also { it.play() }
              activeTrack = track
              sendEvent("onSpeakingStateChanged", mapOf("speaking" to true))
              if (!resolved) {
                resolved = true
                promise.resolve(
                  mapOf(
                    "started" to true,
                    "firstAudioMs" to (SystemClock.elapsedRealtime() - t0),
                  ),
                )
              }
            }
            // Write in small slices with cancellation checks between them so
            // a stop() (pause+flush from another thread) can never leave a
            // blocking write stuck against a paused, full buffer.
            val t = track!!
            var off = 0
            while (off < samples.size) {
              if (utteranceSeq.get() != myId) return@generateWithCallback 0
              val n = min(2048, samples.size - off)
              val written = t.write(samples, off, n, AudioTrack.WRITE_BLOCKING)
              if (written < 0) return@generateWithCallback 0
              off += written
            }
            totalFrames += samples.size
            if (utteranceSeq.get() == myId) 1 else 0
          }

          if (track == null) {
            // Nothing synthesizable (empty/whitespace text) — never spoke.
            if (!resolved) {
              resolved = true
              promise.resolve(mapOf("started" to false, "cancelled" to false))
            }
          } else {
            // Drain: generation is done, wait for the buffer to play out.
            val t = track!!
            while (utteranceSeq.get() == myId && t.playbackHeadPosition < totalFrames) {
              SystemClock.sleep(40)
            }
          }
        } catch (t: Throwable) {
          if (!resolved) {
            resolved = true
            promise.reject(asCoded("ERR_TTS_SPEAK", t))
          }
        } finally {
          track?.let { doomed ->
            runCatching {
              doomed.pause()
              doomed.flush()
              doomed.release()
            }
            if (activeTrack === doomed) activeTrack = null
          }
          sendEvent("onSpeakingStateChanged", mapOf("speaking" to false))
        }
      }
    }

    /** Immediate halt of any in-progress speech. Safe to call anytime. */
    Function("stop") {
      utteranceSeq.incrementAndGet()
      cancelPlayback()
    }

    /**
     * Render text to a WAV file (sherpa's native writer). For caching
     * repeat plays and future readback features (T15).
     */
    AsyncFunction("synthesizeToFile") { text: String, rate: Double, outPath: String, promise: Promise ->
      val engine = tts
      if (engine == null) {
        promise.reject(CodedException("ERR_NO_VOICE", "no voice loaded", null))
        return@AsyncFunction
      }
      ttsExecutor.execute {
        try {
          val dest = File(stripFileUri(outPath))
          dest.parentFile?.mkdirs()
          val t0 = SystemClock.elapsedRealtime()
          val audio = engine.generate(text = text, sid = 0, speed = rate.toFloat())
          val synthMs = SystemClock.elapsedRealtime() - t0
          if (audio.samples.isEmpty()) {
            throw CodedException("ERR_TTS_EMPTY", "synthesis produced no audio", null)
          }
          audio.save(dest.absolutePath)
          promise.resolve(
            mapOf(
              "path" to dest.absolutePath,
              "sampleRate" to audio.sampleRate,
              "durationMs" to audio.samples.size * 1000L / audio.sampleRate,
              "synthMs" to synthMs,
            ),
          )
        } catch (t: Throwable) {
          promise.reject(asCoded("ERR_TTS_SYNTH", t))
        }
      }
    }

    // ---- ASR (T12, design §6) ----

    /**
     * Load the offline Zipformer transducer recognizer. Same contract as
     * loadVoice: resolves with load time, same-id reload is a no-op, one
     * recognizer at a time.
     */
    AsyncFunction("loadAsr") { asrId: String, encoderPath: String, decoderPath: String, joinerPath: String, tokensPath: String, promise: Promise ->
      asrExecutor.execute {
        try {
          if (loadedAsrId == asrId && asr != null) {
            promise.resolve(mapOf("loadMs" to 0, "alreadyLoaded" to true))
            return@execute
          }
          asr?.release()
          asr = null
          loadedAsrId = null

          val encoder = File(stripFileUri(encoderPath))
          val decoder = File(stripFileUri(decoderPath))
          val joiner = File(stripFileUri(joinerPath))
          val tokens = File(stripFileUri(tokensPath))
          if (!encoder.isFile || !decoder.isFile || !joiner.isFile || !tokens.isFile) {
            throw CodedException("ERR_ASR_FILES", "ASR model files missing for $asrId", null)
          }

          val t0 = SystemClock.elapsedRealtime()
          val config = OfflineRecognizerConfig(
            featConfig = FeatureConfig(sampleRate = 16000, featureDim = 80),
            modelConfig = OfflineModelConfig(
              transducer = OfflineTransducerModelConfig(
                encoder = encoder.absolutePath,
                decoder = decoder.absolutePath,
                joiner = joiner.absolutePath,
              ),
              tokens = tokens.absolutePath,
              numThreads = 2,
              debug = false,
              provider = "cpu",
              modelType = "transducer",
            ),
            // greedy_search is the mode that emits per-token timestamps.
            decodingMethod = "greedy_search",
          )
          asr = OfflineRecognizer(config = config)
          loadedAsrId = asrId
          promise.resolve(
            mapOf("loadMs" to (SystemClock.elapsedRealtime() - t0), "alreadyLoaded" to false),
          )
        } catch (t: Throwable) {
          promise.reject(asCoded("ERR_ASR_LOAD", t))
        }
      }
    }

    AsyncFunction("unloadAsr") { promise: Promise ->
      asrExecutor.execute {
        asr?.release()
        asr = null
        loadedAsrId = null
        promise.resolve(null)
      }
    }

    Function("getLoadedAsrId") { loadedAsrId }

    /**
     * Transcribe a mono PCM16 WAV file. Returns the raw transcript plus
     * word-level timings aggregated from the recognizer's BPE-token
     * timestamps (a token starting with "▁"/" " begins a new word), and the
     * measured decode time — the design §6 "< ~2s" latency number.
     */
    AsyncFunction("transcribeFile") { wavPath: String, promise: Promise ->
      val engine = asr
      if (engine == null) {
        promise.reject(CodedException("ERR_NO_ASR", "no ASR model loaded", null))
        return@AsyncFunction
      }
      asrExecutor.execute {
        try {
          val (samples, sampleRate) = readWavMono(File(stripFileUri(wavPath)))
          val audioMs = samples.size * 1000L / sampleRate
          val t0 = SystemClock.elapsedRealtime()
          val stream = engine.createStream()
          try {
            stream.acceptWaveform(samples, sampleRate)
            engine.decode(stream)
            val result = engine.getResult(stream)
            val decodeMs = SystemClock.elapsedRealtime() - t0
            promise.resolve(
              mapOf(
                "text" to result.text,
                "words" to aggregateWords(result.tokens, result.timestamps, audioMs),
                "decodeMs" to decodeMs,
                "audioMs" to audioMs,
              ),
            )
          } finally {
            stream.release()
          }
        } catch (t: Throwable) {
          promise.reject(asCoded("ERR_ASR_TRANSCRIBE", t))
        }
      }
    }

    // ---- Whisper assist recognizer (T59, design §11) ----

    /**
     * Load the Whisper multilingual assist recognizer from extracted model
     * files (int8 encoder + decoder + tokens). Independent of the Zipformer:
     * both recognizers may be resident at once (memory is the caller's
     * budget — the T59 benchmark records it). Same contract as loadAsr:
     * resolves with load time, same-id reload is a no-op.
     */
    AsyncFunction("loadWhisper") { assistId: String, encoderPath: String, decoderPath: String, tokensPath: String, promise: Promise ->
      asrExecutor.execute {
        try {
          if (loadedWhisperId == assistId && whisper != null) {
            promise.resolve(mapOf("loadMs" to 0, "alreadyLoaded" to true))
            return@execute
          }
          whisper?.release()
          whisper = null
          loadedWhisperId = null

          val files = WhisperFiles(
            encoder = File(stripFileUri(encoderPath)),
            decoder = File(stripFileUri(decoderPath)),
            tokens = File(stripFileUri(tokensPath)),
          )
          if (!files.encoder.isFile || !files.decoder.isFile || !files.tokens.isFile) {
            throw CodedException("ERR_WHISPER_FILES", "Whisper model files missing for $assistId", null)
          }

          val t0 = SystemClock.elapsedRealtime()
          whisperFiles = files
          whisperLanguage = "en"
          whisper = buildWhisper(files, whisperLanguage)
          loadedWhisperId = assistId
          promise.resolve(
            mapOf("loadMs" to (SystemClock.elapsedRealtime() - t0), "alreadyLoaded" to false),
          )
        } catch (t: Throwable) {
          promise.reject(asCoded("ERR_WHISPER_LOAD", t))
        }
      }
    }

    AsyncFunction("unloadWhisper") { promise: Promise ->
      asrExecutor.execute {
        whisper?.release()
        whisper = null
        loadedWhisperId = null
        whisperFiles = null
        promise.resolve(null)
      }
    }

    Function("getLoadedWhisperId") { loadedWhisperId }

    /**
     * Transcribe a mono PCM16 WAV with the Whisper assist recognizer.
     * `language` is 'en' | 'ru' | 'auto' (auto = Whisper's own detection).
     * Whisper's language lives in the recognizer config, so a language
     * different from the resident one rebuilds the recognizer in place
     * (~0.5–1 s for tiny) — T60 only ever asks for 'en', so this is the
     * rare path. Returns the same shape as transcribeFile; Whisper emits no
     * per-token timestamps here, so word spans degrade to [start, audioEnd].
     */
    AsyncFunction("transcribeWhisper") { wavPath: String, language: String, promise: Promise ->
      if (whisper == null) {
        promise.reject(CodedException("ERR_NO_WHISPER", "no Whisper model loaded", null))
        return@AsyncFunction
      }
      asrExecutor.execute {
        try {
          val wanted = when (language) {
            "en", "ru" -> language
            "auto" -> ""
            else -> throw CodedException("ERR_WHISPER_LANGUAGE", "unsupported language: $language", null)
          }
          var engine = whisper ?: throw CodedException("ERR_NO_WHISPER", "no Whisper model loaded", null)
          if (wanted != whisperLanguage) {
            val files = whisperFiles ?: throw CodedException("ERR_NO_WHISPER", "no Whisper model loaded", null)
            engine.release()
            whisper = null
            engine = buildWhisper(files, wanted)
            whisper = engine
            whisperLanguage = wanted
          }
          val (samples, sampleRate) = readWavMono(File(stripFileUri(wavPath)))
          val audioMs = samples.size * 1000L / sampleRate
          val t0 = SystemClock.elapsedRealtime()
          val stream = engine.createStream()
          try {
            stream.acceptWaveform(samples, sampleRate)
            engine.decode(stream)
            val result = engine.getResult(stream)
            val decodeMs = SystemClock.elapsedRealtime() - t0
            promise.resolve(
              mapOf(
                "text" to result.text.trim(),
                "words" to aggregateWords(result.tokens, result.timestamps, audioMs),
                "decodeMs" to decodeMs,
                "audioMs" to audioMs,
              ),
            )
          } finally {
            stream.release()
          }
        } catch (t: Throwable) {
          promise.reject(asCoded("ERR_WHISPER_TRANSCRIBE", t))
        }
      }
    }

    // ---- Ogg/Opus transcoder (T59, design §11 + ADR-0019 decision 7) ----

    /**
     * Transcode a PCM16 WAV (the T12 attempt format) to Ogg/Opus with the
     * platform MediaCodec encoder + MediaMuxer's OGG writer (API 29+ — no
     * new dependency). Runs on the I/O executor so a transcode never queues
     * behind a decode. Rejects `ERR_OPUS_UNSUPPORTED` when the platform has
     * no Opus encoder (the JS wrapper maps it to `code: 'unsupported'` and
     * the app keeps WAV, design §12).
     */
    AsyncFunction("encodeWavToOpus") { wavPath: String, outPath: String, bitrateKbps: Int, promise: Promise ->
      ioExecutor.execute {
        try {
          promise.resolve(
            encodeWavToOpus(File(stripFileUri(wavPath)), File(stripFileUri(outPath)), bitrateKbps),
          )
        } catch (t: Throwable) {
          promise.reject(asCoded("ERR_OPUS_ENCODE", t))
        }
      }
    }

    // ---- mic capture (T12): AudioRecord → 16 kHz mono PCM16 WAV ----

    /**
     * Start recording the mic to a WAV file. Requires RECORD_AUDIO to be
     * granted already (the JS side owns the permission flow); without it the
     * AudioRecord fails to initialize and this rejects. Emits
     * onRecordingLevel (~8/s) so the UI can show input level.
     */
    AsyncFunction("startRecording") { outPath: String, promise: Promise ->
      synchronized(recordingLock) {
        if (recordingActive) {
          promise.reject(CodedException("ERR_RECORDING", "already recording", null))
          return@AsyncFunction
        }
        val dest = File(stripFileUri(outPath))
        dest.parentFile?.mkdirs()

        val sampleRate = 16000
        val minBuf = AudioRecord.getMinBufferSize(
          sampleRate,
          AudioFormat.CHANNEL_IN_MONO,
          AudioFormat.ENCODING_PCM_16BIT,
        )
        val rec = try {
          AudioRecord(
            MediaRecorder.AudioSource.MIC,
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            maxOf(minBuf * 2, 32 * 1024),
          )
        } catch (t: Throwable) {
          promise.reject(asCoded("ERR_MIC", t))
          return@AsyncFunction
        }
        if (rec.state != AudioRecord.STATE_INITIALIZED) {
          rec.release()
          promise.reject(
            CodedException("ERR_MIC", "microphone unavailable (permission not granted?)", null),
          )
          return@AsyncFunction
        }

        recordingActive = true
        recordingFile = dest
        audioRecord = rec

        val thread = Thread({
          val startedAt = SystemClock.elapsedRealtime()
          var lastLevelAt = 0L
          try {
            FileOutputStream(dest).use { out ->
              out.write(wavHeader(sampleRate, 0)) // placeholder, patched on stop
              val shorts = ShortArray(2048)
              val bytes = ByteArray(shorts.size * 2)
              while (recordingActive) {
                val n = rec.read(shorts, 0, shorts.size)
                if (n <= 0) continue
                var sumSq = 0.0
                for (i in 0 until n) {
                  val s = shorts[i]
                  bytes[i * 2] = (s.toInt() and 0xFF).toByte()
                  bytes[i * 2 + 1] = ((s.toInt() shr 8) and 0xFF).toByte()
                  sumSq += s.toDouble() * s.toDouble()
                }
                out.write(bytes, 0, n * 2)
                val now = SystemClock.elapsedRealtime()
                if (now - lastLevelAt >= 120) {
                  lastLevelAt = now
                  val rms = sqrt(sumSq / n) / 32768.0
                  sendEvent(
                    "onRecordingLevel",
                    mapOf("level" to rms, "elapsedMs" to (now - startedAt)),
                  )
                }
              }
            }
          } catch (_: Throwable) {
            // Writer died (disk full / race with cancel): stopRecording will
            // surface a short/empty file; nothing useful to do here.
          }
        }, "SherpaMic")
        recordingThread = thread
        rec.startRecording()
        thread.start()
        promise.resolve(null)
      }
    }

    /** Stop recording, finalize the WAV header, return {path, durationMs}. */
    AsyncFunction("stopRecording") { promise: Promise ->
      ioExecutor.execute {
        try {
          val file = finishRecording(deleteFile = false)
            ?: throw CodedException("ERR_NOT_RECORDING", "no recording in progress", null)
          val dataBytes = file.length() - 44
          val durationMs = if (dataBytes > 0) dataBytes * 1000L / (16000L * 2L) else 0L
          promise.resolve(mapOf("path" to file.absolutePath, "durationMs" to durationMs))
        } catch (t: Throwable) {
          promise.reject(asCoded("ERR_RECORD_STOP", t))
        }
      }
    }

    /** Abort recording and delete the partial file. Idempotent. */
    AsyncFunction("cancelRecording") { promise: Promise ->
      ioExecutor.execute {
        finishRecording(deleteFile = true)
        promise.resolve(null)
      }
    }

    // ---- model-manager helpers (T07-style verified downloads need these) ----

    /** Streaming SHA-256 of a file — model archives are ~67 MB, never read them into JS memory. */
    AsyncFunction("sha256File") { path: String, promise: Promise ->
      ioExecutor.execute {
        try {
          val digest = MessageDigest.getInstance("SHA-256")
          FileInputStream(File(stripFileUri(path))).use { input ->
            val buf = ByteArray(256 * 1024)
            while (true) {
              val n = input.read(buf)
              if (n < 0) break
              digest.update(buf, 0, n)
            }
          }
          promise.resolve(digest.digest().joinToString("") { "%02x".format(it) })
        } catch (t: Throwable) {
          promise.reject(asCoded("ERR_SHA256", t))
        }
      }
    }

    /**
     * Extract a .tar.bz2 archive into destDir. Returns the archive's single
     * top-level directory name (Piper archives have exactly one) and total
     * bytes written. Entry paths are sanitized against traversal.
     */
    AsyncFunction("extractTarBz2") { archivePath: String, destDir: String, promise: Promise ->
      ioExecutor.execute {
        try {
          val dest = File(stripFileUri(destDir))
          dest.mkdirs()
          val destCanonical = dest.canonicalPath
          var totalBytes = 0L
          var rootDir: String? = null

          TarArchiveInputStream(
            BZip2CompressorInputStream(
              BufferedInputStream(FileInputStream(File(stripFileUri(archivePath)))),
            ),
          ).use { tar ->
            while (true) {
              val entry = tar.nextEntry ?: break
              val out = File(dest, entry.name)
              if (!out.canonicalPath.startsWith(destCanonical + File.separator)) {
                throw CodedException("ERR_EXTRACT", "archive entry escapes destination: ${entry.name}", null)
              }
              if (rootDir == null) {
                rootDir = entry.name.trimStart('/').substringBefore('/')
              }
              if (entry.isDirectory) {
                out.mkdirs()
              } else {
                out.parentFile?.mkdirs()
                out.outputStream().use { os ->
                  val buf = ByteArray(256 * 1024)
                  while (true) {
                    val n = tar.read(buf)
                    if (n < 0) break
                    os.write(buf, 0, n)
                    totalBytes += n
                  }
                }
              }
            }
          }
          promise.resolve(mapOf("rootDir" to rootDir, "bytes" to totalBytes))
        } catch (t: Throwable) {
          promise.reject(asCoded("ERR_EXTRACT", t))
        }
      }
    }

    /** Recursive directory size in bytes (storage accounting for Settings). */
    AsyncFunction("dirSize") { path: String, promise: Promise ->
      ioExecutor.execute {
        try {
          promise.resolve(sizeOf(File(stripFileUri(path))))
        } catch (t: Throwable) {
          promise.reject(asCoded("ERR_DIR_SIZE", t))
        }
      }
    }

    OnDestroy {
      utteranceSeq.incrementAndGet()
      cancelPlayback()
      finishRecording(deleteFile = true)
      ttsExecutor.execute {
        tts?.release()
        tts = null
      }
      asrExecutor.execute {
        asr?.release()
        asr = null
        whisper?.release()
        whisper = null
      }
      ttsExecutor.shutdown()
      asrExecutor.shutdown()
      ioExecutor.shutdown()
    }
  }

  /**
   * Common teardown for stop/cancel/destroy: halt the AudioRecord, join the
   * writer thread, patch the WAV header (or delete the file). Returns the
   * finalized file, or null if nothing was recording.
   */
  private fun finishRecording(deleteFile: Boolean): File? {
    val rec: AudioRecord?
    val thread: Thread?
    val file: File?
    synchronized(recordingLock) {
      if (!recordingActive && recordingFile == null) return null
      recordingActive = false
      rec = audioRecord
      thread = recordingThread
      file = recordingFile
      audioRecord = null
      recordingThread = null
      recordingFile = null
    }
    thread?.join(2000)
    runCatching {
      rec?.stop()
      rec?.release()
    }
    if (file == null) return null
    if (deleteFile) {
      runCatching { file.delete() }
      return null
    }
    // Patch RIFF/data sizes now that the byte count is known.
    runCatching {
      RandomAccessFile(file, "rw").use { raf ->
        val dataBytes = (raf.length() - 44).coerceAtLeast(0)
        raf.seek(0)
        raf.write(wavHeader(16000, dataBytes.toInt()))
      }
    }
    return file
  }

  /** 44-byte canonical PCM16 mono WAV header. */
  private fun wavHeader(sampleRate: Int, dataBytes: Int): ByteArray {
    val buf = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
    buf.put("RIFF".toByteArray(Charsets.US_ASCII))
    buf.putInt(36 + dataBytes)
    buf.put("WAVE".toByteArray(Charsets.US_ASCII))
    buf.put("fmt ".toByteArray(Charsets.US_ASCII))
    buf.putInt(16) // PCM fmt chunk size
    buf.putShort(1) // PCM
    buf.putShort(1) // mono
    buf.putInt(sampleRate)
    buf.putInt(sampleRate * 2) // byte rate
    buf.putShort(2) // block align
    buf.putShort(16) // bits per sample
    buf.put("data".toByteArray(Charsets.US_ASCII))
    buf.putInt(dataBytes)
    return buf.array()
  }

  /**
   * Whisper recognizer over sherpa's OfflineRecognizer. `language` "" =
   * auto-detect. task is always transcribe (never translate — the app wants
   * the English word the learner said, not a Russian rendering of it);
   * tailPaddings -1 = sherpa's default. 4 threads: decode latency is the
   * number T60's «как сказать» path lives with, and the ASR executor
   * serializes decodes so the Zipformer never contends with it.
   */
  private fun buildWhisper(files: WhisperFiles, language: String): OfflineRecognizer {
    val config = OfflineRecognizerConfig(
      featConfig = FeatureConfig(sampleRate = 16000, featureDim = 80),
      modelConfig = OfflineModelConfig(
        whisper = OfflineWhisperModelConfig(
          encoder = files.encoder.absolutePath,
          decoder = files.decoder.absolutePath,
          language = language,
          task = "transcribe",
          tailPaddings = -1,
        ),
        tokens = files.tokens.absolutePath,
        numThreads = 4,
        debug = false,
        provider = "cpu",
        modelType = "whisper",
      ),
      decodingMethod = "greedy_search",
    )
    return OfflineRecognizer(config = config)
  }

  /**
   * WAV → Ogg/Opus. The WAV's own sample rate is offered to the encoder
   * (16 kHz for T12 attempts; Opus natively accepts 8/12/16/24/48 kHz — a
   * rate outside that set is rejected as unsupported rather than resampled
   * here). Feeds 20 ms frames, muxes packets as they come, returns the
   * ticket's {bytes, durationMs, ms}.
   */
  private fun encodeWavToOpus(wav: File, out: File, bitrateKbps: Int): Map<String, Any> {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      throw CodedException("ERR_OPUS_UNSUPPORTED", "Ogg/Opus muxing needs Android 10+", null)
    }
    val (samples, sampleRate) = readWavMono(wav)
    if (samples.isEmpty()) throw CodedException("ERR_OPUS_EMPTY", "WAV has no samples", null)
    if (sampleRate !in intArrayOf(8000, 12000, 16000, 24000, 48000)) {
      throw CodedException("ERR_OPUS_UNSUPPORTED", "Opus cannot take a $sampleRate Hz input", null)
    }
    val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_OPUS, sampleRate, 1).apply {
      setInteger(MediaFormat.KEY_BIT_RATE, bitrateKbps.coerceIn(6, 128) * 1000)
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024)
    }
    val codecName = MediaCodecList(MediaCodecList.REGULAR_CODECS).findEncoderForFormat(format)
      ?: throw CodedException("ERR_OPUS_UNSUPPORTED", "no Opus encoder on this device", null)

    val t0 = SystemClock.elapsedRealtime()
    out.parentFile?.mkdirs()
    if (out.exists()) out.delete()
    val codec = MediaCodec.createByCodecName(codecName)
    var muxer: MediaMuxer? = null
    var muxStarted = false
    try {
      codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      codec.start()
      muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_OGG)
      var track = -1
      val frame = sampleRate / 50 // 20 ms — the Opus frame the encoder wants
      var pos = 0
      var inputDone = false
      var outputDone = false
      val info = MediaCodec.BufferInfo()
      while (!outputDone) {
        if (!inputDone) {
          val idx = codec.dequeueInputBuffer(10_000)
          if (idx >= 0) {
            val buf = codec.getInputBuffer(idx)!!
            buf.clear()
            buf.order(ByteOrder.LITTLE_ENDIAN)
            val n = min(min(frame, samples.size - pos), buf.capacity() / 2)
            val ptsUs = pos * 1_000_000L / sampleRate
            if (n <= 0) {
              codec.queueInputBuffer(idx, 0, 0, ptsUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              for (i in 0 until n) {
                val v = (samples[pos + i] * 32768f).toInt().coerceIn(-32768, 32767)
                buf.putShort(v.toShort())
              }
              codec.queueInputBuffer(idx, 0, n * 2, ptsUs, 0)
              pos += n
            }
          }
        }
        val oi = codec.dequeueOutputBuffer(info, 10_000)
        when {
          oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            // The OGG muxer needs Opus's CSD (OpusHead etc.) — it rides in
            // this output format, so the track is added only now.
            track = muxer.addTrack(codec.outputFormat)
            muxer.start()
            muxStarted = true
          }
          oi >= 0 -> {
            val ob = codec.getOutputBuffer(oi)!!
            val isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
            if (!isConfig && info.size > 0 && muxStarted) {
              ob.position(info.offset)
              ob.limit(info.offset + info.size)
              muxer.writeSampleData(track, ob, info)
            }
            codec.releaseOutputBuffer(oi, false)
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
          }
        }
      }
      if (!muxStarted) throw CodedException("ERR_OPUS_ENCODE", "encoder produced no output", null)
    } catch (t: Throwable) {
      runCatching { out.delete() }
      throw t
    } finally {
      runCatching { codec.stop() }
      codec.release()
      muxer?.let { m ->
        if (muxStarted) runCatching { m.stop() }
        m.release()
      }
    }
    return mapOf(
      "bytes" to out.length(),
      "durationMs" to samples.size * 1000L / sampleRate,
      "ms" to (SystemClock.elapsedRealtime() - t0),
    )
  }

  /** Minimal RIFF parser: mono/stereo PCM16 WAV → float samples + rate. */
  private fun readWavMono(file: File): Pair<FloatArray, Int> {
    if (!file.isFile) throw CodedException("ERR_WAV", "no such file: ${file.path}", null)
    val bytes = file.readBytes()
    if (bytes.size < 44) throw CodedException("ERR_WAV", "not a WAV file (too short)", null)
    val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    fun fourCC(): String {
      val b = ByteArray(4)
      buf.get(b)
      return String(b, Charsets.US_ASCII)
    }
    if (fourCC() != "RIFF") throw CodedException("ERR_WAV", "not a RIFF file", null)
    buf.int // riff size
    if (fourCC() != "WAVE") throw CodedException("ERR_WAV", "not a WAVE file", null)

    var channels = 0
    var sampleRate = 0
    var bitsPerSample = 0
    var dataOffset = -1
    var dataSize = 0
    while (buf.remaining() >= 8) {
      val id = fourCC()
      val size = buf.int
      when (id) {
        "fmt " -> {
          val audioFormat = buf.short.toInt()
          channels = buf.short.toInt()
          sampleRate = buf.int
          buf.int // byte rate
          buf.short // block align
          bitsPerSample = buf.short.toInt()
          if (size > 16) buf.position(buf.position() + size - 16)
          if (audioFormat != 1) throw CodedException("ERR_WAV", "only PCM WAV supported", null)
        }
        "data" -> {
          dataOffset = buf.position()
          dataSize = min(size, buf.remaining())
          buf.position(buf.position() + dataSize)
        }
        else -> buf.position(buf.position() + min(size + (size and 1), buf.remaining()))
      }
    }
    if (dataOffset < 0 || sampleRate == 0) {
      throw CodedException("ERR_WAV", "malformed WAV (missing fmt/data)", null)
    }
    if (bitsPerSample != 16 || channels !in 1..2) {
      throw CodedException("ERR_WAV", "expected 16-bit mono/stereo PCM", null)
    }
    val data = ByteBuffer.wrap(bytes, dataOffset, dataSize).order(ByteOrder.LITTLE_ENDIAN)
    val frameCount = dataSize / (2 * channels)
    val samples = FloatArray(frameCount)
    for (i in 0 until frameCount) {
      var acc = 0f
      for (c in 0 until channels) acc += data.short / 32768f
      samples[i] = acc / channels
    }
    return Pair(samples, sampleRate)
  }

  /**
   * BPE tokens + per-token timestamps → word list. A token beginning with
   * "▁" (or " ") starts a new word; a word's end is the next word's start
   * (or end of audio) — approximate, but scoring only needs the text.
   */
  private fun aggregateWords(
    tokens: Array<String>,
    timestamps: FloatArray,
    audioMs: Long,
  ): List<Map<String, Any>> {
    data class W(val text: StringBuilder, val startMs: Long)
    val words = mutableListOf<W>()
    for (i in tokens.indices) {
      val raw = tokens[i]
      val isBoundary = raw.startsWith("▁") || raw.startsWith(" ")
      val text = raw.trimStart('▁', ' ')
      if (text.isEmpty()) continue
      val ts = if (i < timestamps.size) (timestamps[i] * 1000).toLong() else audioMs
      if (isBoundary || words.isEmpty()) {
        words.add(W(StringBuilder(text), ts))
      } else {
        words.last().text.append(text)
      }
    }
    return words.mapIndexed { i, w ->
      val end = if (i + 1 < words.size) words[i + 1].startMs else audioMs
      mapOf(
        "word" to w.text.toString(),
        "startMs" to w.startMs,
        "endMs" to maxOf(end, w.startMs + 40),
      )
    }
  }

  /** Halt audio output NOW (called from the module queue while the executor may be mid-write). */
  private fun cancelPlayback() {
    activeTrack?.let {
      runCatching {
        it.pause()
        it.flush()
      }
    }
  }

  private fun buildTrack(sampleRate: Int): AudioTrack {
    val minBuf = AudioTrack.getMinBufferSize(
      sampleRate,
      AudioFormat.CHANNEL_OUT_MONO,
      AudioFormat.ENCODING_PCM_FLOAT,
    )
    return AudioTrack.Builder()
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build(),
      )
      .setAudioFormat(
        AudioFormat.Builder()
          .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
          .setSampleRate(sampleRate)
          .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .build(),
      )
      .setBufferSizeInBytes(minBuf * 4)
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
  }

  private fun sizeOf(file: File): Long {
    if (file.isFile) return file.length()
    if (!file.isDirectory) return 0L
    var total = 0L
    file.listFiles()?.forEach { total += sizeOf(it) }
    return total
  }

  private fun stripFileUri(path: String): String =
    if (path.startsWith("file://")) path.removePrefix("file://") else path

  private fun asCoded(code: String, t: Throwable): CodedException =
    if (t is CodedException) t else CodedException(code, t.message ?: t.javaClass.simpleName, t)
}
