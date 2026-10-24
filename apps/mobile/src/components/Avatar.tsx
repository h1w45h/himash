import { Image, Text, View } from 'react-native';
import { useTheme } from '@/theme/useTheme';

const PALETTE = ['#E5484D', '#2F6FED', '#2E9D5B', '#F2A413', '#8E4EC6', '#12A5A5'];

/** Аватар: картинка или инициалы на цветном фоне (цвет зависит от имени, чтобы был стабильным). */
export function Avatar({ name, url, size = 44, status }: { name: string; url?: string | null; size?: number; status?: 'online' | 'playing' | 'offline' }) {
  const { colors } = useTheme();
  const color = PALETTE[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % PALETTE.length];
  return (
    <View style={{ width: size, height: size }}>
      {url ? (
        <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: size / 2 }} />
      ) : (
        <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.4 }}>{name.slice(0, 1).toUpperCase()}</Text>
        </View>
      )}
      {status && status !== 'offline' && (
        <View style={{ position: 'absolute', right: 0, bottom: 0, width: size * 0.3, height: size * 0.3, borderRadius: size, backgroundColor: status === 'playing' ? '#F2A413' : '#2E9D5B', borderWidth: 2, borderColor: colors.bg }} />
      )}
    </View>
  );
}
