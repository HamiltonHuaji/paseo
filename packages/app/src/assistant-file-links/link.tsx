import { useMemo, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Platform, Pressable, Text, type StyleProp, type TextStyle } from "react-native";
import { isNative } from "@/constants/platform";
import { MarkdownTextSpan } from "@/components/markdown-text";
import { LinkHoverTooltip } from "@/components/link-hover-tooltip";
import { AssistantLinkPressProvider, type AssistantLinkPress } from "./link-press-context";
import { useStableEvent } from "@/hooks/use-stable-event";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import { useAssistantFileLinkResolverContext } from "./provider";
import type { AssistantFileLinkSource } from "./resolver";
import { useFileLink } from "./use-file-link";

interface AssistantMarkdownLinkProps {
  source: AssistantFileLinkSource;
  style: StyleProp<TextStyle>;
  monoSurface?: boolean;
  children: ReactNode;
}

export function AssistantMarkdownLink({
  source,
  style,
  monoSurface,
  children,
}: AssistantMarkdownLinkProps) {
  const [hovered, setHovered] = useState(false);
  const { target, externalUrl, onHoverIn, onPress, onAuxPress } = useFileLink(source);
  const { configRef } = useAssistantFileLinkResolverContext();
  const workspaceRoot = configRef.current.workspaceRoot;
  const tooltipPath = useMemo(
    () => (target ? formatInlinePathTargetForTooltip(target, workspaceRoot) : null),
    [target, workspaceRoot],
  );
  const handleAnchorClickCapture = useStableEvent((event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (!isModifiedOpenEvent(event)) {
      return;
    }
    event.stopPropagation();
    onAuxPress();
  });
  const handleHoverIn = useStableEvent(() => {
    setHovered(true);
    onHoverIn();
  });
  const handleHoverOut = useStableEvent(() => setHovered(false));
  const hoveredTextStyle = useMemo<StyleProp<TextStyle>>(
    () => [style, hovered && { textDecorationLine: "underline" as const }],
    [style, hovered],
  );
  const linkPress = useMemo<AssistantLinkPress>(
    () => ({ onPress, accessibilityRole: "link" }),
    [onPress],
  );
  const tooltipTarget = tooltipPath ?? externalUrl;

  if (isNative) {
    // Must be a MarkdownTextSpan, not a plain <Text>: on iOS the link renders
    // inside the paragraph's native UITextView, and a plain <Text> nested there
    // is not hoisted into a UITextViewChild, so its text is silently dropped
    // (the link disappears). The span composes correctly and stays selectable.
    //
    // Tap-to-open: react-native-uitextview only wires onPress onto the *string*
    // children it turns into RNUITextViewChild nodes — the element children that
    // markdown emits for link text pass through untouched, so an onPress placed
    // here never reaches a tappable native node. We thread it down through
    // AssistantLinkPressProvider so each leaf text span re-attaches it to its
    // own string children, where the native tap recognizer can find it. iOS
    // only: Android forwards onPress through nested <Text> already, and web uses
    // the <a> path below.
    const span = (
      <MarkdownTextSpan
        accessibilityRole="link"
        monoSurface={monoSurface}
        onPress={onPress}
        style={style}
      >
        {children}
      </MarkdownTextSpan>
    );
    return (
      <LinkHoverTooltip target={tooltipTarget} showFileShortcutHint={Boolean(tooltipPath)}>
        {Platform.OS === "ios" ? (
          <AssistantLinkPressProvider value={linkPress}>{span}</AssistantLinkPressProvider>
        ) : (
          span
        )}
      </LinkHoverTooltip>
    );
  }

  const anchor = (
    <a
      href={source.href}
      onClickCapture={handleAnchorClickCapture}
      onAuxClickCapture={preventAnchorNavigation}
      style={LINK_ANCHOR_STYLE}
    >
      <Pressable
        accessibilityRole="link"
        onPress={onPress}
        onHoverIn={handleHoverIn}
        onHoverOut={handleHoverOut}
      >
        <Text dataSet={monoSurface ? CODE_SURFACE_DATASET : undefined} style={hoveredTextStyle}>
          {children}
        </Text>
      </Pressable>
    </a>
  );

  return (
    <LinkHoverTooltip target={tooltipTarget} showFileShortcutHint={Boolean(tooltipPath)}>
      {anchor}
    </LinkHoverTooltip>
  );
}

interface AssistantMarkdownCodeLinkProps {
  source: AssistantFileLinkSource;
  inheritedStyles: TextStyle;
  codeInlineStyle: TextStyle;
  linkStyle: TextStyle;
  children: ReactNode;
}

export function AssistantMarkdownCodeLink({
  source,
  inheritedStyles,
  codeInlineStyle,
  linkStyle,
  children,
}: AssistantMarkdownCodeLinkProps) {
  const style = useMemo(
    () => [inheritedStyles, codeInlineStyle, linkStyle],
    [inheritedStyles, codeInlineStyle, linkStyle],
  );
  return (
    <AssistantMarkdownLink source={source} style={style} monoSurface>
      {children}
    </AssistantMarkdownLink>
  );
}

function formatInlinePathTargetForTooltip(
  target: { path: string; lineStart?: number; lineEnd?: number },
  workspaceRoot: string | undefined,
): string {
  let result = relativizePathToWorkspace(target.path, workspaceRoot);
  if (target.lineStart) {
    result += `:${target.lineStart}`;
    if (target.lineEnd && target.lineEnd !== target.lineStart) {
      result += `-${target.lineEnd}`;
    }
  }
  return result;
}

function relativizePathToWorkspace(filePath: string, workspaceRoot: string | undefined): string {
  if (!workspaceRoot) {
    return filePath;
  }
  const root = workspaceRoot.replace(/\/+$/, "");
  if (!root) {
    return filePath;
  }
  if (filePath === root) {
    return ".";
  }
  const prefix = `${root}/`;
  if (filePath.startsWith(prefix)) {
    return filePath.slice(prefix.length);
  }
  return filePath;
}

interface AssistantInlineCodePathLinkProps {
  content: string;
  inheritedStyles: TextStyle;
  codeInlineStyle: TextStyle;
  linkStyle: TextStyle;
}

export function AssistantInlineCodePathLink({
  content,
  inheritedStyles,
  codeInlineStyle,
  linkStyle,
}: AssistantInlineCodePathLinkProps) {
  const source = useMemo<AssistantFileLinkSource>(
    () => ({
      href: content,
      text: content,
      sourceType: "inline-code",
    }),
    [content],
  );

  return (
    <AssistantMarkdownCodeLink
      source={source}
      inheritedStyles={inheritedStyles}
      codeInlineStyle={codeInlineStyle}
      linkStyle={linkStyle}
    >
      {content}
    </AssistantMarkdownCodeLink>
  );
}

const LINK_ANCHOR_STYLE: CSSProperties = {
  display: "contents",
  color: "inherit",
  textDecoration: "none",
};

function preventAnchorNavigation(event: MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault();
}

function isModifiedOpenEvent(event: MouseEvent<HTMLElement>): boolean {
  return event.metaKey || event.ctrlKey;
}
