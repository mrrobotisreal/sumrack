import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import * as React from 'react';
import { ActivityIndicator, Pressable, Switch, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import {
  getBackupPrefs,
  getKdfConfig,
  getLastBackup,
  isBackupConfigured,
  setBackupPrefs,
  setupPassphrase,
  type BackupPrefs,
  type LastBackup,
} from './config';
import { friendlyBackupMessage } from './errors';
import { exportBackupToLocalFile } from './local-target';
import { runBackup } from './service';
import { useBackupStatus, type BackupPhase } from './store';
import { SyncdSettingsCard } from './syncd-settings-card';

/**
 * Settings → Backup (ticket item 7, design §7.8): passphrase setup/change,
 * target + schedule toggles, status, run-now, local export, restore link.
 * The passphrase inputs are transient component state — never stored,
 * logged, or tracked; only the derived key persists (Keystore).
 */

const PHASE_LABEL: Record<Exclude<BackupPhase, 'idle'>, string> = {
  exporting: 'Exporting…',
  encrypting: 'Encrypting…',
  uploading: 'Uploading…',
  pruning: 'Tidying old backups…',
};

function formatWhen(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function BackupSettingsSection() {
  const { tokens } = useAppTheme();
  const { phase, lastRun } = useBackupStatus();

  const [loaded, setLoaded] = React.useState(false);
  const [configured, setConfigured] = React.useState(false);
  const [kdfPresentKeyMissing, setKdfPresentKeyMissing] = React.useState(false);
  const [prefs, setPrefs] = React.useState<BackupPrefs>({
    githubEnabled: true,
    autoEnabled: true,
    syncdEnabled: false,
  });
  const [lastGithub, setLastGithub] = React.useState<LastBackup | null>(null);
  const [lastLocal, setLastLocal] = React.useState<LastBackup | null>(null);

  // Passphrase form (setup, change, or key re-entry) — transient only.
  const [formOpen, setFormOpen] = React.useState(false);
  const [pass1, setPass1] = React.useState('');
  const [pass2, setPass2] = React.useState('');
  const [deriving, setDeriving] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const [exportBusy, setExportBusy] = React.useState(false);
  const [exportResult, setExportResult] = React.useState<string | null>(null);

  const reload = React.useCallback(() => {
    void (async () => {
      const isConfigured = await isBackupConfigured();
      setConfigured(isConfigured);
      setKdfPresentKeyMissing(!isConfigured && (await getKdfConfig()) !== null);
      setPrefs(await getBackupPrefs());
      setLastGithub(await getLastBackup(SETTING_KEYS.lastBackupGithub));
      setLastLocal(await getLastBackup(SETTING_KEYS.lastBackupLocal));
      setLoaded(true);
    })();
  }, []);

  React.useEffect(reload, [reload]);
  // Refresh the durable status rows whenever a run finishes.
  React.useEffect(() => {
    if (phase === 'idle') reload();
  }, [phase, reload]);

  const submitPassphrase = React.useCallback(() => {
    if (deriving) return;
    const p1 = pass1;
    if (p1.length < 8) {
      setFormError('Use at least 8 characters.');
      return;
    }
    if (p1 !== pass2) {
      setFormError('Passphrases do not match.');
      return;
    }
    setFormError(null);
    setDeriving(true);
    void (async () => {
      try {
        const wasConfigured = configured;
        await setupPassphrase(p1);
        track(wasConfigured ? 'backup_passphrase_changed' : 'backup_setup_completed');
        setPass1('');
        setPass2('');
        setFormOpen(false);
        reload();
      } catch (err) {
        setFormError(friendlyBackupMessage(err));
      } finally {
        setDeriving(false);
      }
    })();
  }, [configured, deriving, pass1, pass2, reload]);

  const togglePref = React.useCallback(
    (key: keyof BackupPrefs, value: boolean) => {
      const next = { ...prefs, [key]: value };
      setPrefs(next);
      track('backup_prefs_changed', {
        githubEnabled: next.githubEnabled,
        autoEnabled: next.autoEnabled,
      });
      void setBackupPrefs(next);
    },
    [prefs],
  );

  const backupNow = React.useCallback(() => {
    void runBackup({ trigger: 'manual' });
  }, []);

  const exportLocal = React.useCallback(() => {
    if (exportBusy) return;
    setExportBusy(true);
    setExportResult(null);
    void (async () => {
      try {
        const result = await exportBackupToLocalFile();
        setExportResult(`Saved ${result.name}`);
        reload();
      } catch (err) {
        setExportResult(friendlyBackupMessage(err));
      } finally {
        setExportBusy(false);
      }
    })();
  }, [exportBusy, reload]);

  if (!loaded) return null;

  const busy = phase !== 'idle';

  return (
    <>
      <Text variant="caption" className="mb-2 mt-8 uppercase tracking-wider">
        Backup
      </Text>

      {!configured ? (
        <View className="overflow-hidden rounded-xl border border-border bg-surface px-4 py-3.5">
          <Text className="font-ui-medium">
            {kdfPresentKeyMissing ? 'Re-enter your passphrase' : 'Set up encrypted backups'}
          </Text>
          <Text variant="caption" className="mt-1">
            {kdfPresentKeyMissing
              ? 'Backup settings were restored, but the encryption key lives only in this device’s Keystore. Enter the same passphrase to keep backing up.'
              : 'Your word bank, reviews, journal, and progress get encrypted with a passphrase only you know, then saved to your content repo and/or a local file. The passphrase is never stored — if you lose it, backups are unreadable.'}
          </Text>
          <TextInput
            value={pass1}
            onChangeText={setPass1}
            placeholder="Passphrase (min 8 characters)"
            placeholderTextColor={tokens.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            className="mt-3 rounded-xl border border-border bg-surface-2 px-3 py-2.5 font-ui text-base text-text"
            accessibilityLabel="Backup passphrase"
          />
          <TextInput
            value={pass2}
            onChangeText={setPass2}
            placeholder="Repeat passphrase"
            placeholderTextColor={tokens.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            className="mt-2 rounded-xl border border-border bg-surface-2 px-3 py-2.5 font-ui text-base text-text"
            accessibilityLabel="Repeat backup passphrase"
          />
          {formError && (
            <Text variant="caption" className="mt-2 text-danger">
              {formError}
            </Text>
          )}
          <Pressable
            onPress={submitPassphrase}
            disabled={deriving}
            accessibilityRole="button"
            className="mt-3 items-center rounded-xl bg-accent px-4 py-2.5 active:opacity-80"
          >
            {deriving ? (
              <View className="flex-row items-center gap-2">
                <ActivityIndicator size="small" color={tokens.text} />
                <Text className="font-ui-medium text-text">Deriving key…</Text>
              </View>
            ) : (
              <Text className="font-ui-medium text-text">
                {kdfPresentKeyMissing ? 'Unlock backups' : 'Set passphrase & enable'}
              </Text>
            )}
          </Pressable>
        </View>
      ) : (
        <>
          <View className="overflow-hidden rounded-xl border border-border bg-surface">
            <View className="px-4 py-3.5">
              <View className="flex-row items-center justify-between">
                <Text className="font-ui-medium">GitHub backup</Text>
                {busy && (
                  <View className="flex-row items-center gap-2">
                    <ActivityIndicator size="small" color={tokens.accent} />
                    <Text variant="caption">
                      {PHASE_LABEL[phase as Exclude<BackupPhase, 'idle'>]}
                    </Text>
                  </View>
                )}
              </View>
              <Text variant="caption" className="mt-0.5">
                {lastGithub ? `Last backup ${formatWhen(lastGithub.at)}` : 'No backup yet'}
              </Text>
              {/* Run-level failures (export/encrypt/gates) have no per-target rows. */}
              {lastRun?.outcome === 'error' && !lastRun.targets && lastRun.error && (
                <Text variant="caption" className="mt-1 text-danger">
                  {lastRun.error}
                </Text>
              )}
              {(() => {
                const github = lastRun?.targets?.github;
                if (!github) return null;
                if (!github.ok && github.error) {
                  return (
                    <Text variant="caption" className="mt-1 text-danger">
                      {github.error}
                    </Text>
                  );
                }
                if (github.ok && !github.skippedFresh) {
                  return (
                    <Text variant="caption" className="mt-1 text-success">
                      Backed up ✓{github.pruned ? ` · pruned ${github.pruned} old` : ''}
                    </Text>
                  );
                }
                return null;
              })()}
              <Pressable
                onPress={backupNow}
                disabled={busy}
                accessibilityRole="button"
                className={`mt-3 items-center rounded-xl px-4 py-2.5 active:opacity-80 ${busy ? 'bg-surface-2' : 'bg-accent'}`}
              >
                <Text className="font-ui-medium text-text">Back up now</Text>
              </Pressable>
              <Text variant="caption" className="mt-2">
                Backs up to every enabled target. GitHub snapshots go to the content repo&apos;s
                backups/ folder (the token needs read-write Contents access).
              </Text>
            </View>

            <View className="flex-row items-center justify-between border-t border-border px-4 py-3.5">
              <View className="flex-1 gap-0.5 pr-3">
                <Text className="font-ui-medium">GitHub target</Text>
                <Text variant="caption">Push encrypted snapshots to the content repo</Text>
              </View>
              <Switch
                value={prefs.githubEnabled}
                onValueChange={(v) => togglePref('githubEnabled', v)}
                trackColor={{ false: tokens.surface2, true: tokens.accent }}
                thumbColor={tokens.text}
                accessibilityLabel="GitHub backup target"
              />
            </View>
            <View className="flex-row items-center justify-between border-t border-border px-4 py-3.5">
              <View className="flex-1 gap-0.5 pr-3">
                <Text className="font-ui-medium">Automatic backups</Text>
                <Text variant="caption">Daily on first use, and after big study sessions</Text>
              </View>
              <Switch
                value={prefs.autoEnabled}
                onValueChange={(v) => togglePref('autoEnabled', v)}
                trackColor={{ false: tokens.surface2, true: tokens.accent }}
                thumbColor={tokens.text}
                accessibilityLabel="Automatic backups"
              />
            </View>
          </View>

          <SyncdSettingsCard />

          <View className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
            <Pressable
              onPress={exportLocal}
              disabled={exportBusy}
              className="flex-row items-center justify-between px-4 py-3.5 active:bg-surface-2"
            >
              <View className="flex-1 gap-0.5 pr-3">
                <Text className="font-ui-medium">Export to file</Text>
                <Text variant="caption">
                  {exportResult ??
                    (lastLocal
                      ? `Last export ${formatWhen(lastLocal.at)}`
                      : 'Save an encrypted snapshot to a folder you pick (works offline)')}
                </Text>
              </View>
              {exportBusy ? (
                <ActivityIndicator size="small" color={tokens.accent} />
              ) : (
                <Ionicons name="download-outline" size={20} color={tokens.textMuted} />
              )}
            </Pressable>

            <Pressable
              onPress={() => {
                setFormOpen((v) => !v);
                setFormError(null);
              }}
              className="flex-row items-center justify-between border-t border-border px-4 py-3.5 active:bg-surface-2"
            >
              <View className="gap-0.5">
                <Text className="font-ui-medium">Change passphrase</Text>
                <Text variant="caption">Older backups keep needing the old passphrase</Text>
              </View>
              <Ionicons
                name={formOpen ? 'chevron-up' : 'chevron-forward'}
                size={18}
                color={tokens.textMuted}
              />
            </Pressable>
            {formOpen && (
              <View className="border-t border-border px-4 py-3.5">
                <TextInput
                  value={pass1}
                  onChangeText={setPass1}
                  placeholder="New passphrase (min 8 characters)"
                  placeholderTextColor={tokens.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 font-ui text-base text-text"
                  accessibilityLabel="New backup passphrase"
                />
                <TextInput
                  value={pass2}
                  onChangeText={setPass2}
                  placeholder="Repeat new passphrase"
                  placeholderTextColor={tokens.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  className="mt-2 rounded-xl border border-border bg-surface-2 px-3 py-2.5 font-ui text-base text-text"
                  accessibilityLabel="Repeat new backup passphrase"
                />
                {formError && (
                  <Text variant="caption" className="mt-2 text-danger">
                    {formError}
                  </Text>
                )}
                <Pressable
                  onPress={submitPassphrase}
                  disabled={deriving}
                  accessibilityRole="button"
                  className="mt-3 items-center rounded-xl bg-accent px-4 py-2.5 active:opacity-80"
                >
                  {deriving ? (
                    <View className="flex-row items-center gap-2">
                      <ActivityIndicator size="small" color={tokens.text} />
                      <Text className="font-ui-medium text-text">Deriving key…</Text>
                    </View>
                  ) : (
                    <Text className="font-ui-medium text-text">Change passphrase</Text>
                  )}
                </Pressable>
              </View>
            )}

            <Link href="/restore" asChild>
              <Pressable className="flex-row items-center justify-between border-t border-border px-4 py-3.5 active:bg-surface-2">
                <View className="gap-0.5">
                  <Text className="font-ui-medium text-danger">Restore from backup</Text>
                  <Text variant="caption">Replaces all current data with a snapshot</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={tokens.textMuted} />
              </Pressable>
            </Link>
          </View>
        </>
      )}

      {/* Fresh install: host/token must be settable BEFORE any passphrase
          exists so restore-from-syncd can list the server's snapshots. */}
      {!configured && <SyncdSettingsCard />}

      {!configured && (
        <View className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
          <Link href="/restore" asChild>
            <Pressable className="flex-row items-center justify-between px-4 py-3.5 active:bg-surface-2">
              <View className="gap-0.5">
                <Text className="font-ui-medium">Restore from backup</Text>
                <Text variant="caption">Fresh install? Bring everything back from a snapshot</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={tokens.textMuted} />
            </Pressable>
          </Link>
        </View>
      )}
    </>
  );
}
