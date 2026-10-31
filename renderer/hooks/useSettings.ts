import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/lib/ipc-client";
import type { ConfigFile } from "@/types/settings";

const CONFIG_KEY = ["config"] as const;

/** Loads config.json (provider, units, theme, LibreWXR host, …) once via
 * IPC and keeps it in the react-query cache; `updateConfig` persists a
 * partial patch and updates every consumer immediately. */
export function useSettings() {
  const queryClient = useQueryClient();

  const query = useQuery({ queryKey: CONFIG_KEY, queryFn: ipc.config.get });

  const mutation = useMutation({
    mutationFn: (patch: Partial<ConfigFile>) => ipc.config.set(patch),
    onSuccess: (data) => queryClient.setQueryData(CONFIG_KEY, data),
  });

  return {
    config: query.data,
    isLoading: query.isLoading,
    updateConfig: mutation.mutate,
    updateConfigAsync: mutation.mutateAsync,
  };
}
