import { ActivityIndicator, Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '@/theme/useTheme';
import { radius, spacing } from '@/theme/tokens';

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  loading?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => ({
        height: 52,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: primary ? colors.primary : colors.surface,
        borderWidth: primary ? 0 : 1,
        borderColor: colors.border,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator color={primary ? colors.onPrimary : colors.text} />
      ) : (
        <Text style={{ color: primary ? colors.onPrimary : colors.text, fontSize: 16, fontWeight: '600' }}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const { colors } = useTheme();
  const { label, ...rest } = props;
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ color: colors.textMuted, fontSize: 13 }}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textMuted}
        {...rest}
        style={{
          height: 52,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          color: colors.text,
          paddingHorizontal: spacing.lg,
          fontSize: 16,
        }}
      />
    </View>
  );
}

export function ErrorText({ children }: { children?: string | null }) {
  const { colors } = useTheme();
  return children ? <Text style={{ color: colors.danger }}>{children}</Text> : null;
}
