import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { Minus, Plus, Scan, Focus } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { Theme } from "@/styles/theme";
import { MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM, CANVAS_ZOOM_STEP } from "./camera";

const ZoomOut = withUnistyles(Minus);
const ZoomIn = withUnistyles(Plus);
const Fit = withUnistyles(Scan);
const Selection = withUnistyles(Focus);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ZOOM_PRESETS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3];

export function CanvasControls({
  zoom,
  canFit,
  canFocus,
  onZoom,
  onFit,
  onFocus,
}: {
  zoom: number;
  canFit: boolean;
  canFocus: boolean;
  onZoom: (zoom: number) => void;
  onFit: () => void;
  onFocus: () => void;
}) {
  const { t } = useTranslation();
  const percentage = `${Math.round(zoom * 100)}%`;
  const zoomOut = useCallback(() => onZoom(zoom / CANVAS_ZOOM_STEP), [onZoom, zoom]);
  const zoomIn = useCallback(() => onZoom(zoom * CANVAS_ZOOM_STEP), [onZoom, zoom]);
  const reset = useCallback(() => onZoom(1), [onZoom]);
  const hint = useMemo(
    () => <Text style={styles.percentage}>{t("boardCanvas.zoomHint")}</Text>,
    [t],
  );
  return (
    <View style={styles.controls} testID="canvas-controls">
      <ToolbarButton
        label={t("boardCanvas.zoomOut")}
        tooltipSide="top"
        disabled={zoom <= MIN_CANVAS_ZOOM}
        onPress={zoomOut}
        testID="canvas-zoom-out"
      >
        <ZoomOut size={18} uniProps={iconColor} />
      </ToolbarButton>
      <DropdownMenu>
        <ToolbarButton
          kind="menu"
          label={t("boardCanvas.zoomLevel", { value: percentage })}
          tooltip={hint}
          tooltipSide="top"
          style={styles.percentageButton}
          testID="canvas-zoom-menu"
        >
          <Text style={styles.percentage}>{percentage}</Text>
        </ToolbarButton>
        <DropdownMenuContent side="top" align="start">
          <DropdownMenuItem onSelect={reset}>{t("boardCanvas.actualSize")}</DropdownMenuItem>
          <DropdownMenuItem disabled={!canFit} onSelect={onFit}>
            {t("boardCanvas.fitAll")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canFocus} onSelect={onFocus}>
            {t("boardCanvas.fitSelection")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {ZOOM_PRESETS.map((value) => (
            <ZoomPreset
              key={value}
              value={value}
              selected={Math.abs(value - zoom) < 0.001}
              onZoom={onZoom}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolbarButton
        label={t("boardCanvas.zoomIn")}
        tooltipSide="top"
        disabled={zoom >= MAX_CANVAS_ZOOM}
        onPress={zoomIn}
        testID="canvas-zoom-in"
      >
        <ZoomIn size={18} uniProps={iconColor} />
      </ToolbarButton>
      <View style={styles.separator} />
      <ToolbarButton
        label={t("boardCanvas.fitAll")}
        tooltipSide="top"
        disabled={!canFit}
        onPress={onFit}
        testID="canvas-fit-all"
      >
        <Fit size={18} uniProps={iconColor} />
      </ToolbarButton>
      <ToolbarButton
        label={t("boardCanvas.fitSelection")}
        tooltipSide="top"
        disabled={!canFocus}
        onPress={onFocus}
        testID="canvas-fit-selection"
      >
        <Selection size={18} uniProps={iconColor} />
      </ToolbarButton>
    </View>
  );
}

function ZoomPreset({
  value,
  selected,
  onZoom,
}: {
  value: number;
  selected: boolean;
  onZoom: (zoom: number) => void;
}) {
  const select = useCallback(() => onZoom(value), [onZoom, value]);
  return (
    <DropdownMenuItem
      selected={selected}
      onSelect={select}
    >{`${Math.round(value * 100)}%`}</DropdownMenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  controls: {
    position: "absolute",
    bottom: theme.spacing[3],
    left: theme.spacing[3],
    zIndex: 5,
    flexDirection: "row",
    alignItems: "center",
    padding: theme.spacing[1],
    gap: theme.spacing[1],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
  },
  percentageButton: { minWidth: 56 },
  percentage: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  separator: { width: 1, height: 18, backgroundColor: theme.colors.border },
}));
