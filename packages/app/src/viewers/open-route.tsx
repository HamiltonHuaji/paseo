import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { useHostRouteServerId } from "@/navigation/host-route-context";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { buildHostRootRoute } from "@/utils/host-routes";
import { openHostViewer } from "./open-from-host";

export default function ViewerRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <ViewerRouteContent />
    </HostRouteBootstrapBoundary>
  );
}

function ViewerRouteContent() {
  const serverId = useHostRouteServerId();
  const params = useLocalSearchParams();
  const router = useRouter();
  const snapshot = useHostRuntimeSnapshot(serverId ?? "");
  const [error, setError] = useState<string | null>(null);
  const opened = useRef<string | null>(null);
  const path = useMemo(() => {
    const parts = params.viewerPath;
    const pathname = `/view/${(Array.isArray(parts) ? parts : [parts ?? ""]).map(encodeURIComponent).join("/")}`;
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === "serverId" || key === "viewerPath" || key === "#") continue;
      for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
    }
    const search = query.toString();
    const hash = typeof params["#"] === "string" ? `#${params["#"]}` : "";
    return `${pathname}${search ? `?${search}` : ""}${hash}`;
  }, [params]);
  useEffect(() => {
    if (error || !serverId || snapshot?.connectionStatus !== "online" || opened.current === path)
      return;
    opened.current = path;
    void openHostViewer(serverId, path).then(
      () => router.replace(buildHostRootRoute(serverId)),
      (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
    );
  }, [error, path, router, serverId, snapshot?.connectionStatus]);
  const retry = useCallback(() => {
    opened.current = null;
    setError(null);
  }, []);
  const goBack = useCallback(() => {
    if (serverId) router.replace(buildHostRootRoute(serverId));
  }, [router, serverId]);
  return (
    <View style={styles.container}>
      <Text style={styles.text}>{error ?? "Opening viewer on the linked host…"}</Text>
      {error ? <Button onPress={retry}>Retry</Button> : null}
      {serverId ? (
        <Button variant="outline" onPress={goBack}>
          Back
        </Button>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface0,
  },
  text: { color: theme.colors.foreground, textAlign: "center" },
}));
