import { StyleSheet, Dimensions, Platform } from 'react-native';

const { width, height } = Dimensions.get('window');

export const styles = StyleSheet.create({
  backgroundImage: {
    width: '100%',
    height: '100%',
  },
  darkBackground: {
    backgroundColor: '#000000',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 20,
    position: 'relative',
  },
  logoContainer: {
    position: 'absolute',
    top: 20,
    left: 20,
  },
  logoImage: {
    width: 50,
    height: 50,
  },
  logoBackground: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heartContainer: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoIcon: {
    fontSize: 18,
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  powrTextContainer: {
    position: 'absolute',
    bottom: 250,
    left: 20,
  },
  powrText: {
    color: '#F2A900',
    fontSize: 30,
    fontWeight: '900',
    fontFamily: 'ArchivoBlack-Regular',
    letterSpacing: 1,
  },
  errorContainer: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 150,
    alignItems: 'flex-start',
  },
  errorTitle: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: 'bold',
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
    lineHeight: 48,
    textAlign: 'left',
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
  },
  restartButton: {
    marginBottom: 20,
  },
  gradient: {
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 18,
  },
  goBackContainer: {
    alignItems: 'center',
  },
  goBackText: {
    color: '#F59E0B',
    fontSize: 16,
    fontWeight: '600',
  },
});
