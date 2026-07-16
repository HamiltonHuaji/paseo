import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import Svg, { Path, Rect } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { RotateCw, Copy, Check } from "lucide-react-native";
import { settingsStyles } from "@/styles/settings";
import { Button } from "@/components/ui/button";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useFetchQuery } from "@/data/query";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { createPairingQrModel } from "./pair-device-qr";

type PairingViewState =
  | { tag: "loading" }
  | { tag: "error"; message: string }
  | { tag: "unavailable"; message: string }
  | { tag: "ready"; url: string };

const ThemedRetryIcon = withUnistyles(RotateCw);
const ThemedCopyIcon = withUnistyles(Copy);
const ThemedCopiedIcon = withUnistyles(Check);
const ThemedLinkInput = withUnistyles(TextInput, (theme) => ({
  selectionColor: theme.colors.accent,
}));

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const accentColorMapping = (theme: Theme) => ({ color: theme.colors.accent });

function resolvePairingViewState(args: {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: { url?: string | null; relayEnabled?: boolean } | undefined;
  labels: {
    failedToLoadOffer: string;
    relayDisabled: string;
    unavailable: string;
  };
}): PairingViewState {
  if (args.isPending) return { tag: "loading" };
  if (args.isError) {
    const message =
      args.error instanceof Error ? args.error.message : args.labels.failedToLoadOffer;
    return { tag: "error", message };
  }
  if (!args.data?.url) {
    const message =
      args.data?.relayEnabled === false ? args.labels.relayDisabled : args.labels.unavailable;
    return { tag: "unavailable", message };
  }
  return { tag: "ready", url: args.data.url };
}

export function PairDeviceSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pairingQuery = useFetchQuery({
    queryKey: ["daemon-pairing-offer", serverId],
    queryFn: () => {
      if (!client) {
        throw new Error(t("settings.host.pairDevices.offlineHint"));
      }
      return client.getDaemonPairingOffer();
    },
    enabled: client !== null,
    dataShape: "value",
    staleTimeMs: 5 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const handleCopyLink = useCallback(async () => {
    if (!pairingQuery.data?.url) return;
    try {
      await Clipboard.setStringAsync(pairingQuery.data.url);
      setCopied(true);
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = setTimeout(() => {
        copiedTimerRef.current = null;
        setCopied(false);
      }, 2000);
    } catch {
      setCopied(false);
    }
  }, [pairingQuery.data?.url]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
      }
    },
    [],
  );

  const handleRefetch = useCallback(() => {
    if (!client) return;
    void pairingQuery.refetch();
  }, [client, pairingQuery]);

  const handleCopyPress = useCallback(() => {
    void handleCopyLink();
  }, [handleCopyLink]);

  const retryIcon = useMemo(
    () => <ThemedRetryIcon size={ICON_SIZE.sm} uniProps={foregroundColorMapping} />,
    [],
  );
  const copyButtonIcon = useMemo(
    () =>
      copied ? (
        <ThemedCopiedIcon size={ICON_SIZE.sm} uniProps={accentColorMapping} />
      ) : (
        <ThemedCopyIcon size={ICON_SIZE.sm} uniProps={foregroundColorMapping} />
      ),
    [copied],
  );
  const bodyLabels = useMemo(
    () => ({
      loadingOffer: t("pairing.device.loadingOffer"),
      hint: t("pairing.device.hint"),
      qrUnavailable: t("pairing.device.qrUnavailable"),
      retry: t("pairing.device.retry"),
      copy: t("pairing.device.copy"),
      copied: t("pairing.device.copied"),
      qrCode: t("pairing.device.qrCode"),
    }),
    [t],
  );

  const viewState = useMemo<PairingViewState>(() => {
    if (!client) {
      return { tag: "unavailable", message: t("settings.host.pairDevices.offlineHint") };
    }
    return resolvePairingViewState({
      isPending: pairingQuery.isPending,
      isError: pairingQuery.isError,
      error: pairingQuery.error,
      data: pairingQuery.data,
      labels: {
        failedToLoadOffer: t("pairing.device.failedToLoadOffer"),
        relayDisabled: t("pairing.device.relayDisabled"),
        unavailable: t("pairing.device.unavailable"),
      },
    });
  }, [
    client,
    pairingQuery.data,
    pairingQuery.error,
    pairingQuery.isError,
    pairingQuery.isPending,
    t,
  ]);

  return (
    <View style={settingsStyles.section} testID="host-page-pair-device-card">
      <View style={settingsStyles.card}>
        <PairDeviceBody
          viewState={viewState}
          retryIcon={retryIcon}
          copyButtonIcon={copyButtonIcon}
          copied={copied}
          handleRefetch={handleRefetch}
          handleCopyPress={handleCopyPress}
          labels={bodyLabels}
        />
      </View>
    </View>
  );
}

interface PairDeviceBodyProps {
  viewState: PairingViewState;
  retryIcon: React.ReactElement;
  copyButtonIcon: React.ReactElement;
  copied: boolean;
  handleRefetch: () => void;
  handleCopyPress: () => void;
  labels: {
    loadingOffer: string;
    hint: string;
    qrUnavailable: string;
    retry: string;
    copy: string;
    copied: string;
    qrCode: string;
  };
}

function PairDeviceBody(props: PairDeviceBodyProps) {
  const { viewState, retryIcon, copyButtonIcon, copied, handleRefetch, handleCopyPress, labels } =
    props;

  if (viewState.tag === "loading") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="small" />
        <Text style={styles.hint}>{labels.loadingOffer}</Text>
      </View>
    );
  }

  if (viewState.tag === "error" || viewState.tag === "unavailable") {
    return (
      <View style={styles.centered}>
        <Text style={styles.hint}>{viewState.message}</Text>
        <Button variant="outline" size="sm" leftIcon={retryIcon} onPress={handleRefetch}>
          {labels.retry}
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.content}>
      <Text style={styles.hint}>{labels.hint}</Text>
      <View style={styles.qrContainer}>
        <PairDeviceQrContent
          url={viewState.url}
          unavailableLabel={labels.qrUnavailable}
          accessibilityLabel={labels.qrCode}
        />
      </View>
      <View style={styles.linkRow}>
        <View style={styles.inputWrapper}>
          <ThemedLinkInput
            style={styles.linkInput}
            value={viewState.url}
            readOnly
            selectTextOnFocus
          />
        </View>
        <Button variant="outline" size="sm" leftIcon={copyButtonIcon} onPress={handleCopyPress}>
          {copied ? labels.copied : labels.copy}
        </Button>
      </View>
    </View>
  );
}

function PairDeviceQrContent(props: {
  url: string;
  unavailableLabel: string;
  accessibilityLabel: string;
}) {
  const model = useMemo(() => createPairingQrModel(props.url), [props.url]);
  if (!model) {
    return <Text style={styles.hint}>{props.unavailableLabel}</Text>;
  }
  const viewBox = `0 0 ${model.size} ${model.size}`;
  return (
    <Svg
      style={styles.qrImage}
      viewBox={viewBox}
      accessibilityLabel={props.accessibilityLabel}
      testID="pair-device-qr"
    >
      <Rect width={model.size} height={model.size} fill="#ffffff" />
      <Path d={model.path} fill="#000000" />
    </Svg>
  );
}

const styles = StyleSheet.create((theme) => ({
  centered: {
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[6],
    paddingHorizontal: theme.spacing[4],
  },
  content: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    textAlign: "center",
  },
  qrContainer: {
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    width: "100%",
    maxWidth: 320,
    aspectRatio: 1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[2],
  },
  qrImage: {
    width: "100%",
    height: "100%",
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  inputWrapper: {
    flex: 1,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    overflow: "hidden",
  },
  linkInput: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    outlineStyle: "none",
  } as object,
}));
