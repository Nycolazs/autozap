import React, { useCallback, useEffect, useRef } from 'react';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Animated, AppState, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Updates from 'expo-updates';
import { LoadingView } from './src/components/LoadingView';
import { AppSessionProvider, useAppSession } from './src/context/AppSessionContext';
import { AppThemeProvider, useAppTheme } from './src/context/AppThemeContext';
import { AdminScreen } from './src/screens/AdminScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { SetupAdminScreen } from './src/screens/SetupAdminScreen';
import { TicketsScreen } from './src/screens/TicketsScreen';
import type { RootStackParamList } from './src/types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

function RootNavigator() {
  const { booting, hasAdmin, session } = useAppSession();
  const { colors, isDark, transition } = useAppTheme();
  const checkingUpdateRef = useRef(false);
  const lastUpdateCheckAtRef = useRef(0);

  const checkForOtaUpdate = useCallback(async (force = false) => {
    if (__DEV__) return;
    if (!Updates.isEnabled) return;
    if (checkingUpdateRef.current) return;

    const now = Date.now();
    const minIntervalMs = 60 * 1000;
    if (!force && now - lastUpdateCheckAtRef.current < minIntervalMs) {
      return;
    }

    checkingUpdateRef.current = true;
    lastUpdateCheckAtRef.current = now;
    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) return;
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    } catch (_) {
      // Silencioso para não interromper uso do app caso o servidor de update esteja indisponível.
    } finally {
      checkingUpdateRef.current = false;
    }
  }, []);

  useEffect(() => {
    void checkForOtaUpdate(true);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void checkForOtaUpdate(false);
      }
    });
    return () => {
      sub.remove();
    };
  }, [checkForOtaUpdate]);

  const navTheme = isDark
    ? {
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          primary: colors.primaryStrong,
          background: colors.background,
          card: colors.surface,
          text: colors.text,
          border: colors.border,
          notification: colors.primary,
        },
      }
    : {
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          primary: colors.primaryStrong,
          background: colors.background,
          card: colors.surface,
          text: colors.text,
          border: colors.border,
          notification: colors.primary,
        },
      };

  const screenOptions: NativeStackNavigationOptions = {
    headerShown: false,
    animation: Platform.OS === 'android' ? 'slide_from_right' : 'default',
    animationDuration: 220,
    fullScreenGestureEnabled: true,
    gestureEnabled: true,
    freezeOnBlur: false,
    contentStyle: {
      backgroundColor: colors.background,
    },
  };

  if (booting) {
    return <LoadingView label="Preparando AutoZap..." />;
  }

  const scale = transition.interpolate({
    inputRange: [0.93, 1],
    outputRange: [0.992, 1],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        opacity: transition,
        transform: [{ scale }],
      }}
    >
      <NavigationContainer theme={navTheme}>
        <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={colors.background} translucent={false} />

        {!hasAdmin ? (
          <Stack.Navigator screenOptions={screenOptions}>
            <Stack.Screen name="SetupAdmin" component={SetupAdminScreen} />
          </Stack.Navigator>
        ) : !session ? (
          <Stack.Navigator screenOptions={screenOptions}>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="SetupAdmin" component={SetupAdminScreen} />
          </Stack.Navigator>
        ) : (
          <Stack.Navigator screenOptions={screenOptions}>
            <Stack.Screen name="Tickets" component={TicketsScreen} />
            <Stack.Screen name="Chat" component={ChatScreen} />
            <Stack.Screen name="Admin" component={AdminScreen} />
          </Stack.Navigator>
        )}
      </NavigationContainer>
    </Animated.View>
  );
}

function ThemedAppRoot() {
  const { colors } = useAppTheme();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <AppSessionProvider>
            <RootNavigator />
          </AppSessionProvider>
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default function App() {
  return (
    <AppThemeProvider>
      <ThemedAppRoot />
    </AppThemeProvider>
  );
}
