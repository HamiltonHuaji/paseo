import React, { type ReactNode } from "react";
import { Text, View, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isWeb } from "@/constants/platform";

const LINK_TOOLTIP_TRIGGER_STYLE: ViewStyle = {
  // RN doesn't type "inline-flex" but RN-web honors it at runtime, which keeps
  // the tooltip wrapper from breaking inline markdown flow.
  display: "inline-flex" as ViewStyle["display"],
};

export function LinkHoverTooltip({
  target,
  children,
}: {
  target: string | null;
  children: ReactNode;
}) {
  if (!isWeb) {
    return children;
  }

  return (
    <Tooltip delayDuration={400} interactive retainOnContentSelection>
      <TooltipTrigger asChild>
        <View style={LINK_TOOLTIP_TRIGGER_STYLE}>{children}</View>
      </TooltipTrigger>
      {target ? (
        <TooltipContent side="top" align="start" maxWidth={520}>
          <Text selectable style={styles.target}>
            {target}
          </Text>
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  target: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
}));
