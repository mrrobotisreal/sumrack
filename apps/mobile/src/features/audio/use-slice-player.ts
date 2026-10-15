import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as React from 'react';

import { track } from '@/services/analytics';
import { createSliceFocus } from '@/services/learning-focus';

import { createSliceController, type SlicePlayerLike } from './slice-controller';
import { sliceWindow, type SliceStamp, type SliceWindow } from './slice-window';

/** T85: the listening quiz no longer slices story audio, so it is not a surface here. */
export type SliceSurface = 'popup' | 'exam';

/** word_slice_played is sampled 1 in N per surface. */
const ANALYTICS_SAMPLE = 5;

export interface SliceTarget {
  uri: string;
  /** The stamp(s) being played, collapsed to one span. */
  startMs: number;
  endMs: number;
  prev?: SliceStamp | null;
  next?: SliceStamp | null;
}

/** Window for a target; exported for the lab and for callers that want the numbers. */
export function windowFor(t: SliceTarget): SliceWindow {
  return sliceWindow(t, t.prev, t.next);
}

/** Owns the expo-audio player + T78 focus + controller for one surface. */
class SlicePlayerHost {
  private player: AudioPlayer | null = null;
  private uri: string | null = null;
  private count = 0;
  readonly focus;
  readonly controller;

  constructor(
    private readonly surface: SliceSurface,
    focusName: string,
  ) {
    this.focus = createSliceFocus(focusName);
    this.controller = createSliceController({
      focus: this.focus,
      getPlayer: () => this.player as unknown as SlicePlayerLike | null,
    });
  }

  stop = (): void => this.controller.stop();

  play = async (target: SliceTarget, rate = 1) => {
    // updateInterval huge: the controller polls currentTime itself, only while a slice plays.
    if (!this.player) {
      this.player = createAudioPlayer({ uri: target.uri }, { updateInterval: 60_000 });
    } else if (this.uri !== target.uri) {
      this.player.replace({ uri: target.uri });
    }
    this.uri = target.uri;
    const report = await this.controller.play({ window: windowFor(target), rate });
    if (report) {
      this.count += 1;
      if (this.count % ANALYTICS_SAMPLE === 1) {
        track('word_slice_played', {
          surface: this.surface,
          leadInMs: report.leadInMs,
          leadOutMs: report.leadOutMs,
          seekErrMs: report.seekErrMs,
          stopLagMs: report.stopLagMs,
          startLatencyMs: report.startLatencyMs,
          rate: report.rate,
        });
      }
    }
    return report;
  };

  dispose = (): void => {
    this.controller.stop();
    this.focus.release();
    this.player?.remove();
    this.player = null;
  };
}

/**
 * T79: the one hook every stamp-slice player uses. `stop()` and unmount
 * pause, release T78 focus and invalidate in-flight plays.
 */
export function useSlicePlayer(surface: SliceSurface, focusName: string) {
  const [host] = React.useState(() => new SlicePlayerHost(surface, focusName));
  React.useEffect(() => () => host.dispose(), [host]);
  return { play: host.play, stop: host.stop };
}
