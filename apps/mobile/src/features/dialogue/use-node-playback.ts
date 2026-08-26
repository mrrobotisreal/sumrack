import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { File } from 'expo-file-system';
import * as React from 'react';

import type { DialogueGraphNode, DialogueNodeStampRow } from '@/db/repositories/dialogues';
import { activeWordAt, buildKaraokeIndex, type KaraokeIndex } from '@/features/reader/karaoke';
import { track } from '@/services/analytics';
import { getSpeechService, speak } from '@/services/speech';

/**
 * Per-line audio + karaoke for the dialogue player (T27): each node line is
 * one small Opus file (T26 tables), played on arrival with a word-level
 * highlight driven by the node's stamps through the pure T10 karaoke index —
 * a one-sentence index per line, deliberately NOT the reader's audio-bar
 * machinery.
 *
 * Degradation (V2 offline principles): no staged audio (or the file is
 * gone) ⇒ the line is spoken via the speech service (Piper → system TTS)
 * and playback reports `unavailable` — the screen shows a manual «Далее»
 * instead of guessing TTS duration. No karaoke without real timing; a line
 * with audio but no stamps gets the sentence-level wash (`sentence` mode).
 *
 * State discipline: the per-step *initial* status is derived in render
 * (node/audio presence); the only setState calls live in external callbacks
 * (player status listener, karaoke interval, replay press) — all keyed by
 * `stepKey` so a step change needs no reset writes at all.
 */

const KARAOKE_TICK_MS = 120;

export type NodePlaybackStatus = 'idle' | 'playing' | 'done' | 'unavailable';

export interface NodePlayback {
  status: NodePlaybackStatus;
  /** Active word's tokenIndex on the current line (word mode only). */
  karaokeTokenIndex: number | null;
  /** True while playing a stamp-less audio line (sentence-wash treatment). */
  sentenceWash: boolean;
  /** Replay the current line (audio seek-to-0, or re-speak the fallback). */
  replay: () => void;
}

function fileExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

export function useNodePlayback(
  node: DialogueGraphNode | null,
  stamps: DialogueNodeStampRow[] | undefined,
  onLineDone: () => void,
  /** Changes once per walk step — remounts playback even on a revisited node. */
  stepKey: string,
): NodePlayback {
  // Overrides written only by external callbacks; stale keys are ignored.
  const [statusOverride, setStatusOverride] = React.useState<{
    key: string;
    status: NodePlaybackStatus;
  } | null>(null);
  const [karaoke, setKaraoke] = React.useState<{ key: string; tokenIndex: number | null } | null>(
    null,
  );
  const playerRef = React.useRef<AudioPlayer | null>(null);
  const indexRef = React.useRef<KaraokeIndex | null>(null);
  const onDoneRef = React.useRef(onLineDone);
  React.useEffect(() => {
    onDoneRef.current = onLineDone;
  }, [onLineDone]);

  const playable = node?.audio?.localUri != null && fileExists(node.audio.localUri);
  const initialStatus: NodePlaybackStatus = !node ? 'idle' : playable ? 'playing' : 'unavailable';
  const status = statusOverride?.key === stepKey ? statusOverride.status : initialStatus;

  // The one-line karaoke index; stamps arrive async and slot in mid-play.
  React.useEffect(() => {
    if (!node?.sentence || !node.audio) {
      indexRef.current = null;
      return;
    }
    indexRef.current = buildKaraokeIndex(
      [{ id: node.sentence.id, ru: node.sentence.ru }],
      (stamps ?? []).map((s) => ({
        sentenceId: s.sentenceId,
        tokenIndex: s.tokenIndex,
        startMs: s.startMs,
        endMs: s.endMs,
      })),
      node.audio.durationMs,
    );
  }, [node, stamps]);

  React.useEffect(() => {
    if (!node) return;
    const uri = node.audio?.localUri;
    if (!uri || !fileExists(uri)) {
      // Missing audio: speak the line, hand pacing to the screen (Далее).
      if (node.sentence?.ru) void speak(node.sentence.ru);
      return () => {
        void getSpeechService().stop();
      };
    }

    let released = false;
    let player: AudioPlayer;
    try {
      player = createAudioPlayer({ uri }, { updateInterval: 250 });
    } catch {
      if (node.sentence?.ru) void speak(node.sentence.ru);
      // Rare failure path (player creation threw): flip to the fallback
      // state on the next tick — never a synchronous set inside the effect.
      const t = setTimeout(() => setStatusOverride({ key: stepKey, status: 'unavailable' }), 0);
      return () => clearTimeout(t);
    }
    playerRef.current = player;
    const sub = player.addListener('playbackStatusUpdate', (s) => {
      if (released) return;
      if (s.didJustFinish) {
        setStatusOverride({ key: stepKey, status: 'done' });
        setKaraoke({ key: stepKey, tokenIndex: null });
        onDoneRef.current();
      }
    });
    player.play();

    const tick = setInterval(() => {
      if (released) return;
      const index = indexRef.current;
      if (!index || index.mode !== 'word') return;
      const active = activeWordAt(index, Math.round(player.currentTime * 1000));
      setKaraoke((prev) => {
        const tokenIndex = active ? active.tokenIndex : null;
        if (prev?.key === stepKey && prev.tokenIndex === tokenIndex) return prev;
        return { key: stepKey, tokenIndex };
      });
    }, KARAOKE_TICK_MS);

    return () => {
      released = true;
      clearInterval(tick);
      sub.remove();
      player.release();
      playerRef.current = null;
    };
    // stepKey is the deliberate dependency: one playback per walk step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);

  const replay = React.useCallback(() => {
    track('dialogue_line_replayed', { hasAudio: playerRef.current != null });
    const player = playerRef.current;
    if (!player) {
      const ru = node?.sentence?.ru;
      if (ru) void speak(ru);
      return;
    }
    // T10 device finding: seek from ENDED auto-resumes — pause, seek, play.
    player.pause();
    void player.seekTo(0).then(() => {
      player.play();
      setStatusOverride({ key: stepKey, status: 'playing' });
    });
  }, [node, stepKey]);

  const karaokeTokenIndex =
    status === 'playing' && karaoke?.key === stepKey ? karaoke.tokenIndex : null;
  // Stampless line (or stamps still loading): whole-line wash while playing.
  const sentenceWash = status === 'playing' && (stamps == null || stamps.length === 0);

  return { status, karaokeTokenIndex, sentenceWash, replay };
}
