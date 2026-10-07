/**
 * Runs `fn` with IPA_RUNTIME_ENV set to `value` — or REMOVED for undefined — and restores it.
 * Test runs set IPA_RUNTIME_ENV=test explicitly (vitest config); a test that needs another
 * environment, or a missing one, says so here instead of inheriting it from the shell.
 */
export function withRuntimeEnv<T>(value: string | undefined, fn: () => T): T {
  const saved = process.env.IPA_RUNTIME_ENV;
  const restore = () => {
    if (saved === undefined) delete process.env.IPA_RUNTIME_ENV;
    else process.env.IPA_RUNTIME_ENV = saved;
  };
  if (value === undefined) delete process.env.IPA_RUNTIME_ENV;
  else process.env.IPA_RUNTIME_ENV = value;
  try {
    const result = fn();
    if (result instanceof Promise) return result.finally(restore) as T;
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}
