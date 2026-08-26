import { useRouter } from 'expo-router';
import * as React from 'react';

import { track } from '@/services/analytics';

import { normalizeIntakeText, SharePayloadSchema } from './import-core';
import { useImportIntakeStore } from './intake-store';

/**
 * Share-target receiver glue (T28, design V2 §4.1), mounted once in the
 * root layout beside AutoSync/AiQueue. Cold start: consume the launch
 * intent's stashed text. Warm start: the native module's event fires while
 * we're mounted. Either way the payload is untrusted — Zod-gated and
 * NFC-normalized before it goes anywhere — then the intake screen opens
 * prefilled via the ephemeral store.
 */
export function ShareIntentGate() {
  const router = useRouter();

  React.useEffect(() => {
    // Lazy require so a dev client predating the module (or Node/vitest)
    // degrades to paste-only intake instead of crashing at import time.
    let shareIntent: (typeof import('../../../modules/share-intent'))['default'];
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      shareIntent = require('../../../modules/share-intent').default;
    } catch {
      return;
    }

    const deliver = (raw: unknown) => {
      const parsed = SharePayloadSchema.safeParse({ text: raw });
      if (!parsed.success) return;
      const text = normalizeIntakeText(parsed.data.text);
      if (!text) return;
      track('import_share_received', { chars: text.length });
      useImportIntakeStore.getState().setSharedText(text);
      router.push('/import');
    };

    const initial = shareIntent.consumePendingShare();
    if (initial != null) deliver(initial);
    const sub = shareIntent.addListener('onShareReceived', (payload) => deliver(payload?.text));
    return () => sub.remove();
  }, [router]);

  return null;
}
