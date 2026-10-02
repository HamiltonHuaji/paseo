import { useMemo } from "react";
import { View } from "react-native";
import type { ASTNode, RenderRules } from "react-native-markdown-display";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { AssistantMarkdownImage } from "@/assistant-image/markdown-image";
import { useAssistantFileLinkActions } from "@/assistant-file-links";
import { MarkdownRenderer, createSharedMarkdownRules } from "@/components/markdown/renderer";
import { useStableEvent } from "@/hooks/use-stable-event";
import { createAssistantMarkdownParser } from "@/utils/assistant-markdown-parser";

const markdownParser = createAssistantMarkdownParser();

interface QuestionFormMarkdownProps {
  text: string;
  occurrenceKey: string;
  client: DaemonClient | null;
  serverId: string;
  workspaceRoot: string;
  muted?: boolean;
}

export function QuestionFormMarkdown({
  text,
  occurrenceKey,
  client,
  serverId,
  workspaceRoot,
  muted = false,
}: QuestionFormMarkdownProps) {
  const fileLinkActions = useAssistantFileLinkActions();
  const onLinkPress = useStableEvent((url: string) => {
    fileLinkActions.open({ href: url }, "preferred");
    return false;
  });
  const rules = useMemo<RenderRules>(
    () => ({
      ...createSharedMarkdownRules(),
      image: (node: ASTNode) => (
        <AssistantMarkdownImage
          key={node.key}
          source={String(node.attributes?.src ?? "")}
          occurrenceKey={`${occurrenceKey}:${node.key}`}
          alt={typeof node.attributes?.alt === "string" ? node.attributes.alt : undefined}
          hasLeadingContent={false}
          client={client}
          workspaceRoot={workspaceRoot}
          serverId={serverId}
        />
      ),
    }),
    [client, occurrenceKey, serverId, workspaceRoot],
  );

  return (
    <View style={muted ? MUTED_STYLE : undefined}>
      <MarkdownRenderer
        text={text}
        compact
        rules={rules}
        markdownit={markdownParser}
        onLinkPress={onLinkPress}
        enableHtmlish={false}
      />
    </View>
  );
}

const MUTED_STYLE = { opacity: 0.65 } as const;
