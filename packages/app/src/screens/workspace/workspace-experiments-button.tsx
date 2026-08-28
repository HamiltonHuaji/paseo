import { FlaskConical } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import {
  extraMutedIconColorMapping,
  iconButtonChromeGlyphSize,
  mutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";

const ThemedFlaskConical = withUnistyles(FlaskConical);

export function WorkspaceExperimentsButton({
  onPress,
  mobile = false,
  visible = true,
  hidden = false,
}: {
  onPress: () => void;
  mobile?: boolean;
  visible?: boolean;
  hidden?: boolean;
}) {
  if (!visible || hidden) return null;
  return (
    <HeaderToggleButton
      testID="workspace-experiments-button"
      onPress={onPress}
      tooltipLabel="Experiments"
      tooltipKeys={[]}
      tooltipSide="bottom"
      accessible
      accessibilityRole="button"
      accessibilityLabel="Experiments"
    >
      <ThemedFlaskConical
        size={iconButtonChromeGlyphSize("large")}
        strokeWidth={1.5}
        uniProps={mobile ? mutedIconColorMapping : extraMutedIconColorMapping}
      />
    </HeaderToggleButton>
  );
}
