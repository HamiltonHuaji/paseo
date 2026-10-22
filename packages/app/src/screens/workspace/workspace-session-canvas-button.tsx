import { GitFork } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { withUnistyles } from "react-native-unistyles";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import {
  extraMutedIconColorMapping,
  iconButtonChromeGlyphSize,
  mutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";
const ThemedGitFork = withUnistyles(GitFork);
export function WorkspaceSessionCanvasButton({
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
  const { t } = useTranslation();
  if (!visible || hidden) return null;
  return (
    <HeaderToggleButton
      testID="workspace-session-canvas-button"
      onPress={onPress}
      tooltipLabel={t("sessionCanvas.title")}
      tooltipKeys={[]}
      tooltipSide="bottom"
      accessible
      accessibilityRole="button"
      accessibilityLabel={t("sessionCanvas.title")}
    >
      <ThemedGitFork
        size={iconButtonChromeGlyphSize("large")}
        uniProps={mobile ? mutedIconColorMapping : extraMutedIconColorMapping}
      />
    </HeaderToggleButton>
  );
}
