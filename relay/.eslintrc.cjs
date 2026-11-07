// The root config targets React Native, where `Buffer` and `process` are not globals.
module.exports = {
  env: { node: true, es2022: true },
  parserOptions: { sourceType: 'module', ecmaVersion: 2022 },
};
