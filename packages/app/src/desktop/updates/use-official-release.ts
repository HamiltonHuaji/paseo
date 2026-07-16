import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { checkOfficialRelease, switchToOfficialApp } from "@/desktop/updates/desktop-updates";
import { useDesktopSettings } from "@/desktop/settings/desktop-settings";
import { shouldShowDesktopUpdateSection } from "@/desktop/updates/desktop-updates";
import { useDesktopIpcErrorReporter } from "@/desktop/hooks/desktop-ipc-error";
import { i18n } from "@/i18n/i18next";
import { useFetchQuery } from "@/data/query";

const UPSTREAM_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function useOfficialRelease() {
  const isDesktopApp = shouldShowDesktopUpdateSection();
  const { settings } = useDesktopSettings();
  const releaseChannel = settings.releaseChannel;
  const reportError = useDesktopIpcErrorReporter();
  const {
    data: release,
    isFetching,
    refetch,
  } = useFetchQuery({
    queryKey: ["official-paseo-release", releaseChannel],
    queryFn: () => checkOfficialRelease({ releaseChannel }),
    dataShape: "value",
    enabled: isDesktopApp,
    staleTimeMs: UPSTREAM_CHECK_INTERVAL_MS,
    refetchInterval: UPSTREAM_CHECK_INTERVAL_MS,
    retry: false,
  });
  const { isPending: isSwitching, mutateAsync: switchToOfficial } = useMutation({
    mutationFn: async () => {
      const result = await switchToOfficialApp({ releaseChannel });
      if (!result.started) throw new Error(result.message);
      return result;
    },
    onError: (error) => {
      reportError({
        error,
        message: i18n.t("desktop.updates.official.switchFailed"),
        logLabel: "[DesktopUpdater] Failed to switch to the official build",
      });
    },
  });

  const checkNow = useCallback(async () => {
    const result = await refetch();
    return result.data ?? null;
  }, [refetch]);

  return {
    isDesktopApp,
    release: release ?? null,
    isChecking: isFetching,
    isSwitching,
    checkNow,
    switchToOfficial,
  };
}
