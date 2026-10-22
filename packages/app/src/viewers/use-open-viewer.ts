import { useMutation } from "@tanstack/react-query";
import type { ToastApi } from "@/components/toast-host";
import type { ViewerDeepLinkTarget } from "@getpaseo/protocol/viewer-deep-link";
import { useStableEvent } from "@/hooks/use-stable-event";
import { openHostViewer } from "./open-from-host";

export function useOpenViewer(toast?: ToastApi | null) {
  const mutation = useMutation({
    mutationFn: ({ serverId, path }: ViewerDeepLinkTarget) => openHostViewer(serverId, path),
    onMutate: () => {
      toast?.show("Opening viewer…", { durationMs: null, testID: "viewer-link-opening" });
    },
    onSuccess: () => {
      toast?.show("Viewer opened in browser", { variant: "success" });
    },
    onError: (error) => {
      toast?.show(`Could not open viewer: ${error.message}. Click the link to retry.`, {
        variant: "error",
        durationMs: null,
        testID: "viewer-link-error",
      });
    },
  });
  return useStableEvent((target: ViewerDeepLinkTarget) => {
    if (!mutation.isPending) mutation.mutate(target);
  });
}
