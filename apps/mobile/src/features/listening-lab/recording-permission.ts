type Permission = { granted: boolean };
export interface RecordingPermissionDependencies {
  read(): Promise<Permission>;
  request(): Promise<Permission>;
}

/** Keeps Android's permission activity separate from a real capture interruption. */
export function createRecordingPermissionGate(deps: RecordingPermissionDependencies) {
  let requesting = false;
  return {
    async ensure() {
      if ((await deps.read()).granted) return true;
      requesting = true;
      try {
        return (await deps.request()).granted;
      } finally {
        requesting = false;
      }
    },
    async onAppStateChange(state: string, stop: () => Promise<void>) {
      if (state !== 'active' && !requesting) await stop();
    },
  };
}
