import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useAppTheme } from '@/theme/use-app-theme';

import { DEFAULT_SYNC_URL } from './config';
import { checkServer, saveServerUrl, syncNow } from './service';
import { statusLines } from './status-text';
import { useSyncStore } from './store';

/**
 * The sync rows inside Settings → «Аккаунт» (T104): status line (RU + EN
 * caption), «Синхронизировать сейчас» / «Повторить», and the «Сервер» row.
 * Rendered as the `children` slot of AccountSettingsSection.
 */
export function SyncStatusRows() {
  const { tokens } = useAppTheme();
  const s = useSyncStore();
  const [now, setNow] = React.useState(() => Date.now());
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [check, setCheck] = React.useState<{ busy: boolean; msg: string | null; ok: boolean }>({
    busy: false,
    msg: null,
    ok: false,
  });

  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const line = statusLines({ ...s, now });
  const color =
    line.tone === 'ok'
      ? tokens.accent
      : line.tone === 'error'
        ? tokens.danger
        : line.tone === 'warn'
          ? tokens.text
          : tokens.textMuted;
  const icon =
    s.status === 'syncing'
      ? 'sync-outline'
      : s.status === 'error'
        ? 'cloud-offline-outline'
        : s.status === 'offline'
          ? 'cloud-offline-outline'
          : 'cloud-done-outline';

  const verify = async () => {
    setCheck({ busy: true, msg: null, ok: false });
    try {
      const me = await checkServer(draft);
      await saveServerUrl(draft);
      setCheck({
        busy: false,
        ok: true,
        msg: `Сервер отвечает · ${me.deviceCount} устр., ${me.recordCount} записей`,
      });
      setEditing(false);
    } catch (e) {
      setCheck({ busy: false, ok: false, msg: e instanceof Error ? e.message : 'Ошибка' });
    }
  };

  return (
    <>
      <View className="flex-row items-center gap-3 border-t border-border px-4 py-3.5">
        {s.status === 'syncing' ? (
          <ActivityIndicator size="small" color={tokens.textMuted} />
        ) : (
          <Ionicons name={icon} size={20} color={color} />
        )}
        <View className="flex-1">
          <Text style={{ color }}>{line.ru}</Text>
          <Text variant="caption">{line.en}</Text>
        </View>
      </View>
      {s.linked ? (
        <Pressable
          onPress={() => void syncNow('manual')}
          disabled={s.status === 'syncing'}
          accessibilityRole="button"
          className="min-h-12 flex-row items-center gap-3 border-t border-border px-4 active:bg-surface-2"
        >
          <Ionicons name="refresh-outline" size={20} color={tokens.accent} />
          <Text>{s.status === 'error' ? 'Повторить' : 'Синхронизировать сейчас'}</Text>
        </Pressable>
      ) : null}
      <View className="border-t border-border px-4 py-3.5">
        <Pressable
          onPress={() => {
            setDraft(s.serverUrl || DEFAULT_SYNC_URL);
            setEditing((v) => !v);
            setCheck({ busy: false, msg: null, ok: false });
          }}
          accessibilityRole="button"
          className="flex-row items-center gap-3"
        >
          <Ionicons name="server-outline" size={20} color={tokens.textMuted} />
          <View className="flex-1">
            <Text>Сервер</Text>
            <Text variant="caption" numberOfLines={1}>
              {s.serverUrl || DEFAULT_SYNC_URL}
            </Text>
          </View>
          <Ionicons name={editing ? 'chevron-up' : 'chevron-down'} size={16} color={tokens.textMuted} />
        </Pressable>
        {editing ? (
          <View className="mt-3">
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={DEFAULT_SYNC_URL}
              placeholderTextColor={tokens.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              className="rounded-xl border border-border bg-surface-2 px-3 py-2.5 font-ui text-base text-text"
            />
            <Pressable
              onPress={() => void verify()}
              disabled={check.busy}
              accessibilityRole="button"
              className="mt-2 min-h-11 items-center justify-center rounded-xl bg-accent px-4 active:opacity-80"
            >
              {check.busy ? (
                <ActivityIndicator size="small" color={tokens.bg} />
              ) : (
                <Text className="font-medium text-bg">Проверить</Text>
              )}
            </Pressable>
          </View>
        ) : null}
        {check.msg ? (
          <Text variant="caption" className="mt-2" style={{ color: check.ok ? tokens.accent : tokens.danger }}>
            {check.msg}
          </Text>
        ) : null}
      </View>
    </>
  );
}
