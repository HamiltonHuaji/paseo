import invariant from "tiny-invariant";
import { FlaskConical } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { ExperimentsScreen } from "@/screens/experiments-screen";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";

const ThemedFlaskConical = withUnistyles(FlaskConical);
const experimentsPanelPresentation = {
  label: () => "Experiments",
  subtitle: () => "Project experiments",
  tooltip: () => "Experiments",
  icon: ThemedFlaskConical,
} satisfies PanelPresentation;

function ExperimentsPanel() {
  const { serverId, target } = usePaneContext();
  invariant(target.kind === "experiments", "ExperimentsPanel requires experiments target");
  return <ExperimentsScreen serverId={serverId} projectId={target.projectId} embedded />;
}

export const experimentsPanelRegistration = definePanel("experiments", {
  component: ExperimentsPanel,
  presentation: experimentsPanelPresentation,
});
