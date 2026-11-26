import { useEffect, useMemo, useRef, useState } from "react";
import { Gesture } from "react-native-gesture-handler";
import { useAppSettings } from "@/hooks/use-settings";
import {
  SIDEBAR_RESIZE_ACTIVATION_OFFSET,
  SIDEBAR_RESIZE_FAIL_OFFSET,
} from "@/components/sidebar-resize-handle-layout";
import { resolveWorkspaceTabRailWidth } from "./workspace-tab-placement";

export function useWorkspaceTabRailResize(paneWidth: number) {
  const { settings, updateSettings } = useAppSettings();
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const [pressed, setPressed] = useState(false);
  const width = resolveWorkspaceTabRailWidth(
    previewWidth ?? settings.workspaceTabRailWidth,
    paneWidth,
  );
  const visibleWidthRef = useRef(width);
  visibleWidthRef.current = width;
  const startWidthRef = useRef(width);
  useEffect(() => {
    if (
      !pressed &&
      previewWidth !== null &&
      Math.round(previewWidth) === settings.workspaceTabRailWidth
    ) {
      setPreviewWidth(null);
    }
  }, [pressed, previewWidth, settings.workspaceTabRailWidth]);
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX([-SIDEBAR_RESIZE_ACTIVATION_OFFSET, SIDEBAR_RESIZE_ACTIVATION_OFFSET])
        .failOffsetY([-SIDEBAR_RESIZE_FAIL_OFFSET, SIDEBAR_RESIZE_FAIL_OFFSET])
        .onBegin(() => setPressed(true))
        .onStart((event) => {
          startWidthRef.current = visibleWidthRef.current - event.translationX;
        })
        .onUpdate((event) => {
          const nextWidth = resolveWorkspaceTabRailWidth(
            startWidthRef.current + event.translationX,
            paneWidth,
          );
          visibleWidthRef.current = nextWidth;
          setPreviewWidth(nextWidth);
        })
        .onEnd((_event, success) => {
          if (success) {
            void updateSettings({
              workspaceTabRailWidth: Math.round(visibleWidthRef.current),
            }).catch(() => setPreviewWidth(null));
          }
        })
        .onFinalize((_event, success) => {
          setPressed(false);
          if (!success) setPreviewWidth(null);
        }),
    [paneWidth, updateSettings],
  );
  return { width, gesture, pressed };
}
