// components/SQLiteWebTest.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { openDatabaseSync, SQLiteDatabase } from 'expo-sqlite';

export function SQLiteWebTest() {
  const [testResult, setTestResult] = useState<string>('Testing SQLite...');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function testSQLite() {
      try {
        console.log('Starting SQLite test on platform:', Platform.OS);
        // Open a test database
        const db = openDatabaseSync('test-db.db');
        console.log('Database opened successfully');
        
        // Create a test table
        await db.execAsync(
          'CREATE TABLE IF NOT EXISTS test_table (id INTEGER PRIMARY KEY, value TEXT)'
        );
        console.log('Test table created successfully');
        
        // Insert a test value
        await db.runAsync(
          'INSERT INTO test_table (value) VALUES (?)',
          ['Test value from ' + Platform.OS]
        );
        console.log('Test value inserted successfully');
        
        // Retrieve the test value
        const result = await db.getAllAsync<{ id: number; value: string }>(
          'SELECT * FROM test_table'
        );
        console.log('Query results:', result);
        
        setTestResult(`SQLite is working! Found ${result.length} rows.\n${
          result.map(row => `ID: ${row.id}, Value: ${row.value}`).join('\n')
        }`);
      } catch (err) {
        console.error('SQLite test error:', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    
    testSQLite();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>SQLite Web Test</Text>
      <Text style={styles.platform}>Platform: {Platform.OS}</Text>
      {error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Error:</Text>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : (
        <Text style={styles.result}>{testResult}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    margin: 10,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  platform: {
    fontSize: 16,
    marginBottom: 15,
  },
  result: {
    fontSize: 14,
    lineHeight: 22,
  },
  errorContainer: {
    backgroundColor: '#ffebee',
    padding: 10,
    borderRadius: 4,
  },
  errorTitle: {
    color: '#d32f2f',
    fontWeight: 'bold',
    marginBottom: 5,
  },
  errorText: {
    color: '#d32f2f',
  },
});

export default SQLiteWebTest;
