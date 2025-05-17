// app/sqlite-test.tsx
import React from 'react';
import { View, StyleSheet, ScrollView, Text } from 'react-native';
import SQLiteWebTest from '../components/SQLiteWebTest';

export default function SQLiteTestScreen() {
  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>SQLite Web Testing Page</Text>
        <Text style={styles.description}>
          This page tests if the SQLite functionality works correctly on web platform
        </Text>
      </View>
      
      <SQLiteWebTest />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    padding: 20,
    backgroundColor: '#f5f5f5',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerText: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  description: {
    fontSize: 16,
    marginTop: 8,
    color: '#666',
  },
});
