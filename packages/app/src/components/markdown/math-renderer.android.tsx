import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text } from "react-native";
import { RaTeXView, type RaTeXViewProps } from "ratex-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useToast } from "@/contexts/toast-context";
import type { Theme } from "@/styles/theme";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { getMathClipboardText } from "./math-clipboard";
import type { MarkdownMathProps } from "./math-renderer.types";

export type { MarkdownMathProps } from "./math-renderer.types";

const COPY_FORMULA_LABEL = "Copy formula";
const ThemedRaTeXView = withUnistyles(RaTeXView);

function mathPropsMapping(theme: Theme): Partial<RaTeXViewProps> {
  return {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  };
}

function MathSource({ content, displayMode }: MarkdownMathProps) {
  return (
    <Text selectable style={displayMode ? styles.blockSource : styles.inlineSource}>
      {content}
    </Text>
  );
}

function MathContent({ content, displayMode }: MarkdownMathProps) {
  const [renderFailed, setRenderFailed] = useState(false);

  useEffect(() => {
    setRenderFailed(false);
  }, [content, displayMode]);

  const handleError = useCallback(() => {
    setRenderFailed(true);
  }, []);

  if (renderFailed) {
    return <MathSource content={content} displayMode={displayMode} />;
  }

  return (
    <ThemedRaTeXView
      latex={content}
      displayMode={displayMode}
      onError={handleError}
      style={displayMode ? styles.blockFormula : styles.inlineFormula}
      uniProps={mathPropsMapping}
    />
  );
}

export function MarkdownMath({ content, displayMode }: MarkdownMathProps) {
  const toast = useToast();
  const copyFormula = useCallback(() => {
    void copyToClipboard(getMathClipboardText(content, displayMode))
      .then(() => toast.copied())
      .catch(() => toast.error("Copy failed"));
  }, [content, displayMode, toast]);
  const accessibilityLabel = `${COPY_FORMULA_LABEL}: ${content}`;

  const formula = (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={copyFormula}
      style={displayMode ? styles.blockPressable : styles.inlinePressable}
    >
      <MathContent content={content} displayMode={displayMode} />
    </Pressable>
  );

  if (!displayMode) {
    return formula;
  }

  return (
    <ScrollView
      horizontal
      contentContainerStyle={styles.blockScrollContent}
      showsHorizontalScrollIndicator={false}
      style={styles.blockScroll}
    >
      {formula}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  inlinePressable: {
    alignSelf: "baseline",
    flexDirection: "row",
    alignItems: "baseline",
  },
  inlineFormula: {
    alignSelf: "baseline",
  },
  blockScroll: {
    width: "100%",
    marginBottom: theme.spacing[3],
  },
  blockScrollContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  blockPressable: {
    alignSelf: "center",
  },
  blockFormula: {},
  inlineSource: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
  },
  blockSource: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
    paddingVertical: theme.spacing[2],
  },
}));
