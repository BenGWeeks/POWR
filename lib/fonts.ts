import * as Font from 'expo-font';

export const loadFonts = async () => {
  await Font.loadAsync({
    'ArchivoBlack-Regular': require('../assets/fonts/ArchivoBlack-Regular.ttf'),
  });
};

export const fonts = {
  archivoBlack: 'ArchivoBlack-Regular',
};
