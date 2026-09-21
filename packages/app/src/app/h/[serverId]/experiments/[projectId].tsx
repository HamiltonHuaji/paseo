import { useLocalSearchParams } from "expo-router";
import { useHostRouteServerId } from "@/navigation/host-route-context";
import { ExperimentsScreen } from "@/screens/experiments-screen";

export default function HostExperimentsRoute() {
  const serverId = useHostRouteServerId();
  const params = useLocalSearchParams<{ projectId?: string | string[] }>();
  const projectId = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId;
  return <ExperimentsScreen serverId={serverId ?? ""} projectId={projectId ?? ""} />;
}
