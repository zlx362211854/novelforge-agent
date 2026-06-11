import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPathSafety } from '../src/core/projectOps.js';

// =====================================================================
// POSIX default (permissive) — system paths blocked, everything else OK
// =====================================================================

const posixPolicy = {
  platform: 'darwin' as NodeJS.Platform,
  home: '/Users/alice',
  env: {},
};

test('posix default: paths inside home → ok', () => {
  const r = checkPathSafety('/Users/alice/novelforge/novels', posixPolicy);
  assert.equal(r.ok, true);
});

test('posix default: absolute path inside an app-specific subdir of home → ok (WorkBuddy case)', () => {
  const r = checkPathSafety('/Users/alice/Library/Application Support/WorkBuddy/sess-123/novels', posixPolicy);
  assert.equal(r.ok, true, `should allow ~/Library/Application Support paths even though /Library prefix is in the system list. got: ${r.reason}`);
});

test('posix default: absolute path OUTSIDE home (e.g. /Volumes) → ok by default (only system paths block)', () => {
  const r = checkPathSafety('/Volumes/Extern/novels', posixPolicy);
  assert.equal(r.ok, true);
});

test('posix default: /tmp/foo → ok (not in system list)', () => {
  const r = checkPathSafety('/tmp/foo/novels', posixPolicy);
  assert.equal(r.ok, true);
});

test('posix default: /etc/foo → BLOCKED', () => {
  const r = checkPathSafety('/etc/foo', posixPolicy);
  assert.equal(r.ok, false);
  assert.match(r.reason!, /system directory/);
});

test('posix default: /usr/local/foo → BLOCKED', () => {
  const r = checkPathSafety('/usr/local/foo', posixPolicy);
  assert.equal(r.ok, false);
});

test('posix default: /System/Library/... → BLOCKED', () => {
  const r = checkPathSafety('/System/Library/Frameworks/Foo', posixPolicy);
  assert.equal(r.ok, false);
});

test('posix default: /Library/Application Support/Foo (global) → BLOCKED', () => {
  const r = checkPathSafety('/Library/Application Support/Foo', posixPolicy);
  assert.equal(r.ok, false);
});

test('posix default: /root/.ssh → BLOCKED', () => {
  const r = checkPathSafety('/root/.ssh', posixPolicy);
  assert.equal(r.ok, false);
});

// =====================================================================
// POSIX strict mode — must be inside workspaceRoot
// =====================================================================

test('posix strict: inside workspaceRoot → ok', () => {
  const r = checkPathSafety('/Users/alice/novelforge/novels', {
    ...posixPolicy,
    strict: true,
    workspaceRoot: '/Users/alice/novelforge',
  });
  assert.equal(r.ok, true);
});

test('posix strict: outside workspaceRoot → BLOCKED with helpful message', () => {
  const r = checkPathSafety('/Users/alice/WorkBuddy/sess-123/novels', {
    ...posixPolicy,
    strict: true,
    workspaceRoot: '/Users/alice/novelforge',
  });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /Strict mode/);
  assert.match(r.reason!, /NOVELFORGE_WORKSPACE/);
});

test('posix strict without workspaceRoot → BLOCKED', () => {
  const r = checkPathSafety('/Users/alice/foo', {
    ...posixPolicy,
    strict: true,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /requires NOVELFORGE_WORKSPACE/);
});

// =====================================================================
// Windows default (permissive)
// =====================================================================

const winPolicy = {
  platform: 'win32' as NodeJS.Platform,
  home: 'C:\\Users\\Alice',
  env: {
    SystemRoot: 'C:\\Windows',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    ProgramData: 'C:\\ProgramData',
  },
};

test('windows default: C:\\Users\\Alice\\Documents\\novels → ok', () => {
  const r = checkPathSafety('C:\\Users\\Alice\\Documents\\novels', winPolicy);
  assert.equal(r.ok, true);
});

test('windows default: D:\\novels (different drive) → ok by default', () => {
  const r = checkPathSafety('D:\\novels', winPolicy);
  assert.equal(r.ok, true);
});

test('windows default: C:\\Windows\\System32 → BLOCKED', () => {
  const r = checkPathSafety('C:\\Windows\\System32\\foo', winPolicy);
  assert.equal(r.ok, false);
});

test('windows default: case-insensitive system path block', () => {
  const r = checkPathSafety('c:\\windows\\foo', winPolicy);
  assert.equal(r.ok, false, `must block case-insensitive: got ${JSON.stringify(r)}`);
});

test('windows default: C:\\Program Files\\Microsoft → BLOCKED', () => {
  const r = checkPathSafety('C:\\Program Files\\Microsoft\\Foo', winPolicy);
  assert.equal(r.ok, false);
});

test('windows default: C:\\ProgramData\\Foo → BLOCKED', () => {
  const r = checkPathSafety('C:\\ProgramData\\Foo', winPolicy);
  assert.equal(r.ok, false);
});

test('windows default: C:\\Users\\Alice\\AppData\\Local\\Foo → ok (inside home)', () => {
  const r = checkPathSafety('C:\\Users\\Alice\\AppData\\Local\\Foo', winPolicy);
  assert.equal(r.ok, true);
});

// =====================================================================
// Windows strict mode
// =====================================================================

test('windows strict: inside workspace → ok', () => {
  const r = checkPathSafety('C:\\Users\\Alice\\novels\\nf-123', {
    ...winPolicy,
    strict: true,
    workspaceRoot: 'C:\\Users\\Alice\\novels',
  });
  assert.equal(r.ok, true);
});

test('windows strict: outside workspace → BLOCKED', () => {
  const r = checkPathSafety('D:\\other\\novels', {
    ...winPolicy,
    strict: true,
    workspaceRoot: 'C:\\Users\\Alice\\novels',
  });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /Strict mode/);
});

// =====================================================================
// Strict mode interaction with system paths
// =====================================================================

test('strict mode does not let system paths through even if they are "inside workspace"', () => {
  // Pathological edge case: someone set NOVELFORGE_WORKSPACE=/ to bypass — system paths still blocked.
  const r = checkPathSafety('/etc/passwd', {
    platform: 'darwin',
    home: '/Users/alice',
    env: {},
    strict: true,
    workspaceRoot: '/',
  });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /system directory/);
});
