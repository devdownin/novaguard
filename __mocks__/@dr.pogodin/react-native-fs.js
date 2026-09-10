// Filesystem stand-in: an app with no clips on disk and no space reported.
// The retention and reclaim rules are covered by __tests__/library.test.ts
// against pure functions, so the tests never need real files.
module.exports = {
  DocumentDirectoryPath: '/tmp/novaguard-test',
  exists: jest.fn(async () => false),
  mkdir: jest.fn(async () => {}),
  stat: jest.fn(async () => ({ size: 0 })),
  unlink: jest.fn(async () => {}),
  moveFile: jest.fn(async () => {}),
  readDir: jest.fn(async () => []),
  getFSInfo: jest.fn(async () => ({
    freeSpace: 0, totalSpace: 0, freeSpaceEx: 0, totalSpaceEx: 0,
  })),
};
