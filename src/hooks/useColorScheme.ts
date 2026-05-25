import { useColorScheme as RNUseColorScheme } from 'react-native';

export function useColorScheme() {
  return RNUseColorScheme() ?? 'dark';
}
