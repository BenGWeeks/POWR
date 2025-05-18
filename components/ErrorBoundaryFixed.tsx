import React from 'react';
import { View, Text, ScrollView, Platform, Image, ImageBackground, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { Button } from './ui/button';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error('ErrorBoundary caught an error:', error);
  }

  private resetError = () => {
    this.setState({ hasError: false, error: null });
  };

  private restartApp = () => {
    if (Platform.OS === 'web') {
      // Redirect to the root URL instead of just reloading
      window.location.href = '/';
    } else {
      // For native platforms, just reset the error state
      // The app will re-mount components
      this.resetError();
    }
  };

  render() {
    if (this.state.hasError) {
      // Using StyleSheet instead of className for better styling precision
      return (
        <ImageBackground 
          source={require('../assets/images/BackgroundWoman.png')} 
          style={styles.backgroundImage}
        >
          <View style={styles.overlay}>
            {/* Logo in top left */}
            <View style={styles.logoContainer}>
              <Image 
                source={require('../assets/images/POWRLogo.png')} 
                style={styles.logoImage}
                resizeMode="contain"
              />
            </View>
            
            {/* POWR text near bottom */}
            <View style={styles.powrTextContainer}>
              <Text style={styles.powrText}>POWR</Text>
            </View>
            
            {/* Error content below POWR */}
            <View style={styles.errorContainer}>
              <Text style={styles.errorTitle}>
                Oops. Something went wrong!
              </Text>
            </View>
            
            {/* Buttons at the bottom */}
            <View style={styles.buttonContainer}>
              <TouchableOpacity
                onPress={this.restartApp}
                activeOpacity={0.8}
                style={styles.restartButton}
              >
                <LinearGradient
                  colors={['#F59E0B', '#EF4444']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.gradient}
                >
                  <Text style={styles.buttonText}>Restart App</Text>
                </LinearGradient>
              </TouchableOpacity>
              
              <TouchableOpacity 
                onPress={this.resetError}
                activeOpacity={0.7}
                style={styles.goBackContainer}
              >
                <Text style={styles.goBackText}>Go back</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ImageBackground>
      );
    }

    return this.props.children;
  }
}

// Define styles outside of the component for better performance
const { width, height } = Dimensions.get('window');
const styles = StyleSheet.create({
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
    bottom: 260,
    left: 20,
  },
  powrText: {
    color: '#F2A900',
    fontSize: 30,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Arial-BoldMT' : 'sans-serif-black',
    letterSpacing: 1,
  },
  errorContainer: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 140,
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
