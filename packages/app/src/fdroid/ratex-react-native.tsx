import { useMemo } from "react";
import { Text, View, type ViewStyle } from "react-native";

export interface RaTeXViewProps {
  latex: string;
  displayMode?: boolean;
  color?: string;
  fontSize?: number;
  style?: ViewStyle;
}

export function RaTeXView({ latex, color, fontSize, style }: RaTeXViewProps) {
  const textStyle = useMemo(() => ({ color, fontSize }), [color, fontSize]);
  return (
    <View style={style}>
      <Text selectable style={textStyle}>
        {latex}
      </Text>
    </View>
  );
}
