import { QueryClient } from '@tanstack/react-query';

/**
 * The app-wide React Query client. A module singleton (rather than a
 * component-local instance) so non-component code — the T07 sync service
 * after importing packs — can invalidate queries too.
 */
export const queryClient = new QueryClient();
