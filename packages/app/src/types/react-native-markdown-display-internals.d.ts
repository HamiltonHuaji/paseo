declare module "react-native-markdown-display/src/lib/util/tokensToAST" {
  export default function tokensToAST(
    tokens: readonly import("markdown-it/lib/token.mjs").default[],
  ): import("react-native-markdown-display").ASTNode[];
}
