import Svg, { Circle, Path, Rect } from "react-native-svg";
import { withUnistyles } from "react-native-unistyles";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import {
  extraMutedIconColorMapping,
  iconButtonChromeGlyphSize,
  mutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";

function ConveyorFlask({ size, color }: { size: number; color: string }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M9 2h6M10 2v5l-3.3 5.8a1.4 1.4 0 0 0 1.2 2.1h8.2a1.4 1.4 0 0 0 1.2-2.1L14 7V2M8.4 10h7.2" />
      <Rect x={2} y={17} width={20} height={5} rx={2.5} />
      <Circle cx={4.5} cy={19.5} r={0.6} />
      <Circle cx={19.5} cy={19.5} r={0.6} />
      <Path d="M8 19.5h8" />
    </Svg>
  );
}
const ThemedConveyorFlask = withUnistyles(ConveyorFlask);
export function WorkspaceWorksButton({
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
      testID="workspace-works-button"
      onPress={onPress}
      tooltipLabel="Works"
      tooltipKeys={[]}
      tooltipSide="bottom"
      accessible
      accessibilityRole="button"
      accessibilityLabel="Works"
    >
      <ThemedConveyorFlask
        size={iconButtonChromeGlyphSize("large")}
        uniProps={mobile ? mutedIconColorMapping : extraMutedIconColorMapping}
      />
    </HeaderToggleButton>
  );
}
