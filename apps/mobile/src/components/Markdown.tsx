import { Text, View } from 'react-native';
import { useTheme } from '@/theme/useTheme';

/** Рендерит `**жирный**` внутри строки. */
function Inline({ text, color }: { text: string; color: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <Text style={{ color, fontSize: 16, lineHeight: 23 }}>
      {parts.map((p, i) =>
        p.startsWith('**') ? (
          <Text key={i} style={{ fontWeight: '700' }}>
            {p.slice(2, -2)}
          </Text>
        ) : (
          p
        ),
      )}
    </Text>
  );
}

/** Минимальный рендер markdown-правил: заголовки `##`, списки `-`, нумерованные списки, абзацы. */
export function Markdown({ source }: { source: string }) {
  const { colors } = useTheme();
  const blocks = source.trim().split('\n');
  return (
    <View style={{ gap: 6 }}>
      {blocks.map((line, i) => {
        if (!line.trim()) return <View key={i} style={{ height: 6 }} />;
        if (line.startsWith('## '))
          return (
            <Text key={i} style={{ color: colors.text, fontSize: 19, fontWeight: '700', marginTop: 8 }}>
              {line.slice(3)}
            </Text>
          );
        const bullet = line.match(/^(- |\d+\. )(.*)$/);
        if (bullet)
          return (
            <View key={i} style={{ flexDirection: 'row', gap: 8, paddingRight: 8 }}>
              <Text style={{ color: colors.textMuted, fontSize: 16, lineHeight: 23 }}>
                {bullet[1]?.trim() === '-' ? '•' : bullet[1]?.trim()}
              </Text>
              <View style={{ flex: 1 }}>
                <Inline text={bullet[2] ?? ''} color={colors.text} />
              </View>
            </View>
          );
        return <Inline key={i} text={line} color={colors.text} />;
      })}
    </View>
  );
}
