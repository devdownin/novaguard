// The library's own jest mock: SafeAreaProvider otherwise withholds its
// children until a native onLayout supplies insets, so under Jest the tree
// renders empty and no startup assertion can see anything.
module.exports = require('react-native-safe-area-context/jest/mock').default;
