import React, { type ReactNode } from "react";
import { Text, View, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Shortcut } from "@/components/ui/shortcut";
import { isWeb } from "@/constants/platform";

const LINK_TOOLTIP_TRIGGER_STYLE: ViewStyle = {
  // RN doesn't type "inline-flex" but RN-web honors it at runtime, which keeps
  // the tooltip wrapper from breaking inline markdown flow.
  display: "inline-flex" as ViewStyle["display"],
};
const FILE_LINK_TOOLTIP_MOD_KEYS = ["mod"];

export function LinkHoverTooltip({
  target,
  showFileShortcutHint = false,
  children,
}: {
  target: string | null;
  showFileShortcutHint?: boolean;
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
          <View style={styles.body}>
            <Text selectable style={styles.target}>
              {target}
            </Text>
            {showFileShortcutHint ? (
              <View style={styles.hintRow}>
                <Shortcut keys={FILE_LINK_TOOLTIP_MOD_KEYS} />
                <Text selectable={false} style={styles.hintText}>
                  click for side pane
                </Text>
              </View>
            ) : null}
          </View>
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[1],
  },
  target: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
  },
  hintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  hintText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
  },
}));
