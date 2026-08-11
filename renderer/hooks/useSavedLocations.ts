import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/lib/ipc-client";
import type { SavedLocation } from "@/types/settings";

const LOCATIONS_KEY = ["locations"] as const;

/** Loads/persists locations.json (the saved-locations sidebar list + which
 * one, if any, is active) via IPC. */
export function useSavedLocations() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: LOCATIONS_KEY, queryFn: ipc.locations.get });

  function invalidate(data: Awaited<ReturnType<typeof ipc.locations.get>>) {
    queryClient.setQueryData(LOCATIONS_KEY, data);
  }

  const addMutation = useMutation({
    mutationFn: (location: Omit<SavedLocation, "id">) => ipc.locations.add(location),
    onSuccess: invalidate,
  });
  const removeMutation = useMutation({
    mutationFn: (id: string) => ipc.locations.remove(id),
    onSuccess: invalidate,
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Omit<SavedLocation, "id">> }) =>
      ipc.locations.update(id, patch),
    onSuccess: invalidate,
  });
  const setActiveMutation = useMutation({
    mutationFn: (id: string | null) => ipc.locations.setActive(id),
    onSuccess: invalidate,
  });

  const savedLocations = query.data?.savedLocations ?? [];
  const activeLocationId = query.data?.activeLocationId ?? null;
  const activeSavedLocation = savedLocations.find((l) => l.id === activeLocationId) ?? null;

  return {
    savedLocations,
    activeLocationId,
    activeSavedLocation,
    isLoading: query.isLoading,
    addLocation: addMutation.mutateAsync,
    removeLocation: removeMutation.mutateAsync,
    updateLocation: updateMutation.mutateAsync,
    setActiveLocation: setActiveMutation.mutateAsync,
  };
}
