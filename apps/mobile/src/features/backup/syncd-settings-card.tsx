import * as React from 'react';
import { ActivityIndicator, Pressable, Switch, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { SETTING_KEYS } from '@/db/repositories/settings';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import { getBackupPrefs, getLastBackup, setBackupPrefs, type LastBackup } from './config';
import { useBackupStatus } from './store';
import {
  clearSyncdToken,
  getSyncdConfig,
  hasSyncdToken,
  normalizeSyncdHost,
  setSyncdConfig,
  setSyncdToken,
} from './syncd-config';
import { checkSyncdReachability, useSyncdStatus } from './syncd-status';

/**
 * Settings → Backup → home server target (T21, ticket item 5): tailnet host
 * + bearer token (write-only, secure-store — the T07 PAT rule), independent
 * enable toggle, own last-backup status, and an explicit connection test so
 * "unreachable" is a visible state, never a mystery. Rendered even before
 * the passphrase is set up: a fresh install must be able to configure the
 * host/token to restore FROM syncd.
 */
export function SyncdSettingsCard() {
  const { tokens } = useAppTheme();
  const { phase, lastRun } = useBackupStatus();
  const { reachable, checkedAt } = useSyncdStatus();

  const [loaded, setLoaded] = React.useState(false);
  const [enabled, setEnabled] = React.useState(false);
  const [host, setHost] = React.useState('');
  const [tokenInput, setTokenInput] = React.useState('');
  const [tokenConfigured, setTokenConfigured] = React.useState(false);
  const [lastSyncd, setLastSyncd] = React.useState<LastBackup | null>(null);
  const [savedFlash, setSavedFlash] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<string | null>(null);

  const reload = React.useCallback(() => {
    void (async () => {
      setEnabled((await getBackupPrefs()).syncdEnabled);
      setHost((await getSyncdConfig())?.host ?? '');
      setTokenConfigured(await hasSyncdToken());
      setLastSyncd(await getLastBackup(SETTING_KEYS.lastBackupSyncd));
      setLoaded(true);
    })();
  }, []);

  React.useEffect(reload, [reload]);
  React.useEffect(() => {
    if (phase === 'idle') reload();
  }, [phase, reload]);

  const save = React.useCallback(() => {
    setFormError(null);
    setTestResult(null);
    void (async () => {
      const trimmed = host.trim();
      if (trimmed.length === 0) {
        await setSyncdConfig(null);
      } else {
        const normalized = normalizeSyncdHost(trimmed);
        if (!normalized) {
          setFormError('That host does not look like a valid address.');
          return;
        }
        await setSyncdConfig({ host: normalized });
        setHost(normalized);
      }
      const token = tokenInput.trim();
      if (token) {
        await setSyncdToken(token);
        setTokenInput('');
        setTokenConfigured(true);
        track('syncd_token_saved'); // deliberately no props — never the value
      }
      track('syncd_config_saved', { hasHost: trimmed.length > 0 });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
      reload();
    })();
  }, [host, tokenInput, reload]);

  const removeToken = React.useCallback(() => {
    void (async () => {
      await clearSyncdToken();
      setTokenConfigured(false);
      track('syncd_token_cleared');
    })();
  }, []);

  const toggleEnabled = React.useCallback((value: boolean) => {
    setEnabled(value);
    track('syncd_target_toggled', { enabled: value });
    void (async () => {
      const prefs = await getBackupPrefs();
      await setBackupPrefs({ ...prefs, syncdEnabled: value });
    })();
  }, []);

  const testConnection = React.useCallback(() => {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    track('syncd_connection_test_started');
    void (async () => {
      const result = await checkSyncdReachability();
      setTestResult(
        result.ok
          ? `Connected ✓ · ${result.backupCount} snapshot${result.backupCount === 1 ? '' : 's'} on the server`
          : (result.error ?? 'Connection failed.'),
      );
      setTesting(false);
    })();
  }, [testing]);

  if (!loaded) return null;

  const syncdOutcome = lastRun?.targets?.syncd;
  const formatWhen = (at: number) => {
    const d = new Date(at);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  return (
    <View className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
      <View className="flex-row items-center justify-between px-4 py-3.5">
        <View className="flex-1 gap-0.5 pr-3">
          <Text className="font-ui-medium">Home server (syncd)</Text>
          <Text variant="caption">
            {lastSyncd
              ? `Last backup ${formatWhen(lastSyncd.at)}`
              : 'Second backup target, over Tailscale'}
          </Text>
          {reachable !== null && checkedAt !== null && (
            <Text variant="caption" className={reachable ? 'text-success' : 'text-danger'}>
              {reachable ? 'Reachable' : 'Unreachable'} · checked {formatWhen(checkedAt)}
            </Text>
          )}
          {syncdOutcome && !syncdOutcome.ok && syncdOutcome.error && (
            <Text variant="caption" className="mt-1 text-danger">
              {syncdOutcome.error}
            </Text>
          )}
          {syncdOutcome?.ok && !syncdOutcome.skippedFresh && (
            <Text variant="caption" className="mt-1 text-success">
              Backed up ✓{syncdOutcome.pruned ? ` · server pruned ${syncdOutcome.pruned} old` : ''}
            </Text>
          )}
        </View>
        <Switch
          value={enabled}
          onValueChange={toggleEnabled}
          trackColor={{ false: tokens.surface2, true: tokens.accent }}
          thumbColor={tokens.text}
          accessibilityLabel="Home server backup target"
        />
      </View>

      <View className="border-t border-border px-4 py-3.5">
        <Text variant="caption">Tailnet host</Text>
        <TextInput
          value={host}
          onChangeText={setHost}
          placeholder="http://homeserver:8787"
          placeholderTextColor={tokens.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          className="mt-1 rounded-xl border border-border bg-surface-2 px-3 py-2.5 font-ui text-base text-text"
          accessibilityLabel="syncd host"
        />
        <Text variant="caption" className="mt-3">
          Bearer token {tokenConfigured ? '· configured ✓' : ''}
        </Text>
        <TextInput
          value={tokenInput}
          onChangeText={setTokenInput}
          placeholder={
            tokenConfigured ? 'Enter a new token to replace' : 'From /etc/syncd/syncd.env'
          }
          placeholderTextColor={tokens.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          className="mt-1 rounded-xl border border-border bg-surface-2 px-3 py-2.5 font-ui text-base text-text"
          accessibilityLabel="syncd bearer token"
        />
        {tokenConfigured && (
          <Pressable onPress={removeToken} className="mt-2 self-start">
            <Text variant="caption" className="text-danger">
              Remove saved token
            </Text>
          </Pressable>
        )}
        {formError && (
          <Text variant="caption" className="mt-2 text-danger">
            {formError}
          </Text>
        )}
        <View className="mt-3 flex-row gap-2">
          <Pressable
            onPress={save}
            accessibilityRole="button"
            className="flex-1 items-center rounded-xl bg-accent px-4 py-2.5 active:opacity-80"
          >
            <Text className="font-ui-medium text-text">{savedFlash ? 'Saved ✓' : 'Save'}</Text>
          </Pressable>
          <Pressable
            onPress={testConnection}
            disabled={testing}
            accessibilityRole="button"
            className="flex-1 items-center rounded-xl bg-surface-2 px-4 py-2.5 active:opacity-80"
          >
            {testing ? (
              <ActivityIndicator size="small" color={tokens.accent} />
            ) : (
              <Text className="font-ui-medium text-text">Test connection</Text>
            )}
          </Pressable>
        </View>
        {testResult && (
          <Text variant="caption" className="mt-2">
            {testResult}
          </Text>
        )}
      </View>
    </View>
  );
}
