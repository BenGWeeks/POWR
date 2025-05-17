/**
 * SQLite Migration Helper
 * 
 * This script helps migrate imports from 'expo-sqlite' to '@/lib/db/sqlite-adapter'
 * to ensure cross-platform compatibility (web and native).
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Replace SQLite imports in a file with our adapter
 */
function updateImports(filePath: string): void {
  try {
    console.log(`Processing ${filePath}...`);
    let content = fs.readFileSync(filePath, 'utf-8');
    
    // Replace direct expo-sqlite imports with our adapter
    content = content.replace(
      /import\s+{([^}]*)}\s+from\s+['"]expo-sqlite['"]/g,
      (match, importsList) => {
        // Process the imports to update them to our adapter
        const imports = importsList.split(',').map(imp => imp.trim());
        const mappedImports = imports.map(imp => {
          // Keep original naming if there's an 'as' in the import
          if (imp.includes(' as ')) {
            return imp;
          }
          return imp;
        }).join(', ');
        
        return `import {${mappedImports}} from '@/lib/db/sqlite-adapter'`;
      }
    );
    
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Updated ${filePath}`);
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error);
  }
}

/**
 * Find all TypeScript and JavaScript files in a directory
 */
function findTsFiles(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory() && !filePath.includes('node_modules') && !filePath.includes('.git')) {
      findTsFiles(filePath, fileList);
    } else if (
      (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx')) &&
      !file.endsWith('.d.ts')
    ) {
      fileList.push(filePath);
    }
  }
  
  return fileList;
}

/**
 * Find files that import from expo-sqlite
 */
function findFilesWithSQLiteImports(fileList: string[]): string[] {
  const sqliteFiles: string[] = [];
  
  for (const file of fileList) {
    const content = fs.readFileSync(file, 'utf-8');
    if (content.includes("from 'expo-sqlite'") || content.includes('from "expo-sqlite"')) {
      sqliteFiles.push(file);
    }
  }
  
  return sqliteFiles;
}

// Main execution
function main() {
  const rootDir = process.cwd();
  console.log(`Scanning directory: ${rootDir}`);
  
  const allFiles = findTsFiles(rootDir);
  console.log(`Found ${allFiles.length} TypeScript/JavaScript files`);
  
  const sqliteFiles = findFilesWithSQLiteImports(allFiles);
  console.log(`Found ${sqliteFiles.length} files with SQLite imports`);
  
  // Update each file
  for (const file of sqliteFiles) {
    updateImports(file);
  }
  
  console.log('Migration complete!');
}

// Run the script when executed directly
if (require.main === module) {
  main();
}

export { updateImports, findTsFiles, findFilesWithSQLiteImports };
