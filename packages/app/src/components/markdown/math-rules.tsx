import type { ReactNode } from "react";
import type { ASTNode, RenderRules } from "react-native-markdown-display";
import type { TextStyle } from "react-native";
import { MarkdownMath } from "./math-renderer";

function getInheritedForegroundColor(inheritedStyles: TextStyle): string | undefined {
  return typeof inheritedStyles.color === "string" ? inheritedStyles.color : undefined;
}

export function createMarkdownMathRules(): RenderRules {
  return {
    math_inline: (
      node: ASTNode,
      _children: ReactNode[],
      _parent: ASTNode[],
      _styles: unknown,
      inheritedStyles: TextStyle = {},
    ) => (
      <MarkdownMath
        key={node.key}
        content={node.content ?? ""}
        displayMode={false}
        foregroundColor={getInheritedForegroundColor(inheritedStyles)}
      />
    ),
    math_block: (
      node: ASTNode,
      _children: ReactNode[],
      _parent: ASTNode[],
      _styles: unknown,
      inheritedStyles: TextStyle = {},
    ) => (
      <MarkdownMath
        key={node.key}
        content={node.content ?? ""}
        displayMode
        foregroundColor={getInheritedForegroundColor(inheritedStyles)}
      />
    ),
  };
}
