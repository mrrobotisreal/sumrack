package expo.modules.sherpaspeech

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.SystemClock
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.min

/**
 * Sumrak's sherpa-onnx speech module (T11, design §6): Piper Russian VITS
 * TTS. One voice is loaded at a time; `speak` streams synthesis chunks to an
 * AudioTrack as they are generated (so first audio arrives well before the
 * full sentence is synthesized), `synthesizeToFile` renders a WAV for
 * caching. The module also carries the model-manager helpers that need
 * native muscle: streaming SHA-256, .tar.bz2 extraction, directory sizing.
 *
 * ASR lands in this same module in T12 — keep TTS and future ASR state
 * separate.
 */
class SherpaSpeechModule : Module() {
  /** Serializes all TTS work (load/speak/synthesize) — sherpa's OfflineTts is not thread-safe. */
  private val ttsExecutor = Executors.newSingleThreadExecutor { r -> Thread(r, "SherpaTts") }

  /** Model-manager I/O (hashing, extraction) must not block or be blocked by speech. */
  private val ioExecutor = Executors.newSingleThreadExecutor { r -> Thread(r, "SherpaIo") }

  @Volatile private var tts: OfflineTts? = null
  @Volatile private var loadedVoiceId: String? = null

  /**
   * Monotonic utterance id: bumping it is the cancellation signal every
   * in-flight generation callback and drain loop checks. `stop()` and each
   * new `speak()` bump it.
   */
  private val utteranceSeq = AtomicLong(0)

  @Volatile private var activeTrack: AudioTrack? = null

  override fun definition() = ModuleDefinition {
    Name("SherpaSpeech")

    Events("onSpeakingStateChanged")

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
      ttsExecutor.execute {
        tts?.release()
        tts = null
      }
      ttsExecutor.shutdown()
      ioExecutor.shutdown()
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
