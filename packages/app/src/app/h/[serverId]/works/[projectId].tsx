import { useLocalSearchParams } from "expo-router";
import { useHostRouteServerId } from "@/navigation/host-route-context";
import { WorksScreen } from "@/screens/works-screen";

export default function HostWorksRoute() {
  const serverId = useHostRouteServerId();
  const params = useLocalSearchParams<{ projectId?: string | string[] }>();
  const projectId = Array.isArray(params.projectId) ? params.projectId[0] : params.projectId;
  return <WorksScreen serverId={serverId ?? ""} projectId={projectId ?? ""} />;
}
