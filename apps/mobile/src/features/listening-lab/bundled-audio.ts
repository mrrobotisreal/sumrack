import { Asset } from 'expo-asset';
import type { LabPlaybackSource } from './audio-controller';
import manifest from './bundled-audio-manifest.json';

// These exact packet-copy clips contain no neighbouring sentence to spill into.
/* eslint-disable @typescript-eslint/no-require-imports -- Metro needs static require paths for bundled media. */
const modules: Record<string, number> = {
  'lab-01': require('../../../assets/listening-lab/lab-01.opus'),
  'lab-02': require('../../../assets/listening-lab/lab-02.opus'),
  'lab-03': require('../../../assets/listening-lab/lab-03.opus'),
  'lab-04': require('../../../assets/listening-lab/lab-04.opus'),
  'lab-05': require('../../../assets/listening-lab/lab-05.opus'),
  'lab-06': require('../../../assets/listening-lab/lab-06.opus'),
  'lab-07': require('../../../assets/listening-lab/lab-07.opus'),
  'lab-08': require('../../../assets/listening-lab/lab-08.opus'),
  'lab-09': require('../../../assets/listening-lab/lab-09.opus'),
  'lab-10': require('../../../assets/listening-lab/lab-10.opus'),
  'lab-11': require('../../../assets/listening-lab/lab-11.opus'),
  'lab-12': require('../../../assets/listening-lab/lab-12.opus'),
  'lab-13': require('../../../assets/listening-lab/lab-13.opus'),
  'lab-14': require('../../../assets/listening-lab/lab-14.opus'),
  'lab-15': require('../../../assets/listening-lab/lab-15.opus'),
  'lab-16': require('../../../assets/listening-lab/lab-16.opus'),
  'lab-17': require('../../../assets/listening-lab/lab-17.opus'),
  'lab-18': require('../../../assets/listening-lab/lab-18.opus'),
  'lab-19': require('../../../assets/listening-lab/lab-19.opus'),
  'lab-20': require('../../../assets/listening-lab/lab-20.opus'),
};
/* eslint-enable @typescript-eslint/no-require-imports */

/** Called only after original pack/version/text/track validation succeeds. */
export async function bundledSegmentAudio(segmentId: string): Promise<LabPlaybackSource> {
  const assetModule = modules[segmentId];
  const entry = manifest.segments.find((s) => s.id === segmentId);
  if (assetModule === undefined || !entry) throw new Error('This listening clip is not bundled.');
  const asset = Asset.fromModule(assetModule);
  // Expo resolves/stages the application asset; this never fetches a content-pack track.
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error('The bundled listening clip could not be opened locally.');
  return { uri: asset.localUri, startMs: 0, endMs: entry.durationMs, stopAtFileEnd: true };
}
