import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { ru } from '@/i18n/ru';
import { useTheme } from '@/theme/useTheme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const screen = (title: string, icon: IconName) => ({
  title,
  tabBarIcon: ({ color, size }: { color: string; size: number }) => <Ionicons name={icon} color={color} size={size} />,
});

export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen name="index" options={screen(ru.tabs.home, 'home')} />
      <Tabs.Screen name="games" options={screen(ru.tabs.games, 'grid')} />
      <Tabs.Screen name="play" options={screen(ru.tabs.play, 'play-circle')} />
      <Tabs.Screen name="friends" options={screen(ru.tabs.friends, 'people')} />
      <Tabs.Screen name="profile" options={screen(ru.tabs.profile, 'person')} />
    </Tabs>
  );
}
