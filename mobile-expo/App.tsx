import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LoadingView } from './src/components/LoadingView';
import { AppSessionProvider, useAppSession } from './src/context/AppSessionContext';
import { AdminScreen } from './src/screens/AdminScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { SetupAdminScreen } from './src/screens/SetupAdminScreen';
import { TicketsScreen } from './src/screens/TicketsScreen';
import type { RootStackParamList } from './src/types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

function RootNavigator() {
  const { booting, hasAdmin, session } = useAppSession();

  if (booting) {
    return <LoadingView label="Preparando AutoZap..." />;
  }

  return (
    <NavigationContainer>
      <StatusBar style="dark" backgroundColor="#ffffff" translucent={false} />

      {!hasAdmin ? (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="SetupAdmin" component={SetupAdminScreen} />
        </Stack.Navigator>
      ) : !session ? (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="SetupAdmin" component={SetupAdminScreen} />
        </Stack.Navigator>
      ) : (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Tickets" component={TicketsScreen} />
          <Stack.Screen name="Chat" component={ChatScreen} />
          <Stack.Screen name="Admin" component={AdminScreen} />
        </Stack.Navigator>
      )}
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppSessionProvider>
          <RootNavigator />
        </AppSessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
