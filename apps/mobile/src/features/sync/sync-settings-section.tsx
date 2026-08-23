import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import * as React from 'react';
import { Pressable, Switch, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { track } from '@/services/analytics';
import { useAppTheme } from '@/theme/use-app-theme';

import {
  clearPat,
  DEFAULT_REPO,
  getRepoConfig,
  getWifiOnlyAudio,
  hasPat,
  setPat,
  setRepoConfig,
  setWifiOnlyAudio,
} from './config';

/**
 * Settings → Content sync (ticket item 1, design §7.8): GitHub repo config,
 * fine-grained PAT (secure-store only — the input is write-only: the stored
 * token is never read back into the UI, never logged, never in analytics),
 * and the Wi-Fi-only-audio toggle.
 */
export function SyncSettingsSection() {
  const { tokens } = useAppTheme();

  const [owner, setOwner] = React.useState('');
  const [repo, setRepo] = React.useState('');
  const [patInput, setPatInput] = React.useState('');
  const [patConfigured, setPatConfigured] = React.useState(false);
  const [wifiOnly, setWifiOnly] = React.useState(true);
  const [savedFlash, setSavedFlash] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    void (async () => {
      const config = (await getRepoConfig()) ?? DEFAULT_REPO;
      setOwner(config.owner);
      setRepo(config.repo);
      setPatConfigured(await hasPat());
      setWifiOnly(await getWifiOnlyAudio());
      setLoaded(true);
    })();
  }, []);

  const save = React.useCallback(() => {
    void (async () => {
      await setRepoConfig({ owner: owner.trim(), repo: repo.trim(), branch: 'main' });
      track('sync_config_saved', { owner: owner.trim(), repo: repo.trim() });
      const token = patInput.trim();
      if (token) {
        await setPat(token);
        setPatInput('');
        setPatConfigured(true);
        track('sync_pat_saved'); // deliberately no props — never the value
      }
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    })();
  }, [owner, repo, patInput]);

  const removeToken = React.useCallback(() => {
    void (async () => {
      await clearPat();
      setPatConfigured(false);
      track('sync_pat_cleared');
    })();
  }, []);

  const toggleWifiOnly = React.useCallback((value: boolean) => {
    setWifiOnly(value);
    track('wifi_only_audio_toggled', { enabled: value });
    void setWifiOnlyAudio(value);
  }, []);

  if (!loaded) return null;

  return (
    <>
      <Text variant="caption" className="mb-2 mt-8 uppercase tracking-wider">
        Content sync
      </Text>
      <View className="overflow-hidden rounded-xl border border-border bg-surface px-4 py-3.5">
        <Text variant="caption" className="mb-1 uppercase tracking-wider">
          GitHub repo
        </Text>
        <View className="mb-3 flex-row items-center gap-2">
          <TextInput
            value={owner}
            onChangeText={setOwner}
            placeholder="owner"
            placeholderTextColor={tokens.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            className="flex-1 rounded-xl border border-border bg-surface-2 px-3 py-2.5 font-ui text-base text-text"
            accessibilityLabel="Repository owner"
          />
          <Text variant="muted">/</Text>
          <TextInput
            value={repo}
            onChangeText={setRepo}
            placeholder="repo"
            placeholderTextColor={tokens.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            className="flex-[1.4] rounded-xl border border-border bg-surface-2 px-3 py-2.5 font-ui text-base text-text"
            accessibilityLabel="Repository name"
          />
        </View>

        <Text variant="caption" className="mb-1 uppercase tracking-wider">
          Fine-grained token {patConfigured ? '· configured ✓' : ''}
        </Text>
        <TextInput
          value={patInput}
          onChangeText={setPatInput}
          placeholder={patConfigured ? 'Enter a new token to replace' : 'github_pat_…'}
          placeholderTextColor={tokens.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 font-ui text-base text-text"
          accessibilityLabel="GitHub personal access token"
        />
        <Text variant="caption" className="mt-1.5">
          Needs Contents access to the content repo — read-only for sync, read-write once backups
          are enabled (T20). Stored in the Android Keystore, never in backups or logs.
        </Text>
        {patConfigured && (
          <Pressable onPress={removeToken} hitSlop={6} className="mt-2 self-start">
            <Text variant="caption" className="text-danger">
              Remove saved token
            </Text>
          </Pressable>
        )}

        <Pressable
          onPress={save}
          accessibilityRole="button"
          className="mt-3 items-center rounded-xl bg-accent px-4 py-2.5 active:opacity-80"
        >
          <Text className="font-ui-medium text-text">{savedFlash ? 'Saved ✓' : 'Save'}</Text>
        </Pressable>
      </View>

      <View className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
        <View className="flex-row items-center justify-between px-4 py-3.5">
          <View className="flex-1 gap-0.5 pr-3">
            <Text className="font-ui-medium">Audio on Wi-Fi only</Text>
            <Text variant="caption">
              Narration files wait for Wi-Fi; stories and annotations always sync
            </Text>
          </View>
          <Switch
            value={wifiOnly}
            onValueChange={toggleWifiOnly}
            trackColor={{ false: tokens.surface2, true: tokens.accent }}
            thumbColor={tokens.text}
            accessibilityLabel="Audio on Wi-Fi only"
          />
        </View>
        <Link href="/packs" asChild>
          <Pressable className="flex-row items-center justify-between border-t border-border px-4 py-3.5 active:bg-surface-2">
            <View className="gap-0.5">
              <Text className="font-ui-medium">Installed packs</Text>
              <Text variant="caption">Versions, sizes, updates, remove</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={tokens.textMuted} />
          </Pressable>
        </Link>
      </View>
    </>
  );
}
