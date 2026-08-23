import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { hasPat } from '@/features/sync/config';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { friendlyBackupMessage } from './errors';
import { listLocalBackups, readLocalBackup, type LocalBackupFile } from './local-target';
import {
  fetchGithubBackup,
  fetchSyncdBackup,
  listGithubBackups,
  listSyncdBackups,
  restoreFromEnvelopeText,
  type RemoteBackupListing,
  type RestoreOutcome,
  type RestorePhase,
  type RestoreSource,
} from './restore-service';
import { isSyncdConfigured } from './syncd-config';

/**
 * Settings → Restore (ticket item 8). Deliberately linear and explicit —
 * this screen exists for exactly one bad day: source → snapshot → passphrase
 * → confirm (destructive) → progress → result. Every failure lands back on
 * the same screen with a plain message and an untouched database.
 */

type Source = RestoreSource;

type Step =
  | { kind: 'pick-source' }
  | { kind: 'listing'; source: Source }
  | {
      kind: 'pick-backup';
      source: Source;
      remote?: RemoteBackupListing[];
      local?: LocalBackupFile[];
    }
  | { kind: 'passphrase'; source: Source; name: string; ref: string }
  | { kind: 'running'; phase: RestorePhase | 'downloading' }
  | { kind: 'done'; outcome: RestoreOutcome }
  | { kind: 'error'; message: string; source: Source };

const PHASE_LABEL: Record<RestorePhase | 'downloading', string> = {
  downloading: 'Downloading snapshot…',
  'deriving-key': 'Deriving key from passphrase… (takes a moment)',
  decrypting: 'Decrypting…',
  importing: 'Importing your data…',
  refreshing: 'Refreshing the app…',
};

function formatStamp(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function RestoreScreen() {
  const { tokens } = useAppTheme();
  const [step, setStep] = React.useState<Step>({ kind: 'pick-source' });
  const [passphrase, setPassphrase] = React.useState('');
  const [patPresent, setPatPresent] = React.useState<boolean | null>(null);
  const [syncdReady, setSyncdReady] = React.useState<boolean | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      track('restore_screen_opened');
      void hasPat().then(setPatPresent);
      void isSyncdConfigured().then(setSyncdReady);
    }, []),
  );

  const pickSource = React.useCallback((source: Source) => {
    setStep({ kind: 'listing', source });
    void (async () => {
      try {
        if (source === 'github') {
          const remote = await listGithubBackups();
          setStep({ kind: 'pick-backup', source, remote });
        } else if (source === 'syncd') {
          const remote = await listSyncdBackups();
          setStep({ kind: 'pick-backup', source, remote });
        } else {
          const local = await listLocalBackups();
          setStep({ kind: 'pick-backup', source, local });
        }
      } catch (err) {
        setStep({ kind: 'error', message: friendlyBackupMessage(err), source });
      }
    })();
  }, []);

  const startRestore = React.useCallback(
    (source: Source, name: string, ref: string) => {
      const pass = passphrase;
      if (pass.length === 0) return;
      Alert.alert(
        'Replace all data?',
        `Everything currently in the app will be replaced by the snapshot ${name}. This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Restore',
            style: 'destructive',
            onPress: () => {
              setStep({ kind: 'running', phase: 'downloading' });
              void (async () => {
                try {
                  const text =
                    source === 'github'
                      ? await fetchGithubBackup(ref)
                      : source === 'syncd'
                        ? await fetchSyncdBackup(ref)
                        : await readLocalBackup(ref);
                  const outcome = await restoreFromEnvelopeText(text, pass, {
                    source,
                    onPhase: (phase) => setStep({ kind: 'running', phase }),
                  });
                  setPassphrase('');
                  setStep({ kind: 'done', outcome });
                } catch (err) {
                  setStep({ kind: 'error', message: friendlyBackupMessage(err), source });
                }
              })();
            },
          },
        ],
      );
    },
    [passphrase],
  );

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerClassName="px-4 pb-12 pt-6"
      keyboardShouldPersistTaps="handled"
    >
      {step.kind === 'pick-source' && (
        <>
          <Text variant="caption" className="mb-2 uppercase tracking-wider">
            Restore source
          </Text>
          <View className="overflow-hidden rounded-xl border border-border bg-surface">
            <Pressable
              onPress={() => pickSource('github')}
              className="flex-row items-center justify-between px-4 py-3.5 active:bg-surface-2"
            >
              <View className="flex-1 gap-0.5 pr-3">
                <Text className="font-ui-medium">GitHub</Text>
                <Text variant="caption">
                  {patPresent === false
                    ? 'Needs the repo token — add it in Settings → Content sync first'
                    : 'Snapshots from the content repo’s backups/ folder'}
                </Text>
              </View>
              <Ionicons name="cloud-outline" size={20} color={tokens.textMuted} />
            </Pressable>
            <Pressable
              onPress={() => pickSource('syncd')}
              className="flex-row items-center justify-between border-t border-border px-4 py-3.5 active:bg-surface-2"
            >
              <View className="flex-1 gap-0.5 pr-3">
                <Text className="font-ui-medium">Home server</Text>
                <Text variant="caption">
                  {syncdReady === false
                    ? 'Needs the host and token — set them in Settings → Backup first'
                    : 'Snapshots stored on syncd over Tailscale'}
                </Text>
              </View>
              <Ionicons name="server-outline" size={20} color={tokens.textMuted} />
            </Pressable>
            <Pressable
              onPress={() => pickSource('local-file')}
              className="flex-row items-center justify-between border-t border-border px-4 py-3.5 active:bg-surface-2"
            >
              <View className="flex-1 gap-0.5 pr-3">
                <Text className="font-ui-medium">Local folder</Text>
                <Text variant="caption">Pick the folder you exported backups into</Text>
              </View>
              <Ionicons name="folder-open-outline" size={20} color={tokens.textMuted} />
            </Pressable>
          </View>
          <Text variant="caption" className="mt-3">
            Restoring replaces the app&apos;s current data with the snapshot, then re-downloads
            content packs. You&apos;ll need the passphrase the backup was made with.
          </Text>
        </>
      )}

      {step.kind === 'listing' && (
        <View className="items-center py-16">
          <ActivityIndicator color={tokens.accent} />
          <Text variant="caption" className="mt-3">
            Looking for backups…
          </Text>
        </View>
      )}

      {step.kind === 'pick-backup' && (
        <>
          <Text variant="caption" className="mb-2 uppercase tracking-wider">
            Pick a snapshot
          </Text>
          {(step.source === 'local-file' ? (step.local ?? []) : (step.remote ?? [])).length ===
          0 ? (
            <View className="rounded-xl border border-border bg-surface px-4 py-6">
              <Text variant="muted" className="text-center">
                No backups found{step.source === 'local-file' ? ' in that folder' : ''}.
              </Text>
            </View>
          ) : (
            <View className="overflow-hidden rounded-xl border border-border bg-surface">
              {step.source !== 'local-file'
                ? step.remote!.map((b, i) => (
                    <Pressable
                      key={b.path}
                      onPress={() =>
                        setStep({
                          kind: 'passphrase',
                          source: step.source,
                          name: b.name,
                          ref: b.path,
                        })
                      }
                      className={`flex-row items-center justify-between px-4 py-3.5 active:bg-surface-2 ${i > 0 ? 'border-t border-border' : ''}`}
                    >
                      <View className="gap-0.5">
                        <Text className="font-ui-medium">{formatStamp(b.timestamp)}</Text>
                        <Text variant="caption">
                          {b.name} · {Math.max(1, Math.round(b.size / 1024))} KB
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={tokens.textMuted} />
                    </Pressable>
                  ))
                : step.local!.map((f, i) => (
                    <Pressable
                      key={f.uri}
                      onPress={() =>
                        setStep({
                          kind: 'passphrase',
                          source: 'local-file',
                          name: f.name,
                          ref: f.uri,
                        })
                      }
                      className={`flex-row items-center justify-between px-4 py-3.5 active:bg-surface-2 ${i > 0 ? 'border-t border-border' : ''}`}
                    >
                      <View className="gap-0.5">
                        <Text className="font-ui-medium">{f.name}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={tokens.textMuted} />
                    </Pressable>
                  ))}
            </View>
          )}
          <Pressable onPress={() => setStep({ kind: 'pick-source' })} className="mt-4 self-start">
            <Text variant="caption">‹ Back</Text>
          </Pressable>
        </>
      )}

      {step.kind === 'passphrase' && (
        <>
          <Text variant="caption" className="mb-2 uppercase tracking-wider">
            Passphrase
          </Text>
          <View className="rounded-xl border border-border bg-surface px-4 py-3.5">
            <Text className="font-ui-medium">{step.name}</Text>
            <Text variant="caption" className="mt-1">
              Enter the backup passphrase this snapshot was encrypted with.
            </Text>
            <TextInput
              value={passphrase}
              onChangeText={setPassphrase}
              placeholder="Passphrase"
              placeholderTextColor={tokens.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              className="mt-3 rounded-xl border border-border bg-surface-2 px-3 py-2.5 font-ui text-base text-text"
              accessibilityLabel="Backup passphrase"
            />
            <Pressable
              onPress={() => startRestore(step.source, step.name, step.ref)}
              disabled={passphrase.length === 0}
              accessibilityRole="button"
              className={`mt-3 items-center rounded-xl px-4 py-2.5 active:opacity-80 ${passphrase.length === 0 ? 'bg-surface-2' : 'bg-accent'}`}
            >
              <Text className="font-ui-medium text-text">Restore this snapshot</Text>
            </Pressable>
          </View>
          <Pressable onPress={() => setStep({ kind: 'pick-source' })} className="mt-4 self-start">
            <Text variant="caption">‹ Back</Text>
          </Pressable>
        </>
      )}

      {step.kind === 'running' && (
        <View className="items-center py-16">
          <ActivityIndicator color={tokens.accent} />
          <Text variant="muted" className="mt-3">
            {PHASE_LABEL[step.phase]}
          </Text>
          <Text variant="caption" className="mt-1">
            Don&apos;t close the app.
          </Text>
        </View>
      )}

      {step.kind === 'done' && (
        <View className="rounded-xl border border-border bg-surface px-4 py-5">
          <Text className="font-ui-bold text-lg text-success">Restore complete</Text>
          <Text variant="muted" className="mt-2">
            {step.outcome.totalRows} rows restored from the snapshot of{' '}
            {formatStamp(step.outcome.exportedAt)}.
          </Text>
          {step.outcome.packsToRedownload.length > 0 && (
            <Text variant="caption" className="mt-2">
              {step.outcome.syncStarted
                ? `Re-downloading ${step.outcome.packsToRedownload.length} content pack(s) in the background.`
                : `${step.outcome.packsToRedownload.length} content pack(s) need re-downloading — add the GitHub token in Settings → Content sync, then check for updates.`}
            </Text>
          )}
          <Text variant="caption" className="mt-2">
            Restart the app once to finish applying everything (reminders, achievements, voices).
          </Text>
        </View>
      )}

      {step.kind === 'error' && (
        <View className="rounded-xl border border-border bg-surface px-4 py-5">
          <Text className="font-ui-bold text-lg text-danger">Restore failed</Text>
          <Text variant="muted" className="mt-2">
            {step.message}
          </Text>
          <Text variant="caption" className="mt-2">
            Nothing was changed — your current data is intact.
          </Text>
          <Pressable
            onPress={() => setStep({ kind: 'pick-source' })}
            accessibilityRole="button"
            className="mt-4 items-center rounded-xl bg-accent px-4 py-2.5 active:opacity-80"
          >
            <Text className="font-ui-medium text-text">Try again</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}
