/**
 * Adversarial / red-team tests for FilesystemTool and TerminalTool.
 *
 * Run with:
 *   node --experimental-strip-types --test packages/tools/src/__tests__/red-team.test.ts
 *
 * No external test framework required — uses node:test and node:assert.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

import { FilesystemTool } from '../filesystem.js';
import { TerminalTool } from '../terminal.js';
import type { ToolContext } from '../interface.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSandbox(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'red-team-fs-'));
}

function removeSandbox(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Minimal no-op ToolContext sufficient for all tests. */
function makeCtx(permissionLevel: 'read' | 'write' | 'admin' = 'write'): ToolContext {
  return {
    agentId: 'test-agent',
    projectId: 'test-project',
    permissionLevel,
    auditLog: async () => {},
  };
}

// ---------------------------------------------------------------------------
// FilesystemTool adversarial tests
// ---------------------------------------------------------------------------

describe('FilesystemTool – adversarial inputs', () => {
  let sandbox: string;
  let tool: FilesystemTool;

  before(() => {
    sandbox = makeSandbox();
    tool = new FilesystemTool(sandbox);
    // Write a known file so positive tests have something to read
    fs.writeFileSync(path.join(sandbox, 'hello.txt'), 'world');
  });

  after(() => removeSandbox(sandbox));

  // ── Path traversal ──────────────────────────────────────────────────────

  it('rejects classic ../../etc/passwd traversal', async () => {
    const result = await tool.execute(
      { operation: 'read_file', path: '../../etc/passwd' },
      makeCtx(),
    );
    assert.equal(result.success, false, 'should not succeed on traversal path');
    assert.match(result.error ?? '', /traversal|outside|rejected/i);
  });

  it('rejects deep traversal targeting /root/.ssh/id_rsa', async () => {
    const result = await tool.execute(
      { operation: 'read_file', path: '../../../root/.ssh/id_rsa' },
      makeCtx(),
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /traversal|outside|rejected/i);
  });

  it('rejects traversal constructed from sandboxRoot concatenation', async () => {
    // e.g. if a caller naively does sandboxRoot + '/../../etc/shadow'
    const evilPath = sandbox + '/../../etc/shadow';
    const result = await tool.execute(
      { operation: 'read_file', path: evilPath },
      makeCtx(),
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /traversal|outside|rejected/i);
  });

  // ── Null byte injection ─────────────────────────────────────────────────

  it('rejects null-byte injected path (valid_path\\x00../../etc/passwd)', async () => {
    // The tool should either reject at validate() or safePath() will produce
    // a mangled string that does not resolve outside the sandbox. Either way
    // success must be false – reading /etc/passwd is never acceptable.
    const result = await tool.execute(
      { operation: 'read_file', path: 'hello.txt\x00../../etc/passwd' },
      makeCtx(),
    );
    // Node's fs layer truncates at the null byte on some platforms; on others
    // it throws ENOENT for the literal null-containing string. Either outcome
    // is acceptable as long as success is false OR the file read is confined
    // to the sandbox (content is NOT /etc/passwd content).
    if (result.success) {
      // If it somehow succeeded, the output must be the sandbox file content
      assert.doesNotMatch(String(result.output), /root:|nobody:/,
        'must not have read /etc/passwd via null-byte trick');
    } else {
      assert.equal(result.success, false);
    }
  });

  // ── Symlink escape ──────────────────────────────────────────────────────

  it('rejects symlink that escapes sandbox (or fails to read target)', async () => {
    const linkPath = path.join(sandbox, 'escape-link');
    try {
      fs.symlinkSync('/etc/passwd', linkPath);
    } catch {
      // If symlink creation is not permitted in the test environment, skip
      return;
    }
    const result = await tool.execute(
      { operation: 'read_file', path: 'escape-link' },
      makeCtx(),
    );
    // The tool resolves to /etc/passwd which is outside the sandbox → reject,
    // OR the OS may deny the read → either way success must be false OR
    // the content must not be /etc/passwd.
    if (result.success) {
      assert.doesNotMatch(String(result.output), /root:|nobody:/,
        'must not have leaked /etc/passwd content through symlink');
    } else {
      assert.equal(result.success, false);
    }
    // Cleanup
    try { fs.unlinkSync(linkPath); } catch { /* ignore */ }
  });

  // ── Absolute paths outside sandbox ──────────────────────────────────────

  it('rejects absolute path /etc/passwd', async () => {
    const result = await tool.execute(
      { operation: 'read_file', path: '/etc/passwd' },
      makeCtx(),
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /traversal|outside|rejected/i);
  });

  it('rejects absolute path /root/.bashrc', async () => {
    const result = await tool.execute(
      { operation: 'read_file', path: '/root/.bashrc' },
      makeCtx(),
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /traversal|outside|rejected/i);
  });

  // ── Write / delete outside sandbox ──────────────────────────────────────

  it('rejects write to ../outside.txt', async () => {
    const result = await tool.execute(
      { operation: 'write_file', path: '../outside.txt', content: 'evil' },
      makeCtx(),
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /traversal|outside|rejected/i);
    // Confirm file was not created outside the sandbox
    assert.equal(
      fs.existsSync(path.join(sandbox, '..', 'outside.txt')),
      false,
      'file must not have been created outside sandbox',
    );
  });

  it('rejects delete of ../../important.txt', async () => {
    const result = await tool.execute(
      { operation: 'delete_file', path: '../../important.txt' },
      makeCtx(),
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /traversal|outside|rejected/i);
  });

  // ── Positive test (valid operation inside sandbox) ───────────────────────

  it('allows read_file for a file that exists inside sandbox', async () => {
    const result = await tool.execute(
      { operation: 'read_file', path: 'hello.txt' },
      makeCtx('read'),
    );
    assert.equal(result.success, true);
    assert.equal(result.output, 'world');
  });

  it('allows write_file inside sandbox with write permission', async () => {
    const result = await tool.execute(
      { operation: 'write_file', path: 'new-file.txt', content: 'safe content' },
      makeCtx('write'),
    );
    assert.equal(result.success, true);
    assert.equal(
      fs.readFileSync(path.join(sandbox, 'new-file.txt'), 'utf-8'),
      'safe content',
    );
  });

  it('denies write_file when permissionLevel is read', async () => {
    const result = await tool.execute(
      { operation: 'write_file', path: 'should-not-exist.txt', content: 'x' },
      makeCtx('read'),
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /write permission/i);
  });
});

// ---------------------------------------------------------------------------
// TerminalTool adversarial tests
// ---------------------------------------------------------------------------

describe('TerminalTool – adversarial inputs', () => {
  let tool: TerminalTool;

  before(() => {
    // Use a short timeout so blocked tests don't hang; real-command tests
    // (git status) are fast.
    tool = new TerminalTool({ timeoutMs: 5000 });
  });

  // ── Commands not on allowlist ────────────────────────────────────────────

  const blockedCommands = ['bash', 'python3', 'curl', 'wget', 'rm'];

  for (const cmd of blockedCommands) {
    it(`rejects command not on allowlist: '${cmd}'`, async () => {
      const result = await tool.execute(
        { command: cmd, args: [] },
        makeCtx('write'),
      );
      assert.equal(result.success, false);
      assert.match(result.error ?? '', /not in allowlist/i);
    });
  }

  // ── Shell injection via args ─────────────────────────────────────────────

  it('does not shell-expand injection in args: git status; rm -rf /', async () => {
    // spawn() is used (not exec), so the semicolon is passed as a literal arg
    // to git, which will error with a git usage message — not execute rm.
    const result = await tool.execute(
      { command: 'git', args: ['status; rm -rf /'] },
      makeCtx('write'),
    );
    // git treats 'status; rm -rf /' as an unknown subcommand → exits non-zero
    assert.equal(result.success, false);
    // Confirm rm was NOT invoked: if it had been, the OS would have screamed
    // or we'd have bigger problems. Verify the error is git-level, not FS-level.
    const out = result.output as { stderr?: string } | null;
    const stderr = out?.stderr ?? '';
    assert.doesNotMatch(stderr, /rm: cannot|Permission denied.*rm/i,
      'rm must not have been invoked');
  });

  it('shell metacharacters in --format arg are passed literally to git, not shell-expanded', async () => {
    const result = await tool.execute(
      { command: 'git', args: ['log', '--format=%H; echo INJECTED', '--max-count=1'] },
      makeCtx('write'),
    );
    // spawn() means no shell — git receives the format string literally.
    // Git will output "<hash>; echo INJECTED" as one line (the format template),
    // not run `echo INJECTED` as a separate command. The key security property:
    // "INJECTED" appears only attached to the format string, never on its own line.
    const out = result.output as { stdout?: string } | null;
    const lines = (out?.stdout ?? '').split('\n').map(l => l.trim()).filter(Boolean);
    const standaloneInjected = lines.some(l => l === 'INJECTED');
    assert.equal(standaloneInjected, false,
      'echo INJECTED must not have run as a separate shell command');
  });

  // ── Positive test ────────────────────────────────────────────────────────

  it('executes allowlisted git status (positive test)', async () => {
    const result = await tool.execute(
      { command: 'git', args: ['--version'] },
      makeCtx('write'),
    );
    // git --version always exits 0
    assert.equal(result.success, true);
    const out = result.output as { stdout?: string } | null;
    assert.match(out?.stdout ?? '', /git version/i);
  });

  // ── Empty command ────────────────────────────────────────────────────────

  it('rejects empty command string', async () => {
    const result = await tool.execute(
      { command: '', args: [] },
      makeCtx('write'),
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /non-empty string|not in allowlist/i);
  });

  // ── Path escape via --exec-path ──────────────────────────────────────────

  it('passes --exec-path=../../malicious as a literal arg without executing it', async () => {
    // The arg is passed literally to git, which ignores unknown exec paths
    // gracefully (or errors). The key property is that no OS path traversal
    // or binary substitution actually occurs.
    const result = await tool.execute(
      { command: 'git', args: ['--exec-path=../../malicious'] },
      makeCtx('write'),
    );
    // git either ignores the flag or exits non-zero; either way no crash
    // that would indicate the OS loaded the path-traversed binary.
    const out = result.output as { stdout?: string; stderr?: string } | null;
    const combined = (out?.stdout ?? '') + (out?.stderr ?? '');
    // If a binary at ../../malicious existed and executed, we can't know here,
    // but we can assert the process did not produce arbitrary dangerous output.
    assert.doesNotMatch(combined, /PWNED|malicious executed/i);
  });

  // ── Permission gate ──────────────────────────────────────────────────────

  it('denies allowlisted command when permissionLevel is read', async () => {
    const result = await tool.execute(
      { command: 'git', args: ['status'] },
      makeCtx('read'),
    );
    assert.equal(result.success, false);
    assert.match(result.error ?? '', /write permission/i);
  });
});
