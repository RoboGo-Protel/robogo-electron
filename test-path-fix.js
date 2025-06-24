// Test script to validate the path fixing logic
const path = require('path');

console.log('Testing path joining logic fixes:');
console.log('=====================================');

// Test cases
const photoSaveFolder = 'C:\\Users\\rigel\\Documents\\RoboGo';
const testCases = [
  {
    name: 'Relative path',
    folderPath: 'reports/gallery/originals',
    expected: 'C:\\Users\\rigel\\Documents\\RoboGo\\reports\\gallery\\originals'
  },
  {
    name: 'Absolute path (should NOT double)',
    folderPath: 'C:/Users/rigel/Documents/RoboGo/reports/gallery/originals',
    expected: 'C:\\Users\\rigel\\Documents\\RoboGo\\reports\\gallery\\originals'
  },
  {
    name: 'Absolute path Windows style',
    folderPath: 'C:\\Users\\rigel\\Documents\\RoboGo\\reports\\ultrasonic',
    expected: 'C:\\Users\\rigel\\Documents\\RoboGo\\reports\\ultrasonic'
  }
];

function testPathJoin(folderPath, photoSaveFolder) {
  // This is the new logic we implemented
  let fullFolderPath;
  if (path.isAbsolute(folderPath)) {
    console.log("  -> folderPath is absolute, using as-is");
    fullFolderPath = path.normalize(folderPath);
  } else {
    console.log("  -> folderPath is relative, joining with photoSaveFolder");
    fullFolderPath = path.join(photoSaveFolder, folderPath);
  }
  return fullFolderPath;
}

testCases.forEach((testCase, index) => {
  console.log(`\nTest ${index + 1}: ${testCase.name}`);
  console.log(`  Input folderPath: ${testCase.folderPath}`);
  console.log(`  PhotoSaveFolder: ${photoSaveFolder}`);
  
  const result = testPathJoin(testCase.folderPath, photoSaveFolder);
  
  console.log(`  Result: ${result}`);
  console.log(`  Expected: ${testCase.expected}`);
  
  const normalized_result = path.normalize(result);
  const normalized_expected = path.normalize(testCase.expected);
  
  const isCorrect = normalized_result === normalized_expected;
  console.log(`  ✅ PASS: ${isCorrect ? 'YES' : 'NO'}`);
  
  if (!isCorrect) {
    console.log(`  ❌ MISMATCH!`);
    console.log(`     Got:      ${normalized_result}`);
    console.log(`     Expected: ${normalized_expected}`);
  }
});

console.log('\n=====================================');
console.log('Test completed!');
