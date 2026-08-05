import { useContext } from 'react';
import { ThemeContext } from './ThemeProvider';
export const useTheme = () => {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
};
